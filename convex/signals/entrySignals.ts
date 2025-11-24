/**
 * Entry Signal Detection Module
 *
 * Detects entry signals based on technical indicators and price action.
 * All functions are pure TypeScript with no external dependencies.
 */

import {
  EntrySignal,
  EntrySignalType,
  SignalStrength,
  SignalDirection,
} from "./types";

// =============================================================================
// INPUT DATA TYPE
// =============================================================================

/**
 * Input data required for signal detection
 */
export interface SignalInputData {
  /** Current price of the asset */
  currentPrice: number;
  /** 20-period exponential moving average */
  ema20: number;
  /** Recent price history (oldest to newest) */
  priceHistory: number[];
  /** Current RSI (14-period) */
  rsi14: number;
  /** RSI history (oldest to newest) */
  rsi14History: number[];
  /** Current MACD value */
  macd: number;
  /** MACD history (oldest to newest) */
  macdHistory: number[];
  /** Current MACD signal line */
  macdSignal: number;
  /** Volume relative to average (1.0 = average) */
  volumeRatio: number;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if values are rising over the last N periods
 * @param values - Array of values (oldest to newest)
 * @param periods - Number of periods to check (default: 2)
 * @returns True if values are consistently rising
 */
export function isRising(values: number[], periods: number = 2): boolean {
  if (values.length < periods + 1) {
    return false;
  }

  const recentValues = values.slice(-periods - 1);
  for (let i = 1; i < recentValues.length; i++) {
    if (recentValues[i] <= recentValues[i - 1]) {
      return false;
    }
  }
  return true;
}

/**
 * Check if values are falling over the last N periods
 * @param values - Array of values (oldest to newest)
 * @param periods - Number of periods to check (default: 2)
 * @returns True if values are consistently falling
 */
export function isFalling(values: number[], periods: number = 2): boolean {
  if (values.length < periods + 1) {
    return false;
  }

  const recentValues = values.slice(-periods - 1);
  for (let i = 1; i < recentValues.length; i++) {
    if (recentValues[i] >= recentValues[i - 1]) {
      return false;
    }
  }
  return true;
}

/**
 * Classify signal strength based on thresholds
 * @param value - The value to classify
 * @param thresholds - Object with weak, moderate, and strong thresholds
 * @returns Signal strength classification
 */
export function classifySignalStrength(
  value: number,
  thresholds: { weak: number; moderate: number; strong: number }
): SignalStrength {
  if (value >= thresholds.strong) {
    return "STRONG";
  } else if (value >= thresholds.moderate) {
    return "MODERATE";
  }
  return "WEAK";
}

/**
 * Sort signals by strength (STRONG first, then MODERATE, then WEAK)
 */
function sortByStrength(signals: EntrySignal[]): EntrySignal[] {
  const strengthOrder: Record<SignalStrength, number> = {
    STRONG: 0,
    MODERATE: 1,
    WEAK: 2,
  };

  return signals.sort(
    (a, b) => strengthOrder[a.strength] - strengthOrder[b.strength]
  );
}

// =============================================================================
// RSI SIGNAL DETECTION
// =============================================================================

/**
 * Detect RSI-based entry signals
 * @param rsi - Current RSI value
 * @param rsiHistory - RSI history (oldest to newest)
 * @returns Array of detected RSI signals
 */
export function detectRSISignals(
  rsi: number,
  rsiHistory: number[]
): EntrySignal[] {
  const signals: EntrySignal[] = [];
  const fullHistory = [...rsiHistory, rsi];

  // RSI_OVERSOLD: RSI < 30 and rising (potential long entry)
  if (rsi < 30 && isRising(fullHistory, 2)) {
    const strength = classifySignalStrength(30 - rsi, {
      weak: 2,
      moderate: 5,
      strong: 10,
    });
    signals.push({
      type: "RSI_OVERSOLD",
      strength,
      direction: "LONG",
      description: `RSI at ${rsi.toFixed(1)} (oversold) and rising - potential reversal`,
    });
  }

  // RSI_OVERBOUGHT: RSI > 70 and falling (potential short entry)
  if (rsi > 70 && isFalling(fullHistory, 2)) {
    const strength = classifySignalStrength(rsi - 70, {
      weak: 2,
      moderate: 5,
      strong: 10,
    });
    signals.push({
      type: "RSI_OVERBOUGHT",
      strength,
      direction: "SHORT",
      description: `RSI at ${rsi.toFixed(1)} (overbought) and falling - potential reversal`,
    });
  }

  // RSI_MOMENTUM_BULL: RSI crosses above 50
  if (fullHistory.length >= 2) {
    const prevRsi = fullHistory[fullHistory.length - 2];
    if (prevRsi < 50 && rsi >= 50) {
      const strength = classifySignalStrength(rsi - 50, {
        weak: 1,
        moderate: 3,
        strong: 5,
      });
      signals.push({
        type: "RSI_MOMENTUM_BULL",
        strength,
        direction: "LONG",
        description: `RSI crossed above 50 (${prevRsi.toFixed(1)} -> ${rsi.toFixed(1)}) - bullish momentum shift`,
      });
    }

    // RSI_MOMENTUM_BEAR: RSI crosses below 50
    if (prevRsi > 50 && rsi <= 50) {
      const strength = classifySignalStrength(50 - rsi, {
        weak: 1,
        moderate: 3,
        strong: 5,
      });
      signals.push({
        type: "RSI_MOMENTUM_BEAR",
        strength,
        direction: "SHORT",
        description: `RSI crossed below 50 (${prevRsi.toFixed(1)} -> ${rsi.toFixed(1)}) - bearish momentum shift`,
      });
    }
  }

  return signals;
}

// =============================================================================
// MACD SIGNAL DETECTION
// =============================================================================

/**
 * Detect MACD-based entry signals
 * @param macd - Current MACD value
 * @param macdHistory - MACD history (oldest to newest)
 * @param macdSignal - Current MACD signal line
 * @returns Array of detected MACD signals
 */
export function detectMACDSignals(
  macd: number,
  macdHistory: number[],
  macdSignal: number
): EntrySignal[] {
  const signals: EntrySignal[] = [];

  if (macdHistory.length < 1) {
    return signals;
  }

  const prevMacd = macdHistory[macdHistory.length - 1];
  const macdDiff = macd - macdSignal;
  const prevMacdDiff = prevMacd - macdSignal;

  // MACD_CROSS_BULL: MACD crosses above signal (was below, now above)
  if (prevMacdDiff < 0 && macdDiff >= 0) {
    const crossStrength = Math.abs(macdDiff);
    const strength = classifySignalStrength(crossStrength, {
      weak: 0.5,
      moderate: 2,
      strong: 5,
    });
    signals.push({
      type: "MACD_CROSS_BULL",
      strength,
      direction: "LONG",
      description: `MACD crossed above signal line - bullish crossover`,
    });
  }

  // MACD_CROSS_BEAR: MACD crosses below signal
  if (prevMacdDiff > 0 && macdDiff <= 0) {
    const crossStrength = Math.abs(macdDiff);
    const strength = classifySignalStrength(crossStrength, {
      weak: 0.5,
      moderate: 2,
      strong: 5,
    });
    signals.push({
      type: "MACD_CROSS_BEAR",
      strength,
      direction: "SHORT",
      description: `MACD crossed below signal line - bearish crossover`,
    });
  }

  return signals;
}

// =============================================================================
// EMA SIGNAL DETECTION
// =============================================================================

/**
 * Detect EMA-based breakout signals
 * @param price - Current price
 * @param ema20 - 20-period EMA
 * @param priceHistory - Price history (oldest to newest)
 * @param volumeRatio - Volume relative to average
 * @returns Array of detected EMA signals
 */
export function detectEMASignals(
  price: number,
  ema20: number,
  priceHistory: number[],
  volumeRatio: number
): EntrySignal[] {
  const signals: EntrySignal[] = [];

  if (priceHistory.length < 1) {
    return signals;
  }

  const prevPrice = priceHistory[priceHistory.length - 1];
  const volumeThreshold = 1.2;

  // EMA_BREAKOUT_BULL: Price crosses above EMA20 with volume > 1.2x
  if (prevPrice < ema20 && price >= ema20 && volumeRatio >= volumeThreshold) {
    const breakoutStrength = ((price - ema20) / ema20) * 100;
    const strength = classifySignalStrength(breakoutStrength, {
      weak: 0.1,
      moderate: 0.3,
      strong: 0.5,
    });
    signals.push({
      type: "EMA_BREAKOUT_BULL",
      strength,
      direction: "LONG",
      description: `Price broke above EMA20 with ${volumeRatio.toFixed(1)}x volume`,
    });
  }

  // EMA_BREAKOUT_BEAR: Price crosses below EMA20 with volume > 1.2x
  if (prevPrice > ema20 && price <= ema20 && volumeRatio >= volumeThreshold) {
    const breakoutStrength = ((ema20 - price) / ema20) * 100;
    const strength = classifySignalStrength(breakoutStrength, {
      weak: 0.1,
      moderate: 0.3,
      strong: 0.5,
    });
    signals.push({
      type: "EMA_BREAKOUT_BEAR",
      strength,
      direction: "SHORT",
      description: `Price broke below EMA20 with ${volumeRatio.toFixed(1)}x volume`,
    });
  }

  return signals;
}

// =============================================================================
// PRICE ACTION SIGNAL DETECTION
// =============================================================================

/**
 * Detect price action-based signals (higher lows, lower highs)
 * @param priceHistory - Price history (oldest to newest)
 * @returns Array of detected price action signals
 */
export function detectPriceActionSignals(
  priceHistory: number[]
): EntrySignal[] {
  const signals: EntrySignal[] = [];

  // Need at least 5 candles to detect patterns
  if (priceHistory.length < 5) {
    return signals;
  }

  // Find local lows and highs in recent price action
  const recentPrices = priceHistory.slice(-5);
  const lows: number[] = [];
  const highs: number[] = [];

  // Simple swing detection: compare each point to neighbors
  for (let i = 1; i < recentPrices.length - 1; i++) {
    const prev = recentPrices[i - 1];
    const curr = recentPrices[i];
    const next = recentPrices[i + 1];

    if (curr < prev && curr < next) {
      lows.push(curr);
    }
    if (curr > prev && curr > next) {
      highs.push(curr);
    }
  }

  // HIGHER_LOW: Last two lows show higher low formation
  if (lows.length >= 2) {
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];
    if (lastLow > prevLow) {
      const improvement = ((lastLow - prevLow) / prevLow) * 100;
      const strength = classifySignalStrength(improvement, {
        weak: 0.1,
        moderate: 0.3,
        strong: 0.5,
      });
      signals.push({
        type: "HIGHER_LOW",
        strength,
        direction: "LONG",
        description: `Higher low formation detected (${improvement.toFixed(2)}% improvement)`,
      });
    }
  }

