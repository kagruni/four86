import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Save or update user credentials
export const saveUserCredentials = mutation({
  args: {
    userId: v.string(),
    zhipuaiApiKey: v.optional(v.string()),
    openrouterApiKey: v.optional(v.string()),
    hyperliquidPrivateKey: v.optional(v.string()),
    hyperliquidAddress: v.optional(v.string()),
    hyperliquidTestnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing credentials
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    } else {
      // Create new credentials
      return await ctx.db.insert("userCredentials", {
        ...args,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// Delete user credentials
export const deleteUserCredentials = mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const credentials = await ctx.db
      .query("userCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (credentials) {
      await ctx.db.delete(credentials._id);
    }
  },
});

// Create or update bot configuration (without credentials)
export const upsertBotConfig = mutation({
  args: {
    userId: v.string(),
    modelName: v.string(),
    isActive: v.boolean(),
    startingCapital: v.number(),
    symbols: v.array(v.string()),
    maxLeverage: v.number(),
    maxPositionSize: v.number(),
    maxDailyLoss: v.number(),
    minAccountValue: v.number(),

    // Tier 1: Essential Risk Controls (optional for backward compatibility)
    perTradeRiskPct: v.optional(v.number()),
    maxTotalPositions: v.optional(v.number()),
    maxSameDirectionPositions: v.optional(v.number()),
    consecutiveLossLimit: v.optional(v.number()),

    // Tier 2: Trading Behavior (optional for backward compatibility)
    tradingMode: v.optional(v.string()),
    minEntryConfidence: v.optional(v.number()),
    minRiskRewardRatio: v.optional(v.number()),
    stopOutCooldownHours: v.optional(v.number()),

    // Tier 3: Advanced (optional for backward compatibility)
    minEntrySignals: v.optional(v.number()),
    require4hAlignment: v.optional(v.boolean()),
    tradeVolatileMarkets: v.optional(v.boolean()),
    volatilitySizeReduction: v.optional(v.number()),
    stopLossAtrMultiplier: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("botConfig")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("botConfig", {
        ...args,
        currentCapital: args.startingCapital,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// Toggle bot active status
export const toggleBot = mutation({
  args: {
    userId: v.string(),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("botConfig")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (config) {
      await ctx.db.patch(config._id, {
        isActive: args.isActive,
        updatedAt: Date.now(),
      });
    }
  },
});

// Save trade
export const saveTrade = mutation({
  args: {
    userId: v.string(),
    symbol: v.string(),
    action: v.string(),
    side: v.string(),
    size: v.number(),
    leverage: v.number(),
    price: v.number(),
    pnl: v.optional(v.number()),
    pnlPct: v.optional(v.number()),
    aiReasoning: v.string(),
    aiModel: v.string(),
    confidence: v.optional(v.number()),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("trades", {
      ...args,
      executedAt: Date.now(),
    });
  },
});

// Save AI log
export const saveAILog = mutation({
  args: {
    userId: v.string(),
    modelName: v.string(),
    systemPrompt: v.string(),
    userPrompt: v.string(),
    rawResponse: v.string(),
    parsedResponse: v.optional(v.any()),
    decision: v.string(),
    reasoning: v.string(),
    confidence: v.optional(v.number()),
    accountValue: v.number(),
    marketData: v.any(),
    processingTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("aiLogs", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// Save or update position
export const savePosition = mutation({
  args: {
    userId: v.string(),
    symbol: v.string(),
    side: v.string(),
    size: v.number(),
    leverage: v.number(),
    entryPrice: v.number(),
    currentPrice: v.number(),
    unrealizedPnl: v.number(),
    unrealizedPnlPct: v.number(),
    stopLoss: v.optional(v.number()),
    takeProfit: v.optional(v.number()),
    liquidationPrice: v.number(),

    // Exit plan and invalidation
    invalidationCondition: v.optional(v.string()),
    entryReasoning: v.optional(v.string()),
    confidence: v.optional(v.number()),

    // Order tracking
    entryOrderId: v.optional(v.string()),
    takeProfitOrderId: v.optional(v.string()),
    stopLossOrderId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("positions")
      .withIndex("by_symbol", (q) =>
        q.eq("userId", args.userId).eq("symbol", args.symbol)
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        lastUpdated: now,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("positions", {
        ...args,
        openedAt: now,
        lastUpdated: now,
      });
    }
  },
});

// Close position
export const closePosition = mutation({
  args: {
    userId: v.string(),
    symbol: v.string(),
  },
  handler: async (ctx, args) => {
    const position = await ctx.db
      .query("positions")
      .withIndex("by_symbol", (q) =>
        q.eq("userId", args.userId).eq("symbol", args.symbol)
      )
      .first();

    if (position) {
      await ctx.db.delete(position._id);
    }
  },
});

// Sync positions with Hyperliquid (remove positions that don't exist on exchange)
export const syncPositions = mutation({
  args: {
    userId: v.string(),
    hyperliquidSymbols: v.array(v.string()), // Array of symbols that actually exist on Hyperliquid
  },
  handler: async (ctx, args) => {
    console.log(`[syncPositions] Syncing for user ${args.userId}`);
    console.log(`[syncPositions] Hyperliquid has positions: ${args.hyperliquidSymbols.join(", ") || "none"}`);

    // Get all database positions for this user
    const dbPositions = await ctx.db
      .query("positions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    console.log(`[syncPositions] Database has ${dbPositions.length} positions`);

    // Find positions in database that don't exist on Hyperliquid
    const positionsToRemove = dbPositions.filter(
      (dbPos) => !args.hyperliquidSymbols.includes(dbPos.symbol)
    );

    // Remove stale positions
    for (const position of positionsToRemove) {
      console.log(`[syncPositions] Removing stale position: ${position.symbol}`);
      await ctx.db.delete(position._id);
    }

    console.log(`[syncPositions] Removed ${positionsToRemove.length} stale positions`);
    console.log(`[syncPositions] Sync complete - ${dbPositions.length - positionsToRemove.length} positions remain`);
  },
});

// Save account snapshot
export const saveAccountSnapshot = mutation({
  args: {
    userId: v.string(),
    accountValue: v.number(),
    totalPnl: v.number(),
    totalPnlPct: v.number(),
    numTrades: v.number(),
    winRate: v.number(),
    positions: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("accountSnapshots", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

// Save system log
export const saveSystemLog = mutation({
  args: {
    userId: v.optional(v.string()),
    level: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("systemLogs", {
      ...args,
      timestamp: Date.now(),
    });
  },
});
