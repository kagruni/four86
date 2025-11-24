/**
 * Signal Processor Module
 *
 * Main integration module that combines all signal analysis modules to produce
 * comprehensive trading signals for the Four86 AI trading bot.
 *
 * This module:
 * - Processes detailed market data through all signal modules
 * - Computes market regime from ATR and volume ratios
 * - Generates human-readable summaries for AI prompts
 * - Determines trading recommendations
 * - Evaluates existing positions for invalidation
 */

import { action } from "../_generated/server";
import { v } from "convex/values";
import type { DetailedCoinData } from "../hyperliquid/detailedMarketData";
import {
  CoinSignalSummary,
  ProcessedSignals,
  MarketOverview,
  PositionSignals,
  TrendAnalysis,
  MarketRegime,
  KeyLevels,
  EntrySignal,
  Divergence,
  RiskAssessment,
  SignalDirection,
  RegimeType,
  VolatilityLevel,
} from "./types";
import { analyzeTrend } from "./trendAnalysis";
import { detectKeyLevels } from "./levelDetection";
import { detectDivergences } from "./divergenceDetection";
import { detectEntrySignals, SignalInputData } from "./entrySignals";
import { assessRisk, RiskInputData } from "./riskAssessment";

// =============================================================================
// MARKET REGIME COMPUTATION
// =============================================================================

/**
 * Compute market regime classification from ATR and volume ratios.
 *
 * Regime Types:
 * - TRENDING: ATR ratio < 1.2 and volume ratio > 0.8 (consistent directional movement)
 * - VOLATILE: ATR ratio > 1.5 (increased price swings)
 * - RANGING: Otherwise (consolidation)
 *
 * Volatility Levels:
 * - LOW: ATR ratio < 0.8
 * - NORMAL: 0.8 <= ATR ratio < 1.5
 * - HIGH: 1.5 <= ATR ratio < 2.0
 * - EXTREME: ATR ratio >= 2.0
 *
 * @param atrRatio - ATR3/ATR14 ratio (>1 = increasing volatility)
 * @param volumeRatio - Current volume / average volume (>1 = above average)
 * @returns MarketRegime classification
 */
export function computeMarketRegime(
  atrRatio: number,
  volumeRatio: number
): MarketRegime {
  // Determine regime type
  let type: RegimeType;
  if (atrRatio < 1.2 && volumeRatio > 0.8) {
    type = "TRENDING";
  } else if (atrRatio > 1.5) {
    type = "VOLATILE";
  } else {
    type = "RANGING";
  }

  // Determine volatility level
  let volatility: VolatilityLevel;
  if (atrRatio < 0.8) {
    volatility = "LOW";
  } else if (atrRatio < 1.5) {
    volatility = "NORMAL";
  } else if (atrRatio < 2.0) {
    volatility = "HIGH";
  } else {
    volatility = "EXTREME";
  }

  return {
    type,
    volatility,
    atrRatio: Math.round(atrRatio * 100) / 100,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
  };
}

// =============================================================================
// RECOMMENDATION DETERMINATION
// =============================================================================

/**
 * Determine trading recommendation based on trend, signals, and risk.
 *
 * Logic:
 * - STRONG_LONG: Bullish trend + 3+ long signals + risk < 5
 * - LONG: Bullish trend + 2+ long signals
 * - STRONG_SHORT: Bearish trend + 3+ short signals + risk < 5
 * - SHORT: Bearish trend + 2+ short signals
 * - NEUTRAL: Otherwise
 *
 * @param trend - Trend analysis results
 * @param signals - Detected entry signals
 * @param risk - Risk assessment results
 * @returns Recommendation string
 */
export function determineRecommendation(
  trend: TrendAnalysis,
  signals: EntrySignal[],
  risk: RiskAssessment
): "STRONG_LONG" | "LONG" | "NEUTRAL" | "SHORT" | "STRONG_SHORT" {
  const longSignals = signals.filter((s) => s.direction === "LONG");
  const shortSignals = signals.filter((s) => s.direction === "SHORT");

  const longCount = longSignals.length;
  const shortCount = shortSignals.length;

  // Strong bullish: Bullish trend + 3+ long signals + low risk
  if (trend.direction === "BULLISH" && longCount >= 3 && risk.score < 5) {
    return "STRONG_LONG";
  }

  // Strong bearish: Bearish trend + 3+ short signals + low risk
  if (trend.direction === "BEARISH" && shortCount >= 3 && risk.score < 5) {
    return "STRONG_SHORT";
  }

  // Bullish: Bullish trend + 2+ long signals
  if (trend.direction === "BULLISH" && longCount >= 2) {
    return "LONG";
  }

  // Bearish: Bearish trend + 2+ short signals
  if (trend.direction === "BEARISH" && shortCount >= 2) {
    return "SHORT";
  }

  return "NEUTRAL";
}

