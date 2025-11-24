/**
 * Support/Resistance Level Detection Module
 *
 * Detects key price levels including support, resistance, and pivot points
 * using swing high/low analysis and level clustering algorithms.
 */

import { KeyLevels } from "./types";

/**
 * Calculate the standard pivot point using the classic formula
 * @param high - High price of the period
 * @param low - Low price of the period
 * @param close - Close price of the period
 * @returns Pivot point value
 */
export function calculatePivotPoint(
  high: number,
  low: number,
  close: number
): number {
  return (high + low + close) / 3;
}

/**
 * Calculate the percentage distance from current price to a level
 * @param currentPrice - Current market price
 * @param level - Target price level
 * @returns Percentage distance (positive value)
 */
export function calculateDistanceToLevel(
  currentPrice: number,
  level: number
): number {
  if (currentPrice === 0) return 0;
  return Math.abs((level - currentPrice) / currentPrice) * 100;
}

/**
 * Find swing high points (local maxima) in a price array
 *
 * A swing high is a point where the price is higher than the surrounding
 * prices within the lookback period on both sides.
 *
 * @param prices - Array of price values
 * @param lookback - Number of candles to check on each side (default: 3)
 * @returns Array of swing high price values
 */
export function findSwingHighs(prices: number[], lookback: number = 3): number[] {
  const swingHighs: number[] = [];

  // Need at least (2 * lookback + 1) prices for a valid swing detection
  if (prices.length < 2 * lookback + 1) {
    return swingHighs;
  }

  // Iterate through potential swing points (excluding edges)
  for (let i = lookback; i < prices.length - lookback; i++) {
    const currentPrice = prices[i];
    let isSwingHigh = true;

    // Check all prices within lookback on both sides
    for (let j = 1; j <= lookback; j++) {
      // Price must be strictly greater than surrounding prices
      if (currentPrice <= prices[i - j] || currentPrice <= prices[i + j]) {
        isSwingHigh = false;
        break;
      }
    }

    if (isSwingHigh) {
      swingHighs.push(currentPrice);
    }
  }

  return swingHighs;
}

/**
 * Find swing low points (local minima) in a price array
 *
 * A swing low is a point where the price is lower than the surrounding
 * prices within the lookback period on both sides.
 *
 * @param prices - Array of price values
 * @param lookback - Number of candles to check on each side (default: 3)
 * @returns Array of swing low price values
 */
export function findSwingLows(prices: number[], lookback: number = 3): number[] {
  const swingLows: number[] = [];

  // Need at least (2 * lookback + 1) prices for a valid swing detection
  if (prices.length < 2 * lookback + 1) {
    return swingLows;
  }

  // Iterate through potential swing points (excluding edges)
  for (let i = lookback; i < prices.length - lookback; i++) {
    const currentPrice = prices[i];
    let isSwingLow = true;

    // Check all prices within lookback on both sides
    for (let j = 1; j <= lookback; j++) {
      // Price must be strictly less than surrounding prices
      if (currentPrice >= prices[i - j] || currentPrice >= prices[i + j]) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingLow) {
      swingLows.push(currentPrice);
    }
  }

  return swingLows;
}

/**
 * Cluster nearby price levels and return the strongest ones
 *
 * Levels that are within the threshold percentage are grouped together,
 * and the average of each cluster is returned. More frequently touched
 * levels (larger clusters) are considered stronger.
 *
 * @param levels - Array of price levels to cluster
 * @param currentPrice - Current market price (for filtering by direction)
 * @param direction - "above" for resistance, "below" for support
 * @param threshold - Percentage threshold for clustering (default: 0.3%)
 * @returns Array of up to 3 clustered levels, sorted by proximity to current price
 */
