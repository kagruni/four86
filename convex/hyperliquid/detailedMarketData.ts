"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { fetchCandlesInternal, extractClosePrices, calculateAverageVolume, aggregate1mTo2m, type Candle } from "./candles";
import {
  calculateRSI,
  calculateMACD,
  calculateEMA,
  calculateATR,
} from "../indicators/technicalIndicators";

/**
 * Comprehensive market data with multi-timeframe analysis
 * Matches the detailed format with historical series
 */
export interface DetailedCoinData {
  symbol: string;

  // Current values
  currentPrice: number;
  ema20: number;
  macd: number;
  rsi7: number;
  rsi14: number;

  // Intraday series (2-minute) - last 10 candles
  priceHistory: number[];
  ema20History: number[];
  macdHistory: number[];
  rsi7History: number[];
  rsi14History: number[];

  // 4-hour context
  ema20_1h: number;
  ema50_1h: number;
  priceHistory_1h: number[];
  ema20_4h: number;
  ema50_4h: number;
  atr3_4h: number;
  atr14_4h: number;
  currentVolume_4h: number;
  avgVolume_4h: number;
  macdHistory_4h: number[];
  rsi14History_4h: number[];

  // 24-hour price range and volume
  dayOpen: number;
  dayChangePct: number;
  high24h: number;
  low24h: number;
  volumeRatio: number; // currentVolume_4h / avgVolume_4h

  // Market microstructure (optional - Hyperliquid may not provide all)
  openInterest?: number;
  avgOpenInterest?: number;
  fundingRate?: number;
}

/**
 * Calculate historical indicator series from candle data
 */
function calculateHistoricalIndicators(candles: Candle[], lastN: number = 10) {
  const closePrices = extractClosePrices(candles);
  const length = closePrices.length;

  // We'll calculate indicators for the last N candles
  const priceHistory: number[] = [];
  const ema20History: number[] = [];
  const macdHistory: number[] = [];
  const rsi7History: number[] = [];
  const rsi14History: number[] = [];

  // Calculate for last N periods
  for (let i = Math.max(0, length - lastN); i < length; i++) {
    // Price
    priceHistory.push(closePrices[i]);

    // EMA20 (need at least 20 data points)
    if (i >= 19) {
      const pricesUpToI = closePrices.slice(0, i + 1);
      const ema20 = calculateEMA(pricesUpToI, 20);
      ema20History.push(ema20);
    }

    // MACD (need at least 35 data points for 26-period EMA)
    if (i >= 34) {
      const pricesUpToI = closePrices.slice(0, i + 1);
      const macdData = calculateMACD(pricesUpToI);
      macdHistory.push(macdData.macd);
    }

    // RSI 7-period
    if (i >= 7) {
      const pricesUpToI = closePrices.slice(0, i + 1);
      const rsi7 = calculateRSI(pricesUpToI, 7);
      rsi7History.push(rsi7);
    }

    // RSI 14-period
    if (i >= 14) {
      const pricesUpToI = closePrices.slice(0, i + 1);
      const rsi14 = calculateRSI(pricesUpToI, 14);
      rsi14History.push(rsi14);
    }
  }

  return {
    priceHistory: priceHistory.slice(-lastN),
    ema20History: ema20History.slice(-lastN),
    macdHistory: macdHistory.slice(-lastN),
    rsi7History: rsi7History.slice(-lastN),
    rsi14History: rsi14History.slice(-lastN),
  };
}

