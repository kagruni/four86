import { action, mutation, internalMutation, internalQuery, query } from "../_generated/server";
import { api, internal } from "../fnRefs";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { DEFAULT_HYBRID_SELECTION_RULES } from "../trading/hybridSelectionConfig";

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
    disableHybridSelection: v.optional(v.boolean()),
    hybridScoreFloorOverride: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"backtestRuns">> => {
    // Get user credentials for API key
    const [credentials, botConfig] = await Promise.all([
      ctx.runQuery(internal.queries.getFullUserCredentials, {
        userId: args.userId,
      }),
      ctx.runQuery(api.queries.getBotConfig, {
        userId: args.userId,
      }),
    ]);

    if (!credentials?.openrouterApiKey) {
      throw new Error("OpenRouter API key required for backtesting");
    }

    const effectiveModelName = botConfig?.modelName ?? args.modelName;
    const effectiveTradingPromptMode =
      botConfig?.tradingPromptMode ?? args.tradingPromptMode;
    const effectiveInitialCapital =
      botConfig?.currentCapital ??
      botConfig?.startingCapital ??
      args.initialCapital;
    const effectiveMaxLeverage = botConfig?.maxLeverage ?? args.maxLeverage;
    const effectiveTradingIntervalMinutes = botConfig?.tradingIntervalMinutes ?? 5;
    const botIsActive = botConfig?.isActive ?? false;
    const liveUseHybridSelection = botConfig?.useHybridSelection ?? false;
    const liveHybridScoreFloor =
      botConfig?.hybridScoreFloor ?? DEFAULT_HYBRID_SELECTION_RULES.hybridScoreFloor;
    const sanitizedHybridScoreFloorOverride =
      args.hybridScoreFloorOverride != null
        ? Math.max(0, Math.min(100, args.hybridScoreFloorOverride))
        : undefined;
    const effectiveUseHybridSelection = args.disableHybridSelection
      ? false
      : liveUseHybridSelection;
    const effectiveHybridScoreFloor = effectiveUseHybridSelection
      ? sanitizedHybridScoreFloorOverride ?? liveHybridScoreFloor
      : undefined;
    const overrideSummary = args.disableHybridSelection
      ? "Backtest override: hybrid selection disabled"
      : sanitizedHybridScoreFloorOverride != null
        ? `Backtest override: hybrid score floor ${sanitizedHybridScoreFloorOverride}`
        : undefined;
    const effectiveSymbols =
      (botConfig?.symbols ?? []).filter(
        (symbol: string) => !(credentials.hyperliquidTestnet && symbol === "XRP")
      ) || [];
    const basketSymbols = effectiveSymbols.length > 0 ? effectiveSymbols : [args.symbol];
    const runSymbol =
      basketSymbols.length === 1 ? basketSymbols[0] : `BASKET (${basketSymbols.length})`;

    // Create the backtest run record
    const runId = await ctx.runMutation(
      internal.backtesting.backtestActions.createBacktestRun,
      {
        userId: args.userId,
        symbol: runSymbol,
        symbols: basketSymbols,
        startDate: args.startDate,
        endDate: args.endDate,
        modelName: effectiveModelName,
        tradingPromptMode: effectiveTradingPromptMode,
        initialCapital: effectiveInitialCapital,
        maxLeverage: effectiveMaxLeverage,
        tradingIntervalMinutes: effectiveTradingIntervalMinutes,
        botIsActive,
        effectiveHybridScoreFloor,
        overrideSummary,
        useHybridSelection: effectiveUseHybridSelection,
        enableRegimeFilter: botConfig?.enableRegimeFilter ?? true,
        require1hAlignment: botConfig?.require1hAlignment ?? true,
        redDayLongBlockPct: botConfig?.redDayLongBlockPct ?? -1.5,
        greenDayShortBlockPct: botConfig?.greenDayShortBlockPct ?? 1.5,
        reentryCooldownMinutes: botConfig?.reentryCooldownMinutes ?? 15,
        hybridScoreFloor: effectiveHybridScoreFloor,
        hybridFourHourTrendThresholdPct: botConfig?.hybridFourHourTrendThresholdPct,
        hybridExtremeRsi7Block: botConfig?.hybridExtremeRsi7Block,
        hybridMinChopVolumeRatio: botConfig?.hybridMinChopVolumeRatio,
        hybridChopDistanceFromEmaPct: botConfig?.hybridChopDistanceFromEmaPct,
      }
    );

    // Start the backtest engine asynchronously
    await ctx.scheduler.runAfter(
      0,
      internal.backtesting.backtestEngine.runBacktest,
      {
        runId,
        userId: args.userId,
        symbol: runSymbol,
        symbols: basketSymbols,
        startDate: args.startDate,
        endDate: args.endDate,
        modelName: effectiveModelName,
        tradingPromptMode: effectiveTradingPromptMode,
        initialCapital: effectiveInitialCapital,
        maxLeverage: effectiveMaxLeverage,
        tradingIntervalMinutes: effectiveTradingIntervalMinutes,
        maxPositionSize: botConfig?.maxPositionSize ?? 10,
        maxDailyLoss: botConfig?.maxDailyLoss ?? 5,
        minAccountValue: botConfig?.minAccountValue ?? 100,
        perTradeRiskPct: botConfig?.perTradeRiskPct ?? 2.0,
        maxTotalPositions: botConfig?.maxTotalPositions ?? 3,
        maxSameDirectionPositions: botConfig?.maxSameDirectionPositions ?? 2,
        consecutiveLossLimit: botConfig?.consecutiveLossLimit ?? 3,
        tradingMode: botConfig?.tradingMode ?? "balanced",
        minEntryConfidence: botConfig?.minEntryConfidence ?? 0.6,
        minRiskRewardRatio: botConfig?.minRiskRewardRatio ?? 2.0,
        stopOutCooldownHours: botConfig?.stopOutCooldownHours ?? 6,
        minEntrySignals: botConfig?.minEntrySignals ?? 2,
        require4hAlignment: botConfig?.require4hAlignment ?? false,
        tradeVolatileMarkets: botConfig?.tradeVolatileMarkets ?? true,
        volatilitySizeReduction: botConfig?.volatilitySizeReduction ?? 30,
        stopLossAtrMultiplier: botConfig?.stopLossAtrMultiplier ?? 1.5,
        useHybridSelection: effectiveUseHybridSelection,
        enableRegimeFilter: botConfig?.enableRegimeFilter ?? true,
        require1hAlignment: botConfig?.require1hAlignment ?? true,
        redDayLongBlockPct: botConfig?.redDayLongBlockPct ?? -1.5,
        greenDayShortBlockPct: botConfig?.greenDayShortBlockPct ?? 1.5,
        reentryCooldownMinutes: botConfig?.reentryCooldownMinutes ?? 15,
        hybridScoreFloor: effectiveHybridScoreFloor,
        hybridFourHourTrendThresholdPct: botConfig?.hybridFourHourTrendThresholdPct,
        hybridExtremeRsi7Block: botConfig?.hybridExtremeRsi7Block,
        hybridMinChopVolumeRatio: botConfig?.hybridMinChopVolumeRatio,
        hybridChopDistanceFromEmaPct: botConfig?.hybridChopDistanceFromEmaPct,
        managedExitEnabled: botConfig?.managedExitEnabled ?? false,
        managedExitHardStopLossPct: botConfig?.managedExitHardStopLossPct,
        managedExitBreakEvenTriggerPct:
          botConfig?.managedExitBreakEvenTriggerPct,
        managedExitBreakEvenLockProfitPct:
          botConfig?.managedExitBreakEvenLockProfitPct,
        managedExitTrailingTriggerPct:
          botConfig?.managedExitTrailingTriggerPct,
        managedExitTrailingDistancePct:
          botConfig?.managedExitTrailingDistancePct,
        managedExitTightenTriggerPct:
          botConfig?.managedExitTightenTriggerPct,
        managedExitTightenedDistancePct:
          botConfig?.managedExitTightenedDistancePct,
        managedExitStaleMinutes: botConfig?.managedExitStaleMinutes,
        managedExitStaleMinProfitPct: botConfig?.managedExitStaleMinProfitPct,
        managedExitMaxHoldMinutes: botConfig?.managedExitMaxHoldMinutes,
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
    symbols: v.optional(v.array(v.string())),
    startDate: v.number(),
    endDate: v.number(),
    modelName: v.string(),
    tradingPromptMode: v.string(),
    initialCapital: v.number(),
    maxLeverage: v.number(),
    tradingIntervalMinutes: v.optional(v.number()),
    botIsActive: v.optional(v.boolean()),
    effectiveHybridScoreFloor: v.optional(v.number()),
    overrideSummary: v.optional(v.string()),
    useHybridSelection: v.optional(v.boolean()),
    enableRegimeFilter: v.optional(v.boolean()),
    require1hAlignment: v.optional(v.boolean()),
    redDayLongBlockPct: v.optional(v.number()),
    greenDayShortBlockPct: v.optional(v.number()),
    reentryCooldownMinutes: v.optional(v.number()),
    hybridScoreFloor: v.optional(v.number()),
    hybridFourHourTrendThresholdPct: v.optional(v.number()),
    hybridExtremeRsi7Block: v.optional(v.number()),
    hybridMinChopVolumeRatio: v.optional(v.number()),
    hybridChopDistanceFromEmaPct: v.optional(v.number()),
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
    fundingPaid: v.optional(v.number()),
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
    totalFees: v.optional(v.number()),
    totalFunding: v.optional(v.number()),
    liquidationCount: v.optional(v.number()),
    aiInvocationCount: v.optional(v.number()),
    forcedHoldCount: v.optional(v.number()),
    diagnosticSummary: v.optional(v.string()),
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