  // LOWER_HIGH: Last two highs show lower high formation
  if (highs.length >= 2) {
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    if (lastHigh < prevHigh) {
      const decline = ((prevHigh - lastHigh) / prevHigh) * 100;
      const strength = classifySignalStrength(decline, {
        weak: 0.1,
        moderate: 0.3,
        strong: 0.5,
      });
      signals.push({
        type: "LOWER_HIGH",
        strength,
        direction: "SHORT",
        description: `Lower high formation detected (${decline.toFixed(2)}% decline)`,
      });
    }
  }

  return signals;
}

// =============================================================================
// VOLUME SIGNAL DETECTION
// =============================================================================

/**
 * Detect volume-based signals
 * @param volumeRatio - Volume relative to average (1.0 = average)
 * @returns Array of detected volume signals
 */
export function detectVolumeSignals(volumeRatio: number): EntrySignal[] {
  const signals: EntrySignal[] = [];
  const spikeThreshold = 1.5;

  // VOLUME_SPIKE: Volume > 1.5x average
  if (volumeRatio >= spikeThreshold) {
    const strength = classifySignalStrength(volumeRatio, {
      weak: 1.5,
      moderate: 2.0,
      strong: 2.5,
    });

    // Volume spike is direction-neutral; it amplifies other signals
    // Default to LONG as it's more commonly a confirmation of breakouts
    signals.push({
      type: "VOLUME_SPIKE",
      strength,
      direction: "LONG", // Neutral signal, but must pick direction
      description: `Volume spike at ${volumeRatio.toFixed(1)}x average - increased interest`,
    });
  }

  return signals;
}