// =============================================================================
// SUMMARY GENERATION
// =============================================================================

/**
 * Generate a one-line human-readable summary for the AI prompt.
 *
 * Format examples:
 * - "Strong bullish setup with 3 aligned signals, low risk"
 * - "Bearish divergence detected, moderate risk, near resistance"
 * - "Neutral/ranging market, no clear signals"
 *
 * @param coin - Processed coin signal summary
 * @returns One-line summary string
 */
export function generateSummary(coin: CoinSignalSummary): string {
  const parts: string[] = [];

  // Trend direction and strength
  const trendDesc = coin.trend.direction.toLowerCase();
  const strengthWord =
    coin.trend.strength >= 7
      ? "Strong"
      : coin.trend.strength >= 4
        ? "Moderate"
        : "Weak";

  // Count signals by direction
  const longSignals = coin.entrySignals.filter((s) => s.direction === "LONG");
  const shortSignals = coin.entrySignals.filter((s) => s.direction === "SHORT");

  // Build summary based on recommendation
  switch (coin.recommendation) {
    case "STRONG_LONG":
      parts.push(
        `Strong bullish setup with ${longSignals.length} aligned signals`
      );
      break;
    case "LONG":
      parts.push(
        `${strengthWord} ${trendDesc} trend with ${longSignals.length} long signals`
      );
      break;
    case "STRONG_SHORT":
      parts.push(
        `Strong bearish setup with ${shortSignals.length} aligned signals`
      );
      break;
    case "SHORT":
      parts.push(
        `${strengthWord} ${trendDesc} trend with ${shortSignals.length} short signals`
      );
      break;
    default:
      if (coin.regime.type === "RANGING") {
        parts.push("Ranging market, no clear signals");
      } else if (coin.regime.type === "VOLATILE") {
        parts.push("High volatility, mixed signals");
      } else {
        parts.push("Neutral setup, waiting for confirmation");
      }
  }

  // Add divergence info if present
  if (coin.divergences.length > 0) {
    const div = coin.divergences[0];
    parts.push(`${div.type.toLowerCase()} ${div.indicator} divergence`);
  }

  // Add risk assessment
  const riskWord =
    coin.risk.score <= 3
      ? "low risk"
      : coin.risk.score <= 6
        ? "moderate risk"
        : "high risk";
  parts.push(riskWord);

  // Add proximity to levels if relevant
  if (coin.keyLevels.distanceToResistancePct < 1.0) {
    parts.push("near resistance");
  } else if (coin.keyLevels.distanceToSupportPct < 1.0) {
    parts.push("near support");
  }

  return parts.join(", ");
}

// =============================================================================
// SINGLE COIN PROCESSING
// =============================================================================

/**
 * Process signals for a single coin.
 *
 * This is the main processing function that:
 * 1. Analyzes trend from EMA alignment
 * 2. Computes market regime from ATR/volume
 * 3. Detects key support/resistance levels
 * 4. Detects divergences between price and indicators
 * 5. Detects entry signals
 * 6. Assesses risk
 * 7. Generates recommendation and summary
 *
 * @param symbol - Trading symbol (e.g., "BTC", "ETH")
 * @param data - Detailed coin data with technical indicators
 * @returns Complete coin signal summary
 */
