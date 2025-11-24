/**
 * Divergence Detection Module
 *
 * Detects bullish and bearish divergences between price action and technical indicators.
 * A divergence occurs when price and an indicator move in opposite directions, often
 * signaling a potential trend reversal.
 *
 * Bullish Divergence: Price makes lower low, indicator makes higher low
 * Bearish Divergence: Price makes higher high, indicator makes lower high
 */

import type {
  Divergence,
  DivergenceType,
  DivergenceIndicator,
  SignalStrength,
} from "./types";

/** Minimum number of candles required for divergence detection */
const MIN_CANDLES = 5;

/** Default lookback period for pattern detection */
const DEFAULT_LOOKBACK = 5;

/**
 * Main function to detect divergences across multiple indicators.
 * Checks for both RSI and MACD divergences against price action.
 *
 * @param priceHistory - Array of historical prices (most recent last)
 * @param rsiHistory - Array of historical RSI values (most recent last)
 * @param macdHistory - Array of historical MACD values (most recent last)
 * @returns Array of detected divergences
 */
export function detectDivergences(
  priceHistory: number[],
  rsiHistory: number[],
  macdHistory: number[]
): Divergence[] {
  const divergences: Divergence[] = [];

  // Check for RSI divergence
  const rsiDivergence = detectRSIDivergence(priceHistory, rsiHistory);
  if (rsiDivergence) {
    divergences.push(rsiDivergence);
  }

  // Check for MACD divergence
  const macdDivergence = detectMACDDivergence(priceHistory, macdHistory);
  if (macdDivergence) {
    divergences.push(macdDivergence);
  }

  return divergences;
}

/**
 * Detects RSI divergence against price action.
 *
 * Bullish RSI Divergence: Price makes lower low while RSI makes higher low
 * Bearish RSI Divergence: Price makes higher high while RSI makes lower high
 *
 * @param priceHistory - Array of historical prices (most recent last)
 * @param rsiHistory - Array of historical RSI values (most recent last)
 * @returns Divergence object if detected, null otherwise
 */
export function detectRSIDivergence(
  priceHistory: number[],
  rsiHistory: number[]
): Divergence | null {
  // Need minimum candles for both price and indicator
  if (priceHistory.length < MIN_CANDLES || rsiHistory.length < MIN_CANDLES) {
    return null;
  }

  // Check for bullish divergence: Price LL + RSI HL
  if (isLowerLow(priceHistory) && isHigherLow(rsiHistory)) {
    const priceDelta = calculatePriceDelta(priceHistory);
    const indicatorDelta = calculateIndicatorDelta(rsiHistory);

    return {
      type: "BULLISH",
      indicator: "RSI",
      strength: calculateDivergenceStrength(priceDelta, indicatorDelta),
      description: `Bullish RSI divergence: Price made lower low while RSI made higher low, suggesting potential reversal upward`,
    };
  }

  // Check for bearish divergence: Price HH + RSI LH
  if (isHigherHigh(priceHistory) && isLowerHigh(rsiHistory)) {
    const priceDelta = calculatePriceDelta(priceHistory);
    const indicatorDelta = calculateIndicatorDelta(rsiHistory);

    return {
      type: "BEARISH",
      indicator: "RSI",
      strength: calculateDivergenceStrength(priceDelta, indicatorDelta),
      description: `Bearish RSI divergence: Price made higher high while RSI made lower high, suggesting potential reversal downward`,
    };
  }

  return null;
}

/**
 * Detects MACD divergence against price action.
 *
 * Bullish MACD Divergence: Price makes lower low while MACD makes higher low
 * Bearish MACD Divergence: Price makes higher high while MACD makes lower high
 *
 * @param priceHistory - Array of historical prices (most recent last)
 * @param macdHistory - Array of historical MACD values (most recent last)
 * @returns Divergence object if detected, null otherwise
 */