// =============================================================================
// MAIN DETECTION FUNCTION
// =============================================================================

/**
 * Detect all entry signals from the provided market data
 * @param data - Signal input data containing all required indicators
 * @returns Array of entry signals sorted by strength (STRONG first)
 */
export function detectEntrySignals(data: SignalInputData): EntrySignal[] {
  const allSignals: EntrySignal[] = [];

  // Detect RSI signals
  const rsiSignals = detectRSISignals(data.rsi14, data.rsi14History);
  allSignals.push(...rsiSignals);

  // Detect MACD signals
  const macdSignals = detectMACDSignals(
    data.macd,
    data.macdHistory,
    data.macdSignal
  );
  allSignals.push(...macdSignals);

  // Detect EMA signals
  const emaSignals = detectEMASignals(
    data.currentPrice,
    data.ema20,
    data.priceHistory,
    data.volumeRatio
  );
  allSignals.push(...emaSignals);

  // Detect price action signals
  const priceActionSignals = detectPriceActionSignals(data.priceHistory);
  allSignals.push(...priceActionSignals);

  // Detect volume signals
  const volumeSignals = detectVolumeSignals(data.volumeRatio);
  allSignals.push(...volumeSignals);

  // Sort by strength (STRONG first)
  return sortByStrength(allSignals);
}