export function processSignals(
  symbol: string,
  data: DetailedCoinData
): CoinSignalSummary {
  console.log(`[SignalProcessor] Processing signals for ${symbol}...`);

  // Handle missing/invalid data
  if (!data || data.currentPrice === 0) {
    console.log(`[SignalProcessor] Invalid data for ${symbol}, returning neutral`);
    return createNeutralSignalSummary(symbol, data);
  }

  // Step 1: Analyze trend
  const trend = analyzeTrend(data);
  console.log(
    `[SignalProcessor] ${symbol} trend: ${trend.direction} (strength: ${trend.strength})`
  );

  // Step 2: Compute market regime
  const atrRatio = data.atr14_4h > 0 ? data.atr3_4h / data.atr14_4h : 1;
  const volumeRatio =
    data.avgVolume_4h > 0 ? data.currentVolume_4h / data.avgVolume_4h : 1;
  const regime = computeMarketRegime(atrRatio, volumeRatio);
  console.log(
    `[SignalProcessor] ${symbol} regime: ${regime.type}, volatility: ${regime.volatility}`
  );

  // Step 3: Detect key levels
  const high24h = data.high24h ?? Math.max(...data.priceHistory);
  const low24h = data.low24h ?? Math.min(...data.priceHistory);
  const keyLevels = detectKeyLevels(
    data.priceHistory,
    data.currentPrice,
    high24h,
    low24h
  );

  // Step 4: Detect divergences
  const divergences = detectDivergences(
    data.priceHistory,
    data.rsi14History,
    data.macdHistory
  );
  if (divergences.length > 0) {
    console.log(
      `[SignalProcessor] ${symbol} divergences detected: ${divergences.map((d) => d.type).join(", ")}`
    );
  }

  // Step 5: Detect entry signals
  const signalInputData: SignalInputData = {
    currentPrice: data.currentPrice,
    ema20: data.ema20,
    priceHistory: data.priceHistory,
    rsi14: data.rsi14,
    rsi14History: data.rsi14History,
    macd: data.macd,
    macdHistory: data.macdHistory,
    macdSignal:
      data.macdHistory.length > 0
        ? data.macdHistory[data.macdHistory.length - 1]
        : data.macd,
    volumeRatio: data.volumeRatio ?? volumeRatio,
  };
  const entrySignals = detectEntrySignals(signalInputData);
  console.log(
    `[SignalProcessor] ${symbol} entry signals: ${entrySignals.length} detected`
  );

  // Add divergence signals to entry signals
  for (const div of divergences) {
    const divSignal: EntrySignal = {
      type: div.type === "BULLISH" ? "BULLISH_DIVERGENCE" : "BEARISH_DIVERGENCE",
      strength: div.strength,
      direction: div.type === "BULLISH" ? "LONG" : "SHORT",
      description: div.description,
    };
    entrySignals.push(divSignal);
  }

  // Determine proposed direction based on signals
  const longCount = entrySignals.filter((s) => s.direction === "LONG").length;
  const shortCount = entrySignals.filter((s) => s.direction === "SHORT").length;
  const proposedDirection: "LONG" | "SHORT" | undefined =
    longCount > shortCount ? "LONG" : shortCount > longCount ? "SHORT" : undefined;

  // Step 6: Assess risk
  const riskInputData: RiskInputData = {
    trend,
    regime,
    signals: entrySignals,
    rsi: data.rsi14,
    distanceToResistancePct: keyLevels.distanceToResistancePct,
    distanceToSupportPct: keyLevels.distanceToSupportPct,
    proposedDirection,
  };
  const risk = assessRisk(riskInputData);
  console.log(`[SignalProcessor] ${symbol} risk score: ${risk.score}`);

  // Step 7: Determine recommendation
  const recommendation = determineRecommendation(trend, entrySignals, risk);

  // Build the complete signal summary
  const coinSummary: CoinSignalSummary = {
    symbol,
    currentPrice: data.currentPrice,
    trend,
    regime,
    keyLevels,
    entrySignals,
    divergences,
    risk,
    rsi14: data.rsi14,
    macd: data.macd,
    macdSignal: signalInputData.macdSignal,
    fundingRate: data.fundingRate ?? null,
    summary: "", // Will be set below
    recommendation,
  };

  // Generate summary
  coinSummary.summary = generateSummary(coinSummary);
  console.log(`[SignalProcessor] ${symbol} recommendation: ${recommendation}`);

  return coinSummary;
}

/**
 * Create a neutral signal summary for invalid/missing data
 */
function createNeutralSignalSummary(
  symbol: string,
  data: DetailedCoinData | null | undefined
): CoinSignalSummary {
  return {
    symbol,
    currentPrice: data?.currentPrice ?? 0,
    trend: {
      direction: "NEUTRAL",
      strength: 1,
      momentum: "STEADY",
      timeframeAlignment: false,
      priceVsEma20Pct: 0,
      ema20VsEma50Pct: 0,
    },
    regime: {
      type: "RANGING",
      volatility: "NORMAL",
      atrRatio: 1,
      volumeRatio: 1,
    },
    keyLevels: {
      resistance: [],
      support: [],
      high24h: 0,
      low24h: 0,
      pivotPoint: 0,
      distanceToResistancePct: 0,
      distanceToSupportPct: 0,
    },
    entrySignals: [],
    divergences: [],
    risk: {
      score: 5,
      factors: ["Insufficient data"],
      counterTrend: false,
      sizeMultiplier: 0.5,
    },
    rsi14: data?.rsi14 ?? 50,
    macd: data?.macd ?? 0,
    macdSignal: 0,
    fundingRate: data?.fundingRate ?? null,
    summary: "Insufficient data for analysis",
    recommendation: "NEUTRAL",
  };
}

