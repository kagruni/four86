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
  ema20_4h: number;
  ema50_4h: number;
  atr3_4h: number;
  atr14_4h: number;
  currentVolume_4h: number;
  avgVolume_4h: number;
  macdHistory_4h: number[];
  rsi14History_4h: number[];

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

/**
 * Get detailed multi-timeframe market data for a single symbol
 */
async function getDetailedCoinData(
  symbol: string,
  testnet: boolean
): Promise<DetailedCoinData> {
  // Fetch 1-minute candles and aggregate to 2-minute (need at least 50 for calculations + 10 for history)
  const candles1m = await fetchCandlesInternal(symbol, "1m", 120, testnet); // Fetch 120 1m candles
  const candles2m = aggregate1mTo2m(candles1m); // Aggregate to 2-minute candles

  // Fetch 4-hour candles (need at least 50 + 10 for history)
  const candles4h = await fetchCandlesInternal(symbol, "4h", 60, testnet);

  // Calculate intraday (2-minute) indicators
  const intradayIndicators = calculateHistoricalIndicators(candles2m, 10);
  const closePrices2m = extractClosePrices(candles2m);

  // Current values (most recent)
  const currentPrice = closePrices2m[closePrices2m.length - 1];
  const currentEma20 = calculateEMA(closePrices2m, 20);
  const currentMacd = calculateMACD(closePrices2m);
  const currentRsi7 = calculateRSI(closePrices2m, 7);
  const currentRsi14 = calculateRSI(closePrices2m, 14);

  // Calculate 4-hour context
  const closePrices4h = extractClosePrices(candles4h);
  const fourHourIndicators = calculateHistoricalIndicators(candles4h, 10);

  const ema20_4h = calculateEMA(closePrices4h, 20);
  const ema50_4h = calculateEMA(closePrices4h, 50);

  // ATR for volatility
  const atr3_4h = calculateATR(candles4h, 3);
  const atr14_4h = calculateATR(candles4h, 14);

  // Volume analysis
  const currentVolume_4h = candles4h[candles4h.length - 1]?.v || 0;
  const avgVolume_4h = calculateAverageVolume(candles4h, 20);

  return {
    symbol,
    currentPrice,
    ema20: currentEma20,
    macd: currentMacd.macd,
    rsi7: currentRsi7,
    rsi14: currentRsi14,

    // Intraday series
    priceHistory: intradayIndicators.priceHistory,
    ema20History: intradayIndicators.ema20History,
    macdHistory: intradayIndicators.macdHistory,
    rsi7History: intradayIndicators.rsi7History,
    rsi14History: intradayIndicators.rsi14History,

    // 4-hour context
    ema20_4h,
    ema50_4h,
    atr3_4h,
    atr14_4h,
    currentVolume_4h,
    avgVolume_4h,
    macdHistory_4h: fourHourIndicators.macdHistory,
    rsi14History_4h: fourHourIndicators.rsi14History,

    // Market microstructure (TODO: fetch from Hyperliquid if available)
    // openInterest: undefined,
    // avgOpenInterest: undefined,
    // fundingRate: undefined,
  };
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
            ema20_4h: 0,
            ema50_4h: 0,
            atr3_4h: 0,
            atr14_4h: 0,
            currentVolume_4h: 0,
            avgVolume_4h: 0,
            macdHistory_4h: [],
            rsi14History_4h: [],
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
