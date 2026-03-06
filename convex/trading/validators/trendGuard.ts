/**
 * Trend Guard
 *
 * Safety net that blocks counter-trend trades.
 * Uses trend analysis to prevent opening positions against strong trends.
 */

import {
  calculateTrendDirection,
  calculateTrendStrength,
} from "../../signals/trendAnalysis";
import { createLogger } from "../logger";
import type { DecisionContext } from "../decisionContext";

export interface TrendGuardResult {
  allowed: boolean;
  reason: string;
  trendDirection?: string;
  trendStrength?: number;
}

/**
 * Check if a trade aligns with the current trend.
 * Blocks trades that go against a strong trend (strength >= 6/10).
 *
 * @param ctx - Convex action context
 * @param api - Convex API reference
 * @param decision - The AI trading decision
 * @param credentials - User credentials (for testnet flag)
 * @param userId - For logging
 * @returns Result indicating if the trade is allowed
 */
export async function checkTrendGuard(
  decision: any,
  userId: string,
  decisionContext: DecisionContext
): Promise<TrendGuardResult> {
  const log = createLogger("TREND_GUARD", undefined, userId);

  // Only check for OPEN decisions
  if (decision.decision !== "OPEN_LONG" && decision.decision !== "OPEN_SHORT") {
    return { allowed: true, reason: "Not an open trade — trend guard skipped" };
  }

  const snapshot = decisionContext.marketSnapshot.symbols[decision.symbol!];
  if (!snapshot || snapshot.currentPrice <= 0) {
    return { allowed: true, reason: "No market data available — trend guard skipped" };
  }

  const trendDirection = calculateTrendDirection(
    snapshot.intraday.priceVsEma20Pct,
    snapshot.fourHour.ema20VsEma50Pct
  );
  const trendStrength = calculateTrendStrength(
    snapshot.intraday.priceVsEma20Pct,
    snapshot.fourHour.ema20VsEma50Pct,
    snapshot.intraday.rsi14
  );

  // Block strong counter-trend trades
  const isCounterTrend =
    (decision.decision === "OPEN_LONG" && trendDirection === "BEARISH" && trendStrength >= 6) ||
    (decision.decision === "OPEN_SHORT" && trendDirection === "BULLISH" && trendStrength >= 6);

  if (isCounterTrend) {
    log.warn(`Blocking ${decision.decision} on ${decision.symbol}`, {
      reason: `Strong ${trendDirection} trend`,
      strength: trendStrength,
      priceVsEma20Pct: snapshot.intraday.priceVsEma20Pct,
    });

    return {
      allowed: false,
      reason: `Strong ${trendDirection} trend (strength: ${trendStrength}/10)`,
      trendDirection,
      trendStrength,
    };
  }

  log.info(`Trade aligned with ${trendDirection} trend (strength: ${trendStrength}/10)`);

  return {
    allowed: true,
    reason: `Aligned with ${trendDirection} trend`,
    trendDirection,
    trendStrength,
  };
}
