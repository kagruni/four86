import { query, internalQuery, action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";

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

    // Get user credentials to fetch from Hyperliquid
    const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
      userId: args.userId,
    });

    if (!credentials || !credentials.hyperliquidAddress) {
      return positions; // Return database positions if no credentials
    }

    const testnet = credentials.hyperliquidTestnet ?? true;

    // Get unique symbols from positions
    const symbols = [...new Set(positions.map((p) => p.symbol))];

    // Fetch live prices from Hyperliquid
    const marketData = await ctx.runAction(api.hyperliquid.client.getMarketData, {
      symbols,
      testnet,
    });

    // Fetch actual positions from Hyperliquid to get real leverage
    let hyperliquidPositions = [];
    try {
      hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
        address: credentials.hyperliquidAddress,
        testnet,
      });
    } catch (error) {
      console.error("[getLivePositions] Error fetching Hyperliquid positions:", error);
      // Continue without leverage update if fetch fails
    }

    // Create a map of Hyperliquid positions by symbol
    const hlPositionMap = new Map();
    if (hyperliquidPositions && Array.isArray(hyperliquidPositions)) {
      hyperliquidPositions.forEach((hlPos: any) => {
        const coin = hlPos.position?.coin || hlPos.coin;
        if (coin) {
          hlPositionMap.set(coin, hlPos.position || hlPos);
        }
      });
    }

    // Update positions with live prices and calculate real-time P&L
    const livePositions = positions.map((position) => {
      const livePrice = marketData[position.symbol]?.price || position.currentPrice;
      const hlPosition = hlPositionMap.get(position.symbol);

      // Get actual leverage from Hyperliquid if available
      const actualLeverage = hlPosition?.leverage?.value || position.leverage;

      // Convert USD size to coin size
      // position.size is stored as USD value, but P&L calculation needs coin amount
      const coinSize = position.size / position.entryPrice;

      // Calculate real-time P&L
      let unrealizedPnl = 0;
      if (position.side === "LONG") {
        unrealizedPnl = (livePrice - position.entryPrice) * coinSize;
      } else {
        unrealizedPnl = (position.entryPrice - livePrice) * coinSize;
      }

      const unrealizedPnlPct = (unrealizedPnl / position.size) * 100;

      return {
        ...position,
        leverage: actualLeverage, // Use actual leverage from Hyperliquid
        currentPrice: livePrice,
        unrealizedPnl,
        unrealizedPnlPct,
      };
    });

    return livePositions;
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