// =============================================================================
// MULTI-COIN PROCESSING
// =============================================================================

/**
 * Process signals for all coins in the market data.
 *
 * @param marketData - Record of symbol to DetailedCoinData
 * @returns Record of symbol to CoinSignalSummary
 */
export function processAllCoins(
  marketData: Record<string, DetailedCoinData>
): Record<string, CoinSignalSummary> {
  const results: Record<string, CoinSignalSummary> = {};

  console.log(
    `[SignalProcessor] Processing ${Object.keys(marketData).length} coins...`
  );

  for (const [symbol, data] of Object.entries(marketData)) {
    try {
      results[symbol] = processSignals(symbol, data);
    } catch (error) {
      console.error(`[SignalProcessor] Error processing ${symbol}:`, error);
      results[symbol] = createNeutralSignalSummary(symbol, data);
    }
  }

  return results;
}

// =============================================================================
// MARKET OVERVIEW COMPUTATION
// =============================================================================

/**
 * Compute overall market overview from individual coin signals.
 *
 * Determines:
 * - Overall sentiment (BULLISH/BEARISH/MIXED/NEUTRAL)
 * - Count of bullish and bearish coins
 * - Best opportunity (highest signal count in a direction)
 *
 * @param coins - Record of symbol to CoinSignalSummary
 * @returns MarketOverview
 */
export function computeMarketOverview(
  coins: Record<string, CoinSignalSummary>
): MarketOverview {
  let bullishCount = 0;
  let bearishCount = 0;
  let bestOpportunity: string | null = null;
  let bestDirection: SignalDirection | null = null;
  let maxSignalCount = 0;

  for (const [symbol, coin] of Object.entries(coins)) {
    // Count bullish/bearish recommendations
    if (
      coin.recommendation === "STRONG_LONG" ||
      coin.recommendation === "LONG"
    ) {
      bullishCount++;
    } else if (
      coin.recommendation === "STRONG_SHORT" ||
      coin.recommendation === "SHORT"
    ) {
      bearishCount++;
    }

    // Find best opportunity
    const longSignals = coin.entrySignals.filter(
      (s) => s.direction === "LONG"
    ).length;
    const shortSignals = coin.entrySignals.filter(
      (s) => s.direction === "SHORT"
    ).length;

    const maxForCoin = Math.max(longSignals, shortSignals);
    if (maxForCoin > maxSignalCount) {
      maxSignalCount = maxForCoin;
      bestOpportunity = symbol;
      bestDirection = longSignals > shortSignals ? "LONG" : "SHORT";
    }
  }

  // Determine overall sentiment
  const totalCoins = Object.keys(coins).length;
  let sentiment: "BULLISH" | "BEARISH" | "MIXED" | "NEUTRAL";

  if (totalCoins === 0) {
    sentiment = "NEUTRAL";
  } else if (bullishCount > bearishCount && bullishCount >= totalCoins / 2) {
    sentiment = "BULLISH";
  } else if (bearishCount > bullishCount && bearishCount >= totalCoins / 2) {
    sentiment = "BEARISH";
  } else if (bullishCount > 0 && bearishCount > 0) {
    sentiment = "MIXED";
  } else {
    sentiment = "NEUTRAL";
  }

  return {
    sentiment,
    bullishCount,
    bearishCount,
    bestOpportunity,
    bestDirection,
    maxSignalCount,
  };
}

// =============================================================================
// POSITION EVALUATION
// =============================================================================

/**
 * Position data shape (simplified for signal evaluation)
 */
interface PositionData {
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  size: number;
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;
}

/**
 * Evaluate existing positions against current signals.
 *
 * Checks for:
 * - Invalidation conditions (trend reversal, stop loss proximity)
 * - Whether position should be closed
 * - P&L status
 *
 * @param positions - Array of current positions
 * @param coinSignals - Record of coin signal summaries
 * @returns Array of position signal evaluations
 */