function averageLast(values: number[], periods: number, fallback: number): number {
  if (values.length === 0) return fallback;
  const slice = values.slice(-periods);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

export function buildDetailedCoinDataFromCandles(
  symbol: string,
  candles1m: Candle[],
  candles1h: Candle[],
  candles4h: Candle[],
  candles1d: Candle[]
): DetailedCoinData {
  const candles2m = aggregate1mTo2m(candles1m);

  const intradayIndicators = calculateHistoricalIndicators(candles2m, 10);
  const closePrices2m = extractClosePrices(candles2m);
  const closePrices1h = extractClosePrices(candles1h);
  const closePrices4h = extractClosePrices(candles4h);
  const fallbackPrice =
    closePrices2m[closePrices2m.length - 1] ??
    closePrices1h[closePrices1h.length - 1] ??
    closePrices4h[closePrices4h.length - 1] ??
    candles1d[candles1d.length - 1]?.c ??
    0;

  const currentPrice = fallbackPrice;
  const currentEma20 = closePrices2m.length >= 20
    ? calculateEMA(closePrices2m, 20)
    : averageLast(closePrices2m, 20, currentPrice);
  const currentMacd = closePrices2m.length >= 35
    ? calculateMACD(closePrices2m)
    : { macd: 0, signal: 0, histogram: 0 };
  const currentRsi7 = closePrices2m.length >= 8
    ? calculateRSI(closePrices2m, 7)
    : 50;
  const currentRsi14 = closePrices2m.length >= 15
    ? calculateRSI(closePrices2m, 14)
    : 50;

  const fourHourIndicators = calculateHistoricalIndicators(candles4h, 10);
  const ema20_1h = closePrices1h.length >= 20
    ? calculateEMA(closePrices1h, 20)
    : averageLast(closePrices1h, 20, currentPrice);
  const ema50_1h = closePrices1h.length >= 50
    ? calculateEMA(closePrices1h, 50)
    : averageLast(closePrices1h, 50, currentPrice);
  const ema20_4h = closePrices4h.length >= 20
    ? calculateEMA(closePrices4h, 20)
    : averageLast(closePrices4h, 20, currentPrice);
  const ema50_4h = closePrices4h.length >= 50
    ? calculateEMA(closePrices4h, 50)
    : averageLast(closePrices4h, 50, currentPrice);

  const atr3_4h = candles4h.length >= 3 ? calculateATR(candles4h, 3) : Math.abs(currentPrice * 0.01);
  const atr14_4h = candles4h.length >= 14 ? calculateATR(candles4h, 14) : Math.abs(currentPrice * 0.015);
  const currentVolume_4h = candles4h[candles4h.length - 1]?.v || 0;
  const avgVolume_4h = calculateAverageVolume(candles4h, 20);

  const last6Candles4h = candles4h.slice(-6);
  const high24h = last6Candles4h.length > 0
    ? Math.max(...last6Candles4h.map(c => c.h))
    : currentPrice;
  const low24h = last6Candles4h.length > 0
    ? Math.min(...last6Candles4h.map(c => c.l))
    : currentPrice;

  const volumeRatio = avgVolume_4h > 0 ? currentVolume_4h / avgVolume_4h : 1;

  const currentDayCandle = candles1d[candles1d.length - 1];
  const dayOpen = currentDayCandle?.o || currentPrice;
  const dayChangePct = dayOpen > 0 ? ((currentPrice - dayOpen) / dayOpen) * 100 : 0;

  return {
    symbol,
    currentPrice,
    ema20: currentEma20,
    macd: currentMacd.macd,
    rsi7: currentRsi7,
    rsi14: currentRsi14,
    priceHistory: intradayIndicators.priceHistory,
    ema20History: intradayIndicators.ema20History,
    macdHistory: intradayIndicators.macdHistory,
    rsi7History: intradayIndicators.rsi7History,
    rsi14History: intradayIndicators.rsi14History,
    ema20_1h,
    ema50_1h,
    priceHistory_1h: closePrices1h.slice(-10),
    ema20_4h,
    ema50_4h,
    atr3_4h,
    atr14_4h,
    currentVolume_4h,
    avgVolume_4h,
    macdHistory_4h: fourHourIndicators.macdHistory,
    rsi14History_4h: fourHourIndicators.rsi14History,
    dayOpen,
    dayChangePct,
    high24h,
    low24h,
    volumeRatio,
  };
}

/**
 * Get detailed multi-timeframe market data for a single symbol
 */
async function getDetailedCoinData(
  symbol: string,
  testnet: boolean
): Promise<DetailedCoinData> {
  // Fetch 1-minute candles and aggregate to 2-minute (need at least 50 for calculations + 10 for history)
  const candles1m = await fetchCandlesInternal(symbol, "1m", 120, testnet); // Fetch 120 1m candles

  const candles1h = await fetchCandlesInternal(symbol, "1h", 80, testnet);
  // Fetch 4-hour candles (need at least 50 + 10 for history)
  const candles4h = await fetchCandlesInternal(symbol, "4h", 60, testnet);
  const candles1d = await fetchCandlesInternal(symbol, "1d", 7, testnet);
  return buildDetailedCoinDataFromCandles(
    symbol,
    candles1m,
    candles1h,
    candles4h,
    candles1d
  );
}

/**
 * Convex action to fetch detailed market data for multiple symbols
 */
export const getDetailedMarketData = action({
  args: {
    symbols: v.array(v.string()),
    testnet: v.boolean(),
  },
  handler: async (_ctx, args) => {
    const results: Record<string, DetailedCoinData> = {};

    // Fetch data for all symbols in parallel
    const promises = args.symbols.map(async (symbol) => {
      try {
        const data = await getDetailedCoinData(symbol, args.testnet);
        return { symbol, data };
      } catch (error) {
        console.error(`Error fetching detailed data for ${symbol}:`, error);
        // Return minimal data on error
        return {
          symbol,
          data: {
            symbol,
            currentPrice: 0,
            ema20: 0,
            macd: 0,
            rsi7: 0,
            rsi14: 0,
            priceHistory: [],
            ema20History: [],
            macdHistory: [],
            rsi7History: [],
            rsi14History: [],
            ema20_1h: 0,
            ema50_1h: 0,
            priceHistory_1h: [],
            ema20_4h: 0,
            ema50_4h: 0,
            atr3_4h: 0,
            atr14_4h: 0,
            currentVolume_4h: 0,
            avgVolume_4h: 0,
            macdHistory_4h: [],
            rsi14History_4h: [],
            dayOpen: 0,
            dayChangePct: 0,
            high24h: 0,
            low24h: 0,
            volumeRatio: 1,
          } as DetailedCoinData,
        };
      }
    });

    const allResults = await Promise.all(promises);

    for (const { symbol, data } of allResults) {
      results[symbol] = data;
    }

    return results;
  },
});
