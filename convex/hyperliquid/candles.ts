"use node";

/**
 * Hyperliquid Candle Data Module
 *
 * Fetches historical OHLCV (Open, High, Low, Close, Volume) candle data
 * from the Hyperliquid API for technical indicator calculations.
 */

import { action } from "../_generated/server";
import { v } from "convex/values";

/**
 * Candle data structure from Hyperliquid API
 */
export interface Candle {
  /** Start time of the candle (milliseconds) */
  t: number;
  /** Open price */
  o: number;
  /** High price */
  h: number;
  /** Low price */
  l: number;
  /** Close price */
  c: number;
  /** Volume */
  v: number;
}

/**
 * Supported timeframe intervals
 * - 1m: 1 minute
 * - 2m: 2 minutes (aggregated from 1m)
 * - 5m: 5 minutes
 * - 15m: 15 minutes
 * - 1h: 1 hour
 * - 4h: 4 hours
 * - 1d: 1 day
 */
export type CandleInterval = "1m" | "2m" | "5m" | "15m" | "1h" | "4h" | "1d";

/**
 * Shared helper that handles the actual API call + response parsing.
 * Accepts explicit startTime/endTime — used by both fetchCandlesInternal
 * and fetchHistoricalCandles.
 *
 * @param symbol - Trading symbol (e.g., "BTC", "ETH")
 * @param interval - Candle timeframe
 * @param startTime - Start timestamp in milliseconds
 * @param endTime - End timestamp in milliseconds
 * @param testnet - Use testnet API (default: true)
 * @returns Array of candles (oldest to newest)
 */
