/**
 * Trend Guard
 *
 * Safety net that blocks counter-trend trades.
 * Uses trend analysis to prevent opening positions against strong trends.
 */

import { analyzeTrend } from "../../signals/trendAnalysis";
import { createLogger } from "../logger";
import type { GenericActionCtx } from "convex/server";

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
  ctx: any,
  api: any,
  decision: any,
  credentials: any,
  userId: string
): Promise<TrendGuardResult> {
  const log = createLogger("TREND_GUARD", undefined, userId);

  // Only check for OPEN decisions
  if (decision.decision !== "OPEN_LONG" && decision.decision !== "OPEN_SHORT") {
    return { allowed: true, reason: "Not an open trade — trend guard skipped" };
  }

  // Get market data for this symbol to analyze trend
  const detailedMarketData = await ctx.runAction(
    api.hyperliquid.detailedMarketData.getDetailedMarketData,
    {
      symbols: [decision.symbol!],
      testnet: credentials.hyperliquidTestnet,
    }
  );

  const coinData = detailedMarketData[decision.symbol!];
  if (!coinData || coinData.currentPrice <= 0) {
    return { allowed: true, reason: "No market data available — trend guard skipped" };
  }

  const trend = analyzeTrend(coinData);

  // Block strong counter-trend trades
  const isCounterTrend =
    (decision.decision === "OPEN_LONG" && trend.direction === "BEARISH" && trend.strength >= 6) ||
    (decision.decision === "OPEN_SHORT" && trend.direction === "BULLISH" && trend.strength >= 6);

  if (isCounterTrend) {
    log.warn(`Blocking ${decision.decision} on ${decision.symbol}`, {
      reason: `Strong ${trend.direction} trend`,
      strength: trend.strength,
      priceVsEma20Pct: trend.priceVsEma20Pct,
    });

    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId,
      level: "WARNING",
      message: `Trend guard blocked counter-trend trade: ${decision.decision} on ${decision.symbol}`,
      data: {
        decision: decision.decision,
        symbol: decision.symbol,
        trendDirection: trend.direction,
        trendStrength: trend.strength,
        priceVsEma20Pct: trend.priceVsEma20Pct,
      },
    });

    return {
      allowed: false,
      reason: `Strong ${trend.direction} trend (strength: ${trend.strength}/10)`,
      trendDirection: trend.direction,
      trendStrength: trend.strength,
    };
  }

  log.info(`Trade aligned with ${trend.direction} trend (strength: ${trend.strength}/10)`);

  return {
    allowed: true,
    reason: `Aligned with ${trend.direction} trend`,
    trendDirection: trend.direction,
    trendStrength: trend.strength,
  };
}
