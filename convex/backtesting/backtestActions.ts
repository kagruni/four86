import { action, mutation, internalMutation, internalQuery, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

/**
 * Start a new backtest run
 */
export const startBacktest = action({
  args: {
    userId: v.string(),
    symbol: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    modelName: v.string(),
    tradingPromptMode: v.string(),
    initialCapital: v.number(),
    maxLeverage: v.number(),
  },
  handler: async (ctx, args) => {
    // Get user credentials for API key
    const credentials = await ctx.runQuery(
      internal.queries.getFullUserCredentials,
      {
        userId: args.userId,
      }
    );

    if (!credentials?.openrouterApiKey) {
      throw new Error("OpenRouter API key required for backtesting");
    }

    // Create the backtest run record
    const runId = await ctx.runMutation(
      internal.backtesting.backtestActions.createBacktestRun,
      {
        userId: args.userId,
        symbol: args.symbol,
        startDate: args.startDate,
        endDate: args.endDate,
        modelName: args.modelName,
        tradingPromptMode: args.tradingPromptMode,
        initialCapital: args.initialCapital,
        maxLeverage: args.maxLeverage,
      }
    );

    // Start the backtest engine asynchronously
    await ctx.scheduler.runAfter(
      0,
      internal.backtesting.backtestEngine.runBacktest,
      {
        runId,
        userId: args.userId,
        symbol: args.symbol,
        startDate: args.startDate,
        endDate: args.endDate,
        modelName: args.modelName,
        tradingPromptMode: args.tradingPromptMode,
        initialCapital: args.initialCapital,
        maxLeverage: args.maxLeverage,
        openrouterApiKey: credentials.openrouterApiKey,
        testnet: credentials.hyperliquidTestnet,
      }
    );

    return runId;
  },
});

/**
 * Internal: Create a backtest run record
 */
export const createBacktestRun = internalMutation({
  args: {
    userId: v.string(),
    symbol: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    modelName: v.string(),
    tradingPromptMode: v.string(),
    initialCapital: v.number(),
    maxLeverage: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("backtestRuns", {
      ...args,
      status: "running",
      createdAt: Date.now(),
    });
  },
});

/**
 * Internal: Save a simulated trade
 */
export const saveBacktestTrade = internalMutation({
  args: {
    runId: v.id("backtestRuns"),
    userId: v.string(),
    symbol: v.string(),
    action: v.string(),
    side: v.string(),
    entryPrice: v.number(),
    exitPrice: v.optional(v.number()),
    size: v.number(),
    leverage: v.number(),
    pnl: v.optional(v.number()),
    pnlPct: v.optional(v.number()),
    exitReason: v.optional(v.string()),
    confidence: v.optional(v.number()),
    reasoning: v.optional(v.string()),
    entryTime: v.number(),
    exitTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Verify run still exists before inserting
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    return await ctx.db.insert("backtestTrades", args);
  },
});

/**
 * Internal: Mark a backtest run as completed
 */
export const completeBacktestRun = internalMutation({
  args: {
    runId: v.id("backtestRuns"),
    totalPnl: v.number(),
    totalPnlPct: v.number(),
    winRate: v.number(),
    totalTrades: v.number(),
    maxDrawdown: v.number(),
    maxDrawdownPct: v.number(),
    sharpeRatio: v.number(),
    finalCapital: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const { runId, ...results } = args;
    const run = await ctx.db.get(runId);
    if (!run) return; // Run was deleted, nothing to update
    await ctx.db.patch(runId, {
      status: "completed",
      ...results,
      completedAt: Date.now(),
    });
  },
});

/**
 * Internal: Mark a backtest run as failed
 */
export const failBacktestRun = internalMutation({
  args: {
    runId: v.id("backtestRuns"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return; // Run was deleted, nothing to update
    await ctx.db.patch(args.runId, {
      status: "failed",
      error: args.error,
      completedAt: Date.now(),
    });
  },
});

/**
 * Cancel a running backtest
 */
export const cancelBacktest = mutation({
  args: { runId: v.id("backtestRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Backtest run not found");
    if (run.status !== "running") return;

    await ctx.db.patch(args.runId, {
      status: "cancelled",
      error: "Cancelled by user",
      completedAt: Date.now(),
    });
  },
});

/**
 * Delete a backtest run and all its trades
 */
export const deleteBacktest = mutation({
  args: { runId: v.id("backtestRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Backtest run not found");
    if (run.status === "running") {
      throw new Error("Cannot delete a running backtest — cancel it first");
    }

    // Delete all associated trades
    const trades = await ctx.db
      .query("backtestTrades")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .collect();

    for (const trade of trades) {
      await ctx.db.delete(trade._id);
    }

    // Delete the run itself
    await ctx.db.delete(args.runId);
  },
});

/**
 * Internal: Update live progress during a running backtest
 */
export const updateBacktestProgress = internalMutation({
  args: {
    runId: v.id("backtestRuns"),
    currentCapital: v.number(),
    currentTrades: v.number(),
    progressPct: v.number(),
  },
  handler: async (ctx, args) => {
    const { runId, ...progress } = args;
    const run = await ctx.db.get(runId);
    if (!run) return; // Run was deleted, nothing to update
    await ctx.db.patch(runId, progress);
  },
});

/**
 * Internal: Check if a backtest has been cancelled
 */
export const isBacktestCancelled = internalQuery({
  args: { runId: v.id("backtestRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    return run?.status === "cancelled";
  },
});

/**
 * Get all backtest runs for a user
 */
export const getBacktestRuns = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("backtestRuns")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(20);
  },
});

/**
 * Get a specific backtest run with its trades
 */
export const getBacktestResults = query({
  args: { runId: v.id("backtestRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;

    const trades = await ctx.db
      .query("backtestTrades")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .collect();

    return { ...run, trades };
  },
});
