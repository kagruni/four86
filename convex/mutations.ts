import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Create or update bot configuration
export const upsertBotConfig = mutation({
  args: {
    userId: v.string(),
    modelName: v.string(),
    isActive: v.boolean(),
    startingCapital: v.number(),
    symbols: v.array(v.string()),
    maxLeverage: v.number(),
    maxPositionSize: v.number(),
    stopLossEnabled: v.boolean(),
    maxDailyLoss: v.number(),
    minAccountValue: v.number(),
    hyperliquidPrivateKey: v.string(),
    hyperliquidAddress: v.string(),
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
