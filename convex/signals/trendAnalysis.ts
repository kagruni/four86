/**
 * Trend Analysis Module
 *
 * Analyzes market trends and momentum from technical indicators.
 * Processes DetailedCoinData to produce TrendAnalysis summaries
 * for the AI trading prompt.
 */

import type {
  TrendAnalysis,
  TrendDirection,
  MomentumState,
} from "./types";
import type { DetailedCoinData } from "../hyperliquid/detailedMarketData";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate the slope of a series using simple linear regression.
 * Used to detect momentum direction in indicator history.
 *
 * @param values - Array of numeric values (e.g., RSI history)
 * @returns Slope of the best-fit line (positive = increasing, negative = decreasing)
 */
export function calculateSlope(values: number[]): number {
  // Handle edge cases
  if (!values || values.length < 2) {
    return 0;
  }

  // Filter out NaN/undefined values
  const cleanValues = values.filter((v) => !isNaN(v) && v !== undefined);
  if (cleanValues.length < 2) {
    return 0;
  }

  const n = cleanValues.length;

  // Calculate means
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += cleanValues[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  // Calculate slope using least squares formula:
  // slope = sum((x - meanX)(y - meanY)) / sum((x - meanX)^2)
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const xDiff = i - meanX;
    const yDiff = cleanValues[i] - meanY;
    numerator += xDiff * yDiff;
    denominator += xDiff * xDiff;
  }

  // Avoid division by zero
  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

/**
 * Calculate percentage difference between two values.
 *
 * @param value - The value to compare
 * @param reference - The reference value (denominator)
 * @returns Percentage difference (positive = value above reference)
 */
function calculatePercentageDiff(value: number, reference: number): number {
  if (reference === 0 || isNaN(reference) || isNaN(value)) {
    return 0;
  }
  return ((value - reference) / reference) * 100;
}

// =============================================================================
// TREND DIRECTION
// =============================================================================

/**
 * Determine overall trend direction based on EMA alignment.
 *
 * Logic:
 * - BULLISH: Price > EMA20 by >0.5% AND EMA20 > EMA50 by >0.5%
 * - BEARISH: Price < EMA20 by >0.5% AND EMA20 < EMA50 by >0.5%
 * - NEUTRAL: Mixed signals or small deviations
 *
 * @param priceVsEma20Pct - Price position relative to EMA20 (percentage)
 * @param ema20VsEma50Pct - EMA20 position relative to EMA50 4h (percentage)
 * @returns Trend direction classification
 */
export function calculateTrendDirection(
  priceVsEma20Pct: number,
  ema20VsEma50Pct: number
): TrendDirection {
  const threshold = 0.5; // 0.5% threshold for trend confirmation

  // Both indicators must agree and exceed threshold
  if (priceVsEma20Pct > threshold && ema20VsEma50Pct > threshold) {
    return "BULLISH";
  }

  if (priceVsEma20Pct < -threshold && ema20VsEma50Pct < -threshold) {
    return "BEARISH";
  }

  return "NEUTRAL";
}

// =============================================================================
// TREND STRENGTH
// =============================================================================

/**
 * Calculate trend strength on a 1-10 scale.
 *
 * Factors considered:
 * 1. EMA alignment strength (how far apart the EMAs are)
 * 2. RSI position (confirms trend direction)
 * 3. Momentum consistency (alignment of multiple indicators)
 *
 * @param priceVsEma20Pct - Price position relative to EMA20 (percentage)
 * @param ema20VsEma50Pct - EMA20 position relative to EMA50 4h (percentage)
 * @param rsi - Current RSI value (0-100)
 * @returns Trend strength score (1-10)
 */
export function calculateTrendStrength(
  priceVsEma20Pct: number,
  ema20VsEma50Pct: number,
  rsi: number
): number {
  // Handle invalid inputs
  if (isNaN(priceVsEma20Pct) || isNaN(ema20VsEma50Pct) || isNaN(rsi)) {
    return 1;
  }

  let score = 0;

  // Factor 1: EMA alignment strength (0-4 points)
  // Stronger separation = stronger trend
  const absEmaAlignment = Math.abs(priceVsEma20Pct) + Math.abs(ema20VsEma50Pct);
  if (absEmaAlignment >= 3) {
    score += 4;
  } else if (absEmaAlignment >= 2) {
    score += 3;
  } else if (absEmaAlignment >= 1) {
    score += 2;
  } else if (absEmaAlignment >= 0.5) {
    score += 1;
  }

  // Factor 2: RSI position confirms trend (0-3 points)
  // Bullish: RSI > 50 with higher values = stronger
  // Bearish: RSI < 50 with lower values = stronger
  const isBullishEma = priceVsEma20Pct > 0 && ema20VsEma50Pct > 0;
  const isBearishEma = priceVsEma20Pct < 0 && ema20VsEma50Pct < 0;

  if (isBullishEma && rsi > 50) {
    // RSI confirms bullish trend
    if (rsi >= 65) {
      score += 3;
    } else if (rsi >= 55) {
      score += 2;
    } else {
      score += 1;
    }
  } else if (isBearishEma && rsi < 50) {
    // RSI confirms bearish trend
    if (rsi <= 35) {
      score += 3;
    } else if (rsi <= 45) {
      score += 2;
    } else {
      score += 1;
    }
  }
  // No points if RSI contradicts trend direction

  // Factor 3: Momentum consistency (0-3 points)
  // Both price vs EMA20 and EMA20 vs EMA50 should be in same direction
  const bothPositive = priceVsEma20Pct > 0 && ema20VsEma50Pct > 0;
  const bothNegative = priceVsEma20Pct < 0 && ema20VsEma50Pct < 0;

  if (bothPositive || bothNegative) {
    // Aligned trend
    const ratio = Math.min(
      Math.abs(priceVsEma20Pct),
      Math.abs(ema20VsEma50Pct)
    ) / Math.max(Math.abs(priceVsEma20Pct), Math.abs(ema20VsEma50Pct) || 1);

    if (ratio >= 0.7) {
      score += 3; // Strong alignment
    } else if (ratio >= 0.4) {
      score += 2; // Moderate alignment
    } else {
      score += 1; // Weak alignment
    }
  }
  // No points for mixed signals

  // Ensure score is in 1-10 range
  return Math.max(1, Math.min(10, score));
}

// =============================================================================
// MOMENTUM DETECTION
// =============================================================================

/**
 * Detect momentum state from RSI history.
 *
 * Logic:
 * - ACCELERATING: RSI slope > 0.5 (momentum increasing)
 * - DECELERATING: RSI slope < -0.5 (momentum decreasing)
 * - STEADY: RSI slope between -0.5 and 0.5
 *
 * @param rsiHistory - Array of recent RSI values
 * @returns Momentum state classification
 */
export function detectMomentum(rsiHistory: number[]): MomentumState {
  // Handle edge cases
  if (!rsiHistory || rsiHistory.length < 2) {
    return "STEADY";
  }

  const slope = calculateSlope(rsiHistory);
  const threshold = 0.5; // RSI points per period

  if (slope > threshold) {
    return "ACCELERATING";
  }

  if (slope < -threshold) {
    return "DECELERATING";
  }

  return "STEADY";
}

// =============================================================================
// MAIN ANALYSIS FUNCTION
// =============================================================================

/**
 * Perform complete trend analysis on coin data.
 *
 * Combines EMA analysis, RSI momentum, and timeframe alignment
 * to produce a comprehensive TrendAnalysis object for the AI prompt.
 *
 * @param data - Detailed coin data with technical indicators
 * @returns Complete trend analysis summary
 */
export function analyzeTrend(data: DetailedCoinData): TrendAnalysis {
  // Handle missing/invalid data
  if (!data || data.currentPrice === 0) {
    return {
      direction: "NEUTRAL",
      strength: 1,
      momentum: "STEADY",
      timeframeAlignment: false,
      priceVsEma20Pct: 0,
      ema20VsEma50Pct: 0,
    };
  }

  // Calculate percentage differences
  const priceVsEma20Pct = calculatePercentageDiff(data.currentPrice, data.ema20);
  const ema20VsEma50Pct = calculatePercentageDiff(data.ema20_4h, data.ema50_4h);

  // Determine trend direction
  const direction = calculateTrendDirection(priceVsEma20Pct, ema20VsEma50Pct);

  // Calculate trend strength
  const strength = calculateTrendStrength(
    priceVsEma20Pct,
    ema20VsEma50Pct,
    data.rsi14
  );

  // Detect momentum state from RSI history
  const momentum = detectMomentum(data.rsi14History);

  // Check timeframe alignment (2-min trend aligned with 4-hour trend)
  // Price vs EMA20 (2min) should match EMA20 vs EMA50 (4h) direction
  const intradayBullish = priceVsEma20Pct > 0;
  const fourHourBullish = ema20VsEma50Pct > 0;
  const timeframeAlignment = intradayBullish === fourHourBullish;

  return {
    direction,
    strength,
    momentum,
    timeframeAlignment,
    priceVsEma20Pct: Math.round(priceVsEma20Pct * 100) / 100, // Round to 2 decimal places
    ema20VsEma50Pct: Math.round(ema20VsEma50Pct * 100) / 100,
  };
}