export function evaluatePositions(
  positions: PositionData[],
  coinSignals: Record<string, CoinSignalSummary>
): PositionSignals[] {
  const results: PositionSignals[] = [];

  for (const position of positions) {
    const signals = coinSignals[position.symbol];

    if (!signals) {
      // No signal data for this position
      results.push({
        symbol: position.symbol,
        pnlPct: position.unrealizedPnlPct ?? 0,
        invalidationTriggered: false,
        invalidationReason: null,
        nearStopLoss: false,
        nearTakeProfit: false,
        shouldClose: false,
        closeReason: null,
      });
      continue;
    }

    const pnlPct = position.unrealizedPnlPct ?? 0;
    let invalidationTriggered = false;
    let invalidationReason: string | null = null;
    let shouldClose = false;
    let closeReason: string | null = null;

    // Check for trend reversal invalidation
    if (
      position.side === "LONG" &&
      signals.trend.direction === "BEARISH" &&
      signals.trend.strength >= 6
    ) {
      invalidationTriggered = true;
      invalidationReason = "Strong bearish trend reversal";
      shouldClose = true;
      closeReason = "Trend reversed against long position";
    }

    if (
      position.side === "SHORT" &&
      signals.trend.direction === "BULLISH" &&
      signals.trend.strength >= 6
    ) {
      invalidationTriggered = true;
      invalidationReason = "Strong bullish trend reversal";
      shouldClose = true;
      closeReason = "Trend reversed against short position";
    }

    // Check for opposing strong signals
    const opposingSignals =
      position.side === "LONG"
        ? signals.entrySignals.filter(
            (s) => s.direction === "SHORT" && s.strength === "STRONG"
          )
        : signals.entrySignals.filter(
            (s) => s.direction === "LONG" && s.strength === "STRONG"
          );

    if (opposingSignals.length >= 2) {
      invalidationTriggered = true;
      invalidationReason = `${opposingSignals.length} strong opposing signals`;
      if (!shouldClose) {
        shouldClose = true;
        closeReason = "Multiple strong signals against position direction";
      }
    }

    // Check proximity to support/resistance (for potential exits)
    const nearStopLoss =
      (position.side === "LONG" &&
        signals.keyLevels.distanceToSupportPct < 0.5) ||
      (position.side === "SHORT" &&
        signals.keyLevels.distanceToResistancePct < 0.5);

    const nearTakeProfit =
      (position.side === "LONG" &&
        signals.keyLevels.distanceToResistancePct < 0.5) ||
      (position.side === "SHORT" &&
        signals.keyLevels.distanceToSupportPct < 0.5);

    // Consider closing if risk is very high
    if (signals.risk.score >= 8 && !shouldClose) {
      shouldClose = true;
      closeReason = "Very high risk conditions detected";
    }

    results.push({
      symbol: position.symbol,
      pnlPct,
      invalidationTriggered,
      invalidationReason,
      nearStopLoss,
      nearTakeProfit,
      shouldClose,
      closeReason,
    });
  }

  return results;
}

// =============================================================================
// CONVEX ACTION
// =============================================================================

/**
 * Convex action to process market signals.
 *
 * This is the main entry point for signal processing from the trading loop.
 * It takes detailed market data and optional position data, processes all
 * signals, and returns comprehensive signal summaries for AI decision making.
 *
 * @param detailedMarketData - Record of symbol to DetailedCoinData
 * @param positions - Optional array of current positions
 * @returns ProcessedSignals with coin summaries, position evaluations, and market overview
 */
export const processMarketSignals = action({
  args: {
    detailedMarketData: v.any(),
    positions: v.optional(v.array(v.any())),
  },
  handler: async (_ctx, args): Promise<ProcessedSignals> => {
    const startTime = Date.now();
    console.log("[SignalProcessor] Starting market signal processing...");

    // Process all coins
    const coins = processAllCoins(
      args.detailedMarketData as Record<string, DetailedCoinData>
    );

    // Evaluate positions if provided
    const positions = args.positions
      ? evaluatePositions(args.positions as PositionData[], coins)
      : [];

    // Compute market overview
    const overview = computeMarketOverview(coins);

    const processingTimeMs = Date.now() - startTime;
    console.log(
      `[SignalProcessor] Processing complete in ${processingTimeMs}ms. ` +
        `Sentiment: ${overview.sentiment}, Best opportunity: ${overview.bestOpportunity ?? "none"}`
    );

    return {
      timestamp: new Date().toISOString(),
      processingTimeMs,
      coins,
      positions,
      overview,
    };
  },
});
