/**
 * Risk Assessment Module for Four86 Trading Bot
 *
 * This module provides risk analysis for trading signals.
 * It evaluates market conditions, trend alignment, and various risk factors
 * to produce a risk score and position size recommendation.
 */

import type {
  RiskAssessment,
  MarketRegime,
  TrendAnalysis,
  EntrySignal,
} from "./types";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Input data required for risk assessment
 */
export interface RiskInputData {
  /** Trend analysis from trend module */
  trend: TrendAnalysis;
  /** Market regime classification */
  regime: MarketRegime;
  /** Detected entry signals */
  signals: EntrySignal[];
  /** Current RSI value */
  rsi: number;
  /** Distance to nearest resistance (percentage) */
  distanceToResistancePct: number;
  /** Distance to nearest support (percentage) */
  distanceToSupportPct: number;
  /** Proposed trade direction (optional) */
  proposedDirection?: "LONG" | "SHORT";
}

// =============================================================================
// COUNTER-TREND DETECTION
// =============================================================================

/**
 * Check if the proposed trade direction is against the primary trend
 *
 * @param trendDirection - The current trend direction (BULLISH, BEARISH, NEUTRAL)
 * @param signalDirection - The proposed trade direction (LONG, SHORT)
 * @returns True if trading against the trend
 */
export function isCounterTrend(
  trendDirection: string,
  signalDirection: string
): boolean {
  // LONG against BEARISH trend = counter-trend
  if (signalDirection === "LONG" && trendDirection === "BEARISH") {
    return true;
  }

  // SHORT against BULLISH trend = counter-trend
  if (signalDirection === "SHORT" && trendDirection === "BULLISH") {
    return true;
  }

  return false;
}

// =============================================================================
// RISK FACTOR IDENTIFICATION
// =============================================================================

/**
 * Identify all risk factors present in the current market conditions
 *
 * @param data - Risk input data containing market conditions
 * @returns Array of human-readable risk factor strings
 */
export function identifyRiskFactors(data: RiskInputData): string[] {
  const factors: string[] = [];

  // Volatility checks
  if (data.regime.atrRatio > 2.0) {
    factors.push("Extreme volatility (ATR ratio > 2.0)");
  } else if (data.regime.atrRatio > 1.5) {
    factors.push("High volatility (ATR ratio > 1.5)");
  }

  // RSI extreme levels
  if (data.rsi > 70) {
    factors.push("RSI overbought (>70)");
  }
  if (data.rsi < 30) {
    factors.push("RSI oversold (<30)");
  }

  // Volume check
  if (data.regime.volumeRatio < 0.7) {
    factors.push("Low volume (<0.7x average)");
  }

  // Counter-trend check
  if (
    data.proposedDirection &&
    isCounterTrend(data.trend.direction, data.proposedDirection)
  ) {
    factors.push("Counter-trend setup");
  }

  // Proximity to key levels
  if (data.distanceToResistancePct < 1.0) {
    factors.push("Near resistance");
  }
  if (data.distanceToSupportPct < 1.0) {
    factors.push("Near support");
  }

  // Signal analysis
  const longSignals = data.signals.filter((s) => s.direction === "LONG");
  const shortSignals = data.signals.filter((s) => s.direction === "SHORT");

  // Conflicting signals (both long and short present)
  if (longSignals.length > 0 && shortSignals.length > 0) {
    factors.push("Conflicting signals");
  }

  // Weak signals (no strong signals present)
  const hasStrongSignal = data.signals.some((s) => s.strength === "STRONG");
  if (data.signals.length > 0 && !hasStrongSignal) {
    factors.push("Weak signal strength");
  }

  // 4h trend analysis for directional trades
  if (data.proposedDirection === "LONG" && data.trend.ema20VsEma50Pct < 0) {
    factors.push("Bearish 4h trend");
  }
  if (data.proposedDirection === "SHORT" && data.trend.ema20VsEma50Pct > 0) {
    factors.push("Bullish 4h trend");
  }

  return factors;
}