export function clusterLevels(
  levels: number[],
  currentPrice: number,
  direction: "above" | "below",
  threshold: number = 0.3
): number[] {
  if (levels.length === 0 || currentPrice === 0) {
    return [];
  }

  // Filter levels by direction relative to current price
  const filteredLevels = levels.filter((level) =>
    direction === "above" ? level > currentPrice : level < currentPrice
  );

  if (filteredLevels.length === 0) {
    return [];
  }

  // Sort levels for clustering
  const sortedLevels = [...filteredLevels].sort((a, b) => a - b);

  // Group levels into clusters based on threshold
  const clusters: number[][] = [];
  let currentCluster: number[] = [sortedLevels[0]];

  for (let i = 1; i < sortedLevels.length; i++) {
    const prevLevel = sortedLevels[i - 1];
    const currentLevel = sortedLevels[i];
    const percentDiff = Math.abs((currentLevel - prevLevel) / prevLevel) * 100;

    if (percentDiff <= threshold) {
      // Add to current cluster
      currentCluster.push(currentLevel);
    } else {
      // Start a new cluster
      clusters.push(currentCluster);
      currentCluster = [currentLevel];
    }
  }
  // Push the last cluster
  clusters.push(currentCluster);

  // Calculate the average level for each cluster and track cluster size
  const clusterAverages = clusters.map((cluster) => {
    const sum = cluster.reduce((acc, val) => acc + val, 0);
    return {
      level: sum / cluster.length,
      strength: cluster.length, // More levels in cluster = stronger level
    };
  });

  // Sort by strength (descending), then by proximity to current price
  clusterAverages.sort((a, b) => {
    // Primary sort: cluster strength (more levels = stronger)
    if (b.strength !== a.strength) {
      return b.strength - a.strength;
    }
    // Secondary sort: proximity to current price
    const distA = Math.abs(a.level - currentPrice);
    const distB = Math.abs(b.level - currentPrice);
    return distA - distB;
  });

  // Take top 3 strongest levels
  const topLevels = clusterAverages.slice(0, 3).map((c) => c.level);

  // Final sort by proximity to current price
  topLevels.sort((a, b) => {
    const distA = Math.abs(a - currentPrice);
    const distB = Math.abs(b - currentPrice);
    return distA - distB;
  });

  return topLevels;
}

/**
 * Detect key support and resistance levels from price history
 *
 * This is the main function that combines swing detection, level clustering,
 * and pivot point calculation to identify actionable price levels.
 *
 * @param priceHistory - Array of historical prices (oldest to newest)
 * @param currentPrice - Current market price
 * @param high24h - 24-hour high price
 * @param low24h - 24-hour low price
 * @returns KeyLevels object with support, resistance, and pivot data
 */
export function detectKeyLevels(
  priceHistory: number[],
  currentPrice: number,
  high24h: number,
  low24h: number
): KeyLevels {
  // Calculate pivot point using 24h data
  const pivotPoint = calculatePivotPoint(high24h, low24h, currentPrice);

  // Find swing points with different lookback periods for multi-timeframe analysis
  const swingHighs3 = findSwingHighs(priceHistory, 3);
  const swingHighs5 = findSwingHighs(priceHistory, 5);
  const swingLows3 = findSwingLows(priceHistory, 3);
  const swingLows5 = findSwingLows(priceHistory, 5);

  // Combine swing highs from different lookback periods
  const allSwingHighs = [...swingHighs3, ...swingHighs5, high24h];
  // Remove duplicates (within 0.1% of each other)
  const uniqueSwingHighs = removeDuplicateLevels(allSwingHighs, 0.1);

  // Combine swing lows from different lookback periods
  const allSwingLows = [...swingLows3, ...swingLows5, low24h];
  const uniqueSwingLows = removeDuplicateLevels(allSwingLows, 0.1);

  // Cluster levels to find significant resistance and support
  const resistance = clusterLevels(uniqueSwingHighs, currentPrice, "above");
  const support = clusterLevels(uniqueSwingLows, currentPrice, "below");

  // Calculate distances to nearest levels
  const distanceToResistancePct =
    resistance.length > 0
      ? calculateDistanceToLevel(currentPrice, resistance[0])
      : calculateDistanceToLevel(currentPrice, high24h);

  const distanceToSupportPct =
    support.length > 0
      ? calculateDistanceToLevel(currentPrice, support[0])
      : calculateDistanceToLevel(currentPrice, low24h);

  return {
    resistance,
    support,
    high24h,
    low24h,
    pivotPoint,
    distanceToResistancePct: Number(distanceToResistancePct.toFixed(2)),
    distanceToSupportPct: Number(distanceToSupportPct.toFixed(2)),
  };
}

/**
 * Remove duplicate levels that are within a threshold percentage of each other
 *
 * @param levels - Array of price levels
 * @param threshold - Percentage threshold for considering levels as duplicates
 * @returns Array with duplicates removed
 */
function removeDuplicateLevels(levels: number[], threshold: number): number[] {
  if (levels.length === 0) return [];

  const sorted = [...levels].sort((a, b) => a - b);
  const unique: number[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const lastUnique = unique[unique.length - 1];
    const percentDiff = Math.abs((sorted[i] - lastUnique) / lastUnique) * 100;

    if (percentDiff > threshold) {
      unique.push(sorted[i]);
    }
  }

  return unique;
}
