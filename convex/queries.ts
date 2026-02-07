import { query, internalQuery } from "./_generated/server";
import { v } from "convex/values";

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

// Internal query to get all positions (for position sync cron)
export const getAllPositionsForSync = internalQuery({
  handler: async (ctx) => {
    return await ctx.db.query("positions").collect();
  },
});

/**
 * Get recent trading actions (OPEN/CLOSE only, skip HOLD)
 * Used for AI context to remember recent decisions and outcomes
 * Returns last N actions with concise info for prompt injection
 */
export const getRecentTradingActions = internalQuery({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 5;

    const actions = await ctx.db
      .query("aiLogs")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .filter((q) =>
        q.or(
          q.eq(q.field("decision"), "OPEN_LONG"),
          q.eq(q.field("decision"), "OPEN_SHORT"),
          q.eq(q.field("decision"), "CLOSE")
        )
      )
      .take(limit);

    // Get corresponding trades to find outcomes (P&L)
    const tradesMap = new Map();
    const trades = await ctx.db
      .query("trades")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit * 2); // Get more trades to ensure we find matches

    trades.forEach(trade => {
      const key = `${trade.symbol}_${trade.executedAt}`;
      tradesMap.set(key, trade);
    });

    return actions.map(action => {
      const timestamp = new Date(action.createdAt).toISOString().slice(11, 16); // HH:MM
      const parsedResponse = action.parsedResponse as any;
      const symbol = parsedResponse?.symbol || "";

      // Find matching trade for P&L info
      let pnl = null;
      let pnlPct = null;
      for (const trade of trades) {
        if (
          trade.symbol === symbol &&
          Math.abs(trade.executedAt - action.createdAt) < 5000 // Within 5 seconds
        ) {
          pnl = trade.pnl;
          pnlPct = trade.pnlPct;
          break;
        }
      }

      return {
        timestamp,
        decision: action.decision,
        symbol,
        reasoning: action.reasoning,
        confidence: action.confidence || 0,
        pnl,
        pnlPct,
      };
    });
  },
});


// Get latest market research/sentiment data
export const getLatestMarketResearch = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("marketResearch")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .first();
  },
});

// Internal: Get latest market research (for trading loop)
export const getLatestMarketResearchInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("marketResearch")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .first();
  },
});

// Check if trading lock exists for user
export const getTradingLock = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Get active lock (not expired)
    const lock = await ctx.db
      .query("tradingLocks")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.gt(q.field("expiresAt"), now))
      .first();
    
    return lock;
  },
});
