/**
 * Technical Indicators Module
 *
 * Provides real-time calculations for trading indicators:
 * - RSI (Relative Strength Index)
 * - MACD (Moving Average Convergence Divergence)
 * - EMA (Exponential Moving Average)
 * - ATR (Average True Range)
 * - Price Change %
 */

/**
 * Calculate Exponential Moving Average (EMA)
 *
 * @param prices - Array of closing prices (oldest to newest)
 * @param period - Number of periods for the EMA (default: 20)
 * @returns EMA value or -1 if insufficient data
 *
 * @example
 * const prices = [100, 102, 101, 103, 105, ...];
 * const ema20 = calculateEMA(prices, 20);
 */
export function calculateEMA(prices: number[], period: number = 20): number {
  if (!prices || prices.length < period) {
    return -1;
  }

  // Calculate SMA for the first EMA value
  const sma = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

  // Smoothing factor
  const multiplier = 2 / (period + 1);

  // Calculate EMA
  let ema = sma;
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate Relative Strength Index (RSI)
 *
 * Measures momentum on a scale of 0-100.
 * - RSI > 70: Overbought
 * - RSI < 30: Oversold
 *
 * @param prices - Array of closing prices (oldest to newest)
 * @param period - Number of periods for RSI calculation (default: 14)
 * @returns RSI value (0-100) or -1 if insufficient data
 *
 * @example
 * const prices = [100, 102, 101, 103, 105, ...];
 * const rsi = calculateRSI(prices, 14);
 * if (rsi > 70) console.log("Overbought");
 */
export function calculateRSI(prices: number[], period: number = 14): number {
  if (!prices || prices.length < period + 1) {
    return -1;
  }

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // Separate gains and losses
  let avgGain = 0;
  let avgLoss = 0;

  // Calculate initial averages
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      avgGain += changes[i];
    } else {
      avgLoss += Math.abs(changes[i]);
    }
  }
  avgGain /= period;
  avgLoss /= period;

  // Calculate smoothed averages
  for (let i = period; i < changes.length; i++) {
    if (changes[i] > 0) {
      avgGain = (avgGain * (period - 1) + changes[i]) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(changes[i])) / period;
    }
  }

  // Avoid division by zero
  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 *
 * MACD Line = 12-period EMA - 26-period EMA
 * Signal Line = 9-period EMA of MACD Line
 * Histogram = MACD Line - Signal Line
 *
 * @param prices - Array of closing prices (oldest to newest)
 * @param fastPeriod - Fast EMA period (default: 12)
 * @param slowPeriod - Slow EMA period (default: 26)
 * @param signalPeriod - Signal EMA period (default: 9)
 * @returns Object with macd, signal, and histogram values
 *
 * @example
 * const prices = [100, 102, 101, 103, 105, ...];
 * const { macd, signal, histogram } = calculateMACD(prices);
 * if (macd > signal) console.log("Bullish crossover");
 */
export function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number; signal: number; histogram: number } {
  // Need at least slowPeriod + signalPeriod data points
  const minLength = slowPeriod + signalPeriod;

  if (!prices || prices.length < minLength) {
    return { macd: -1, signal: -1, histogram: -1 };
  }

  // Calculate EMAs for MACD line
  const ema12 = calculateEMAValues(prices, fastPeriod);
  const ema26 = calculateEMAValues(prices, slowPeriod);

  // Calculate MACD line values
  const macdLine: number[] = [];
  for (let i = 0; i < Math.min(ema12.length, ema26.length); i++) {
    macdLine.push(ema12[i] - ema26[i]);
  }

  // Calculate signal line (9-period EMA of MACD line)
  const signalLine = calculateEMAValues(macdLine, signalPeriod);

  if (macdLine.length === 0 || signalLine.length === 0) {
    return { macd: -1, signal: -1, histogram: -1 };
  }

  // Get the most recent values
  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

/**
 * Helper function to calculate EMA values for all data points
 * Used internally by MACD calculation
 *
 * @param prices - Array of prices
 * @param period - EMA period
 * @returns Array of EMA values
 */
function calculateEMAValues(prices: number[], period: number): number[] {
  if (!prices || prices.length < period) {
    return [];
  }

  const emaValues: number[] = [];

  // Calculate initial SMA
  const sma = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

  // Smoothing factor
  const multiplier = 2 / (period + 1);

  // First EMA value
  let ema = sma;
  emaValues.push(ema);

  // Calculate remaining EMA values
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
    emaValues.push(ema);
  }

  return emaValues;
}

/**
 * Calculate price change percentage over a period
 *
 * @param prices - Array of closing prices (oldest to newest)
 * @param periods - Number of periods to look back (default: 1)
 * @returns Percentage change or 0 if insufficient data
 *
 * @example
 * const prices = [100, 102, 101, 103, 105];
 * const shortChange = calculatePriceChange(prices, 1); // 1.94% ((105-103)/103)
 * const mediumChange = calculatePriceChange(prices, 4); // 5% ((105-100)/100)
 */
export function calculatePriceChange(prices: number[], periods: number = 1): number {
  if (!prices || prices.length < periods + 1) {
    return 0;
  }

  const currentPrice = prices[prices.length - 1];
  const oldPrice = prices[prices.length - 1 - periods];

  if (oldPrice === 0) {
    return 0;
  }

  return ((currentPrice - oldPrice) / oldPrice) * 100;
}

/**
 * Calculate Average True Range (ATR)
 *
 * ATR measures market volatility by decomposing the entire range of an asset price for that period.
 * Higher ATR = Higher volatility
 *
 * @param candles - Array of OHLC candles (must have h, l, c properties)
 * @param period - Number of periods for ATR calculation (default: 14)
 * @returns ATR value or 0 if insufficient data
 *
 * @example
 * const candles = [{ h: 105, l: 100, c: 103 }, ...];
 * const atr14 = calculateATR(candles, 14);
 */
export function calculateATR(
  candles: Array<{ h: number; l: number; c: number }>,
  period: number = 14
): number {
  if (!candles || candles.length < period + 1) {
    return 0;
  }

  const trueRanges: number[] = [];

  // Calculate True Range for each candle
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].h;
    const low = candles[i].l;
    const prevClose = candles[i - 1].c;

    // True Range = max(high - low, |high - prev_close|, |low - prev_close|)
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    trueRanges.push(tr);
  }

  if (trueRanges.length < period) {
    return 0;
  }

  // Calculate initial ATR as simple average of first 'period' true ranges
  let atr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;

  // Calculate smoothed ATR for remaining periods
  // ATR = ((Prior ATR * (period - 1)) + Current TR) / period
  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
  }

  return atr;
}

/**
 * Validate if we have sufficient data for all indicators
 *
 * @param dataLength - Number of data points available
 * @returns Object indicating which indicators can be calculated
 */
export function validateDataSufficiency(dataLength: number): {
  canCalculateRSI: boolean;
  canCalculateMACD: boolean;
  canCalculateEMA20: boolean;
  canCalculateEMA50: boolean;
  canCalculateATR: boolean;
  minimumRequired: number;
} {
  return {
    canCalculateRSI: dataLength >= 15, // 14 + 1 for changes
    canCalculateMACD: dataLength >= 35, // 26 + 9
    canCalculateEMA20: dataLength >= 20,
    canCalculateEMA50: dataLength >= 50,
    canCalculateATR: dataLength >= 15, // 14 + 1 for TR
    minimumRequired: 50, // Recommended minimum for all indicators
  };
}