async function fetchCandlesFromAPI(
  symbol: string,
  interval: CandleInterval,
  startTime: number,
  endTime: number,
  testnet: boolean = true
): Promise<Candle[]> {
  const baseUrl = testnet
    ? "https://api.hyperliquid-testnet.xyz"
    : "https://api.hyperliquid.xyz";

  try {
    const response = await fetch(`${baseUrl}/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: {
          coin: symbol,
          interval: interval,
          startTime: startTime,
          endTime: endTime,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Log response for debugging
    console.log(`Candle API response for ${symbol}:`, JSON.stringify(data).substring(0, 200));

    // Hyperliquid returns candles in different formats depending on the response
    // Could be: [[timestamp, open, high, low, close, volume], ...]
    // Or: { s: "ok", candles: [...] }
    // Or direct array

    let candlesArray: any[] = [];

    if (Array.isArray(data)) {
      candlesArray = data;
    } else if (data && typeof data === 'object') {
      // Check if it has a candles property
      if (Array.isArray(data.candles)) {
        candlesArray = data.candles;
      } else if (Array.isArray(data.data)) {
        candlesArray = data.data;
      } else {
        console.error(`Unexpected candle data structure for ${symbol}:`, Object.keys(data));
        return [];
      }
    }

    if (candlesArray.length === 0) {
      console.warn(`No candle data returned for ${symbol}`);
      return [];
    }

    // Parse and validate candles
    const candles: Candle[] = candlesArray.map((candle: any, index: number) => {
      // Handle both array and object formats
      if (Array.isArray(candle)) {
        if (candle.length < 6) {
          console.error(`Invalid candle array format at index ${index} for ${symbol}:`, candle);
          throw new Error(`Invalid candle format: expected 6 elements, got ${candle.length}`);
        }

        return {
          t: typeof candle[0] === 'number' ? candle[0] : parseInt(candle[0]),
          o: typeof candle[1] === 'number' ? candle[1] : parseFloat(candle[1]),
          h: typeof candle[2] === 'number' ? candle[2] : parseFloat(candle[2]),
          l: typeof candle[3] === 'number' ? candle[3] : parseFloat(candle[3]),
          c: typeof candle[4] === 'number' ? candle[4] : parseFloat(candle[4]),
          v: typeof candle[5] === 'number' ? candle[5] : parseFloat(candle[5]),
        };
      } else if (candle && typeof candle === 'object') {
        // Handle object format { t: ..., o: ..., h: ..., l: ..., c: ..., v: ... }
        // Hyperliquid returns strings for OHLCV, so we need to parse them
        const parseValue = (val: any, fallback: any = 0) => {
          if (val === undefined || val === null) return parseFloat(fallback);
          return typeof val === 'number' ? val : parseFloat(val);
        };

        const parseTime = (val: any) => {
          if (val === undefined || val === null) return 0;
          return typeof val === 'number' ? val : parseInt(val);
        };

        return {
          t: parseTime(candle.t || candle.time || candle.timestamp),
          o: parseValue(candle.o || candle.open),
          h: parseValue(candle.h || candle.high),
          l: parseValue(candle.l || candle.low),
          c: parseValue(candle.c || candle.close),
          v: parseValue(candle.v || candle.volume),
        };
      } else {
        console.error(`Invalid candle format at index ${index} for ${symbol}:`, candle);
        throw new Error("Invalid candle format: not an array or object");
      }
    });

    // Sort by timestamp (oldest to newest) for indicator calculations
    candles.sort((a, b) => a.t - b.t);

    return candles;
  } catch (error) {
    console.error(`Error fetching candles for ${symbol}:`, error);
    throw new Error(
      `Failed to fetch candle data for ${symbol}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Internal helper to fetch candles from Hyperliquid API
 * This is not a Convex action - use within actions only
 *
 * @param symbol - Trading symbol (e.g., "BTC", "ETH")
 * @param interval - Candle timeframe
 * @param limit - Number of candles to fetch (max: 5000, default: 100)
 * @param testnet - Use testnet API (default: true)
 * @returns Array of candles (oldest to newest)
 */
export async function fetchCandlesInternal(
  symbol: string,
  interval: CandleInterval,
  limit: number = 100,
  testnet: boolean = true
): Promise<Candle[]> {
  const actualLimit = Math.min(limit, 5000);

  // Calculate start and end times based on interval and limit
  const now = Date.now();
  const intervalMs = getIntervalMilliseconds(interval);
  const startTime = now - (intervalMs * actualLimit);

  return await fetchCandlesFromAPI(symbol, interval, startTime, now, testnet);
}

/**
 * Fetch historical candle data from Hyperliquid API
 * Convex action wrapper for fetchCandlesInternal
 *
 * @example
 * const candles = await ctx.runAction(api.hyperliquid.candles.fetchCandles, {
 *   symbol: "BTC",
 *   interval: "1h",
 *   limit: 50,
 *   testnet: true
 * });
 */
export const fetchCandles = action({
  args: {
    symbol: v.string(),
    interval: v.string(), // CandleInterval type
    limit: v.optional(v.number()),
    testnet: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await fetchCandlesInternal(
      args.symbol,
      args.interval as CandleInterval,
      args.limit,
      args.testnet
    );
  },
});

/**
 * Fetch historical candle data for a specific time range.
 * Unlike fetchCandles (which computes the window from limit),
 * this action accepts explicit startTime / endTime — ideal for
 * backtesting and charting.
 *
 * @example
 * const candles = await ctx.runAction(api.hyperliquid.candles.fetchHistoricalCandles, {
 *   symbol: "BTC",
 *   interval: "1h",
 *   startTime: Date.now() - 7 * 24 * 60 * 60 * 1000,
 *   endTime: Date.now(),
 *   testnet: true,
 * });
 */
export const fetchHistoricalCandles = action({
  args: {
    symbol: v.string(),
    interval: v.string(),
    startTime: v.number(),
    endTime: v.number(),
    testnet: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await fetchCandlesFromAPI(
      args.symbol,
      args.interval as CandleInterval,
      args.startTime,
      args.endTime,
      args.testnet ?? true
    );
  },
});

/**
 * Fetch candles for multiple symbols in parallel
 *
 * @param symbols - Array of trading symbols
 * @param interval - Candle timeframe
 * @param limit - Number of candles per symbol
 * @param testnet - Use testnet API
 * @returns Map of symbol to candles array
 *
 * @example
 * const candleData = await fetchMultipleCandles(ctx, {
 *   symbols: ["BTC", "ETH", "SOL"],
 *   interval: "1h",
 *   limit: 50,
 *   testnet: true
 * });
 */
export const fetchMultipleCandles = action({
  args: {
    symbols: v.array(v.string()),
    interval: v.string(),
    limit: v.optional(v.number()),
    testnet: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const results: Record<string, Candle[]> = {};

    // Fetch candles for all symbols in parallel
    const promises = args.symbols.map(async (symbol) => {
      try {
        const candles = await fetchCandlesInternal(
          symbol,
          args.interval as CandleInterval,
          args.limit,
          args.testnet
        );
        return { symbol, candles };
      } catch (error) {
        console.error(`Error fetching candles for ${symbol}:`, error);
        return { symbol, candles: [] as Candle[] };
      }
    });

    const allResults = await Promise.all(promises);

    // Build results map
    for (const { symbol, candles } of allResults) {
      results[symbol] = candles;
    }

    return results;
  },
});

/**
 * Extract closing prices from candle data
 *
 * @param candles - Array of candles
 * @returns Array of closing prices (oldest to newest)
 */
export function extractClosePrices(candles: Candle[]): number[] {
  return candles.map((candle) => candle.c);
}

/**
 * Get the latest candle from an array
 *
 * @param candles - Array of candles (should be sorted)
 * @returns Most recent candle or null if empty
 */
export function getLatestCandle(candles: Candle[]): Candle | null {
  if (!candles || candles.length === 0) {
    return null;
  }
  return candles[candles.length - 1];
}

/**
 * Convert interval string to milliseconds
 *
 * @param interval - Candle interval
 * @returns Interval duration in milliseconds
 */
function getIntervalMilliseconds(interval: CandleInterval): number {
  const intervals: Record<string, number> = {
    "1m": 60 * 1000,
    "2m": 2 * 60 * 1000,
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
  };

  return intervals[interval] || intervals["1h"];
}

/**
 * Calculate average volume from candles
 *
 * @param candles - Array of candles
 * @param periods - Number of periods to average (default: 20)
 * @returns Average volume or 0 if insufficient data
 */
export function calculateAverageVolume(candles: Candle[], periods: number = 20): number {
  if (!candles || candles.length < periods) {
    return 0;
  }

  const recentCandles = candles.slice(-periods);
  const totalVolume = recentCandles.reduce((sum, candle) => sum + candle.v, 0);

  return totalVolume / periods;
}

/**
 * Calculate price volatility (standard deviation of returns)
 *
 * @param candles - Array of candles
 * @param periods - Number of periods to analyze (default: 20)
 * @returns Volatility percentage or 0 if insufficient data
 */
export function calculateVolatility(candles: Candle[], periods: number = 20): number {
  if (!candles || candles.length < periods + 1) {
    return 0;
  }

  const recentCandles = candles.slice(-periods - 1);
  const returns: number[] = [];

  // Calculate price returns
  for (let i = 1; i < recentCandles.length; i++) {
    const priceReturn = (recentCandles[i].c - recentCandles[i - 1].c) / recentCandles[i - 1].c;
    returns.push(priceReturn);
  }

  // Calculate mean
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Calculate variance
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;

  // Return standard deviation as percentage
  return Math.sqrt(variance) * 100;
}

/**
 * Aggregate 1-minute candles into 2-minute candles
 *
 * @param candles1m - Array of 1-minute candles (sorted oldest to newest)
 * @returns Array of 2-minute aggregated candles
 */
export function aggregate1mTo2m(candles1m: Candle[]): Candle[] {
  if (!candles1m || candles1m.length === 0) {
    return [];
  }

  const candles2m: Candle[] = [];

  // Process in pairs (every 2 1m candles = 1 2m candle)
  for (let i = 0; i < candles1m.length - 1; i += 2) {
    const candle1 = candles1m[i];
    const candle2 = candles1m[i + 1];

    candles2m.push({
      t: candle1.t, // Start time of first candle
      o: candle1.o, // Open of first candle
      h: Math.max(candle1.h, candle2.h), // Max high
      l: Math.min(candle1.l, candle2.l), // Min low
      c: candle2.c, // Close of second candle
      v: candle1.v + candle2.v, // Sum of volumes
    });
  }

  return candles2m;
}
