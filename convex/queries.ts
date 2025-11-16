import { query, internalQuery, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

// Get user credentials (NEVER return private keys to frontend - use internal queries)
export const getUserCredentials = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const credentials = await ctx.db
      .query("userCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!credentials) {
      return null;
    }

    // Return sanitized version (no private keys exposed to frontend)
    return {
      _id: credentials._id,
      userId: credentials.userId,
      hasZhipuaiApiKey: !!credentials.zhipuaiApiKey,
      hasOpenrouterApiKey: !!credentials.openrouterApiKey,
      hasHyperliquidPrivateKey: !!credentials.hyperliquidPrivateKey,
      hyperliquidAddress: credentials.hyperliquidAddress,
      hyperliquidTestnet: credentials.hyperliquidTestnet,
      createdAt: credentials.createdAt,
      updatedAt: credentials.updatedAt,
    };
  },
});

// Check if user has set up credentials
export const hasCredentials = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const credentials = await ctx.db
      .query("userCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    return !!credentials;
  },
});

// Get bot configuration for current user
export const getBotConfig = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("botConfig")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

// Get all active bots (for cron jobs)
export const getActiveBots = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("botConfig")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

// Get current positions
export const getPositions = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("positions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

// Get recent trades
export const getRecentTrades = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    return await ctx.db
      .query("trades")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
  },
});

// Get recent AI logs
export const getRecentAILogs = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;
    return await ctx.db
      .query("aiLogs")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
  },
});

// Get account snapshots
export const getAccountSnapshots = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;
    return await ctx.db
      .query("accountSnapshots")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
  },
});

// Internal query to get full credentials (for trading loop only)
export const getFullUserCredentials = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("userCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

// Get live positions with real-time prices from Hyperliquid
export const getLivePositions = action({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    // Get stored positions from database
    const positions = await ctx.runQuery(api.queries.getPositions, {
      userId: args.userId,
    });

    if (!positions || positions.length === 0) {
      return [];
    }

    // Get bot config to determine testnet
    const botConfig = await ctx.runQuery(api.queries.getBotConfig, {
      userId: args.userId,
    });

    const testnet = botConfig?.hyperliquidTestnet ?? true;

    // Get unique symbols from positions
    const symbols = [...new Set(positions.map((p) => p.symbol))];

    // Fetch live prices from Hyperliquid
    const marketData = await ctx.runAction(api.hyperliquid.client.getMarketData, {
      symbols,
      testnet,
    });

    // Update positions with live prices and calculate real-time P&L
    const livePositions = positions.map((position) => {
      const livePrice = marketData[position.symbol]?.price || position.currentPrice;

      // Calculate real-time P&L
      let unrealizedPnl = 0;
      if (position.side === "LONG") {
        unrealizedPnl = (livePrice - position.entryPrice) * position.size;
      } else {
        unrealizedPnl = (position.entryPrice - livePrice) * position.size;
      }

      const unrealizedPnlPct = (unrealizedPnl / (position.entryPrice * position.size)) * 100;

      return {
        ...position,
        currentPrice: livePrice,
        unrealizedPnl,
        unrealizedPnlPct,
      };
    });

    return livePositions;
  },
});
