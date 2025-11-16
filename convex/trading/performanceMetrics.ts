import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * Performance metrics for the trading bot
 */
export interface PerformanceMetrics {
  totalReturnPct: number;
  sharpeRatio: number;
  invocationCount: number;
  minutesSinceStart: number;
}

/**
 * Get performance metrics for a user's trading bot
 *
 * Calculates:
 * - Total return percentage: (currentCapital - startingCapital) / startingCapital * 100
 * - Sharpe ratio: Annualized measure of risk-adjusted returns
 * - Invocation count: Number of AI trading decisions made
 * - Minutes since start: Time elapsed since bot was created
 */
export const getPerformanceMetrics = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<PerformanceMetrics> => {
    const now = Date.now();

    // Get bot configuration
    const botConfig = await ctx.db
      .query("botConfig")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    // Default metrics if no bot config exists
    if (!botConfig) {
      return {
        totalReturnPct: 0,
        sharpeRatio: 0,
        invocationCount: 0,
        minutesSinceStart: 0,
      };
    }

    // Calculate total return percentage
    const totalReturnPct = botConfig.startingCapital > 0
      ? ((botConfig.currentCapital - botConfig.startingCapital) / botConfig.startingCapital) * 100
      : 0;

    // Calculate minutes since start
    const minutesSinceStart = Math.floor((now - botConfig.createdAt) / (1000 * 60));

    // Get AI invocation count
    const aiLogs = await ctx.db
      .query("aiLogs")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const invocationCount = aiLogs.length;

    // Calculate Sharpe ratio from trade history
    const sharpeRatio = await calculateSharpeRatio(ctx, args.userId);

    return {
      totalReturnPct,
      sharpeRatio,
      invocationCount,
      minutesSinceStart,
    };
  },
});

/**
 * Calculate Sharpe ratio from trade history
 *
 * Sharpe Ratio = (Mean Return) / (Std Dev of Returns) * sqrt(periods per year)
 *
 * For trading bot that runs every 3 minutes:
 * - Periods per year = 365 * 24 * 60 / 3 = 175,200 periods
 * - We use sqrt(175200) ≈ 418.57 for annualization
 *
 * Returns 0 if:
 * - Less than 2 closed trades (need at least 2 data points for std dev)
 * - Standard deviation is 0 (no variance in returns)
 */
async function calculateSharpeRatio(
  ctx: any,
  userId: string
): Promise<number> {
  // Get all closed trades with PnL data
  const trades = await ctx.db
    .query("trades")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .filter((q: any) =>
      q.and(
        q.eq(q.field("action"), "CLOSE"),
        q.neq(q.field("pnlPct"), undefined)
      )
    )
    .collect();

  // Need at least 2 trades to calculate standard deviation
  if (trades.length < 2) {
    return 0;
  }

  // Extract returns (pnlPct values)
  const returns = trades
    .map((trade: any) => trade.pnlPct)
    .filter((pnl: number | undefined): pnl is number => typeof pnl === "number");

  if (returns.length < 2) {
    return 0;
  }

  // Calculate mean return
  const meanReturn = returns.reduce((sum: number, r: number) => sum + r, 0) / returns.length;

  // Calculate variance
  const variance = returns.reduce((sum: number, r: number) => {
    const diff = r - meanReturn;
    return sum + (diff * diff);
  }, 0) / returns.length;

  // Calculate standard deviation
  const stdDev = Math.sqrt(variance);

  // Avoid division by zero
  if (stdDev === 0) {
    return 0;
  }

  // Annualization factor for 3-minute trading intervals
  // Trading bot runs every 3 minutes = 20 times per hour = 480 times per day
  // Periods per year = 480 * 365 = 175,200
  // Annualization factor = sqrt(175,200) ≈ 418.57
  const annualizationFactor = Math.sqrt(175200);

  // Calculate Sharpe ratio
  const sharpeRatio = (meanReturn / stdDev) * annualizationFactor;

  // Return rounded to 2 decimal places
  return Math.round(sharpeRatio * 100) / 100;
}
