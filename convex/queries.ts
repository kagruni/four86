import { query } from "./_generated/server";
import { v } from "convex/values";

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