export function detectMACDDivergence(
  priceHistory: number[],
  macdHistory: number[]
): Divergence | null {
  // Need minimum candles for both price and indicator
  if (priceHistory.length < MIN_CANDLES || macdHistory.length < MIN_CANDLES) {
    return null;
  }

  // Check for bullish divergence: Price LL + MACD HL
  if (isLowerLow(priceHistory) && isHigherLow(macdHistory)) {
    const priceDelta = calculatePriceDelta(priceHistory);
    const indicatorDelta = calculateIndicatorDelta(macdHistory);

    return {
      type: "BULLISH",
      indicator: "MACD",
      strength: calculateDivergenceStrength(priceDelta, indicatorDelta),
      description: `Bullish MACD divergence: Price made lower low while MACD made higher low, suggesting potential reversal upward`,
    };
  }

  // Check for bearish divergence: Price HH + MACD LH
  if (isHigherHigh(priceHistory) && isLowerHigh(macdHistory)) {
    const priceDelta = calculatePriceDelta(priceHistory);
    const indicatorDelta = calculateIndicatorDelta(macdHistory);

    return {
      type: "BEARISH",
      indicator: "MACD",
      strength: calculateDivergenceStrength(priceDelta, indicatorDelta),
      description: `Bearish MACD divergence: Price made higher high while MACD made lower high, suggesting potential reversal downward`,
    };
  }

  return null;
}

/**
 * Checks if recent values form a lower low pattern.
 * A lower low occurs when the most recent low is lower than a previous low.
 *
 * @param values - Array of values (most recent last)
 * @param lookback - Number of candles to look back (default: 5)
 * @returns true if a lower low pattern is detected
 */
export function isLowerLow(
  values: number[],
  lookback: number = DEFAULT_LOOKBACK
): boolean {
  if (values.length < lookback) {
    return false;
  }

  // Get the relevant window of values
  const window = values.slice(-lookback);

  // Find local lows (troughs) in the window
  const lows = findLocalLows(window);

  // Need at least 2 lows to compare
  if (lows.length < 2) {
    return false;
  }

  // Check if the most recent low is lower than the previous low
  const recentLow = lows[lows.length - 1];
  const previousLow = lows[lows.length - 2];

  return recentLow.value < previousLow.value;
}

/**
 * Checks if recent values form a higher low pattern.
 * A higher low occurs when the most recent low is higher than a previous low.
 *
 * @param values - Array of values (most recent last)
 * @param lookback - Number of candles to look back (default: 5)
 * @returns true if a higher low pattern is detected
 */
export function isHigherLow(
  values: number[],
  lookback: number = DEFAULT_LOOKBACK
): boolean {
  if (values.length < lookback) {
    return false;
  }

  // Get the relevant window of values
  const window = values.slice(-lookback);

  // Find local lows (troughs) in the window
  const lows = findLocalLows(window);

  // Need at least 2 lows to compare
  if (lows.length < 2) {
    return false;
  }

  // Check if the most recent low is higher than the previous low
  const recentLow = lows[lows.length - 1];
  const previousLow = lows[lows.length - 2];

  return recentLow.value > previousLow.value;
}

/**
 * Checks if recent values form a higher high pattern.
 * A higher high occurs when the most recent high is higher than a previous high.
 *
 * @param values - Array of values (most recent last)
 * @param lookback - Number of candles to look back (default: 5)
 * @returns true if a higher high pattern is detected
 */
export function isHigherHigh(
  values: number[],
  lookback: number = DEFAULT_LOOKBACK
): boolean {
  if (values.length < lookback) {
    return false;
  }

  // Get the relevant window of values
  const window = values.slice(-lookback);

  // Find local highs (peaks) in the window
  const highs = findLocalHighs(window);

  // Need at least 2 highs to compare
  if (highs.length < 2) {
    return false;
  }

  // Check if the most recent high is higher than the previous high
  const recentHigh = highs[highs.length - 1];
  const previousHigh = highs[highs.length - 2];

  return recentHigh.value > previousHigh.value;
}

/**
 * Checks if recent values form a lower high pattern.
 * A lower high occurs when the most recent high is lower than a previous high.
 *
 * @param values - Array of values (most recent last)
 * @param lookback - Number of candles to look back (default: 5)
 * @returns true if a lower high pattern is detected
 */