// =============================================================================
// RISK SCORE CALCULATION
// =============================================================================

/**
 * Calculate overall risk score based on identified factors
 *
 * @param factors - Array of identified risk factor strings
 * @returns Risk score from 1-10 (10 = highest risk)
 */
export function calculateRiskScore(factors: string[]): number {
  // Base risk score
  let score = 3;

  // Weight different risk factors
  for (const factor of factors) {
    if (factor.includes("Extreme volatility")) {
      score += 2;
    } else if (factor.includes("High volatility")) {
      score += 1;
    } else if (factor.includes("RSI overbought") || factor.includes("RSI oversold")) {
      score += 1;
    } else if (factor.includes("Low volume")) {
      score += 1;
    } else if (factor.includes("Counter-trend")) {
      score += 1.5;
    } else if (factor.includes("Near resistance") || factor.includes("Near support")) {
      score += 0.5;
    } else if (factor.includes("Conflicting signals")) {
      score += 1.5;
    } else if (factor.includes("Weak signal strength")) {
      score += 0.5;
    } else if (factor.includes("Bearish 4h trend") || factor.includes("Bullish 4h trend")) {
      score += 1;
    }
  }

  // Clamp score between 1 and 10
  return Math.min(10, Math.max(1, Math.round(score)));
}

// =============================================================================
// SIZE MULTIPLIER CALCULATION
// =============================================================================

/**
 * Calculate position size multiplier based on risk assessment
 *
 * Higher risk = smaller position size to limit exposure
 *
 * @param riskScore - Risk score from 1-10
 * @param _factors - Risk factors (reserved for future refinements)
 * @returns Size multiplier from 0.25-1.0
 */
export function calculateSizeMultiplier(
  riskScore: number,
  _factors: string[]
): number {
  // Risk 1-3: Full size (1.0)
  if (riskScore <= 3) {
    return 1.0;
  }

  // Risk 4-5: 75% size
  if (riskScore <= 5) {
    return 0.75;
  }

  // Risk 6-7: 50% size
  if (riskScore <= 7) {
    return 0.5;
  }

  // Risk 8-10: Minimum size (25%)
  return 0.25;
}

// =============================================================================
// MAIN RISK ASSESSMENT FUNCTION
// =============================================================================

/**
 * Perform complete risk assessment for a potential trade
 *
 * This is the main entry point for risk evaluation. It combines
 * factor identification, score calculation, and size recommendation.
 *
 * @param data - Risk input data containing market conditions
 * @returns Complete risk assessment with score, factors, and size multiplier
 *
 * @example
 * ```typescript
 * const risk = assessRisk({
 *   trend: { direction: "BULLISH", strength: 7, ... },
 *   regime: { type: "TRENDING", volatility: "NORMAL", atrRatio: 1.2, volumeRatio: 1.1 },
 *   signals: [{ type: "MACD_CROSS_BULL", strength: "STRONG", direction: "LONG", ... }],
 *   rsi: 55,
 *   distanceToResistancePct: 2.5,
 *   distanceToSupportPct: 1.8,
 *   proposedDirection: "LONG"
 * });
 * // Returns: { score: 3, factors: [], counterTrend: false, sizeMultiplier: 1.0 }
 * ```
 */
export function assessRisk(data: RiskInputData): RiskAssessment {
  // Step 1: Identify all risk factors
  const factors = identifyRiskFactors(data);

  // Step 2: Calculate risk score
  const score = calculateRiskScore(factors);

  // Step 3: Determine if counter-trend
  const counterTrend = data.proposedDirection
    ? isCounterTrend(data.trend.direction, data.proposedDirection)
    : false;

  // Step 4: Calculate position size multiplier
  const sizeMultiplier = calculateSizeMultiplier(score, factors);

  return {
    score,
    factors,
    counterTrend,
    sizeMultiplier,
  };
}