export function isLowerHigh(
  values: number[],
  lookback: number = DEFAULT_LOOKBACK
): boolean {
  if (values.length < lookback) {
    return false;
  }

  // Get the relevant window of values
  const window = values.slice(-lookback);

  // Find local highs (peaks) in the window
  const highs = findLocalHighs(window);

  // Need at least 2 highs to compare
  if (highs.length < 2) {
    return false;
  }

  // Check if the most recent high is lower than the previous high
  const recentHigh = highs[highs.length - 1];
  const previousHigh = highs[highs.length - 2];

  return recentHigh.value < previousHigh.value;
}

/**
 * Calculates the strength of a divergence based on the magnitude of price
 * and indicator movements.
 *
 * @param priceDelta - Absolute percentage change in price
 * @param indicatorDelta - Absolute change in indicator value
 * @returns SignalStrength classification
 */
export function calculateDivergenceStrength(
  priceDelta: number,
  indicatorDelta: number
): SignalStrength {
  // Normalize the deltas to assess divergence strength
  // Price delta is already in percentage terms
  // For strong divergence, we expect >2% price move with opposite indicator movement

  const normalizedStrength = Math.abs(priceDelta) + Math.abs(indicatorDelta) / 10;

  if (normalizedStrength >= 4) {
    return "STRONG";
  } else if (normalizedStrength >= 2) {
    return "MODERATE";
  } else {
    return "WEAK";
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

interface LocalExtreme {
  index: number;
  value: number;
}

/**
 * Finds local lows (troughs) in an array of values.
 * A local low is a value that is lower than its neighbors.
 *
 * @param values - Array of values
 * @returns Array of local lows with their indices
 */
function findLocalLows(values: number[]): LocalExtreme[] {
  const lows: LocalExtreme[] = [];

  // Check first value if it's lower than second
  if (values.length >= 2 && values[0] <= values[1]) {
    lows.push({ index: 0, value: values[0] });
  }

  // Check middle values
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] <= values[i - 1] && values[i] <= values[i + 1]) {
      lows.push({ index: i, value: values[i] });
    }
  }

  // Check last value if it's lower than second-to-last
  if (values.length >= 2 && values[values.length - 1] <= values[values.length - 2]) {
    lows.push({ index: values.length - 1, value: values[values.length - 1] });
  }

  return lows;
}

/**
 * Finds local highs (peaks) in an array of values.
 * A local high is a value that is higher than its neighbors.
 *
 * @param values - Array of values
 * @returns Array of local highs with their indices
 */
function findLocalHighs(values: number[]): LocalExtreme[] {
  const highs: LocalExtreme[] = [];

  // Check first value if it's higher than second
  if (values.length >= 2 && values[0] >= values[1]) {
    highs.push({ index: 0, value: values[0] });
  }

  // Check middle values
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] >= values[i - 1] && values[i] >= values[i + 1]) {
      highs.push({ index: i, value: values[i] });
    }
  }

  // Check last value if it's higher than second-to-last
  if (values.length >= 2 && values[values.length - 1] >= values[values.length - 2]) {
    highs.push({ index: values.length - 1, value: values[values.length - 1] });
  }

  return highs;
}

/**
 * Calculates the percentage price delta between recent lows or highs.
 *
 * @param prices - Array of price values
 * @returns Percentage change between recent extreme points
 */
function calculatePriceDelta(prices: number[]): number {
  if (prices.length < 2) {
    return 0;
  }

  const window = prices.slice(-DEFAULT_LOOKBACK);
  const min = Math.min(...window);
  const max = Math.max(...window);
  const avgPrice = (min + max) / 2;

  if (avgPrice === 0) {
    return 0;
  }

  return ((max - min) / avgPrice) * 100;
}

/**
 * Calculates the indicator delta between recent lows or highs.
 *
 * @param indicators - Array of indicator values
 * @returns Absolute change between recent extreme points
 */
function calculateIndicatorDelta(indicators: number[]): number {
  if (indicators.length < 2) {
    return 0;
  }

  const window = indicators.slice(-DEFAULT_LOOKBACK);
  const min = Math.min(...window);
  const max = Math.max(...window);

  return Math.abs(max - min);
}
