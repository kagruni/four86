import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * Public query: get Telegram settings for a user.
 * Used by the frontend to display notification preferences.
 */
export const getSettings = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("telegramSettings")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

/**
 * Internal query: get Telegram settings by userId.
 * Used by notifier actions to check preferences before sending.
 */
export const getSettingsByUserId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("telegramSettings")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

/**
 * Internal query: look up Telegram settings by Telegram chatId.
 * Used by the webhook handler to identify which user sent a message.
 */
export const getSettingsByChatId = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("telegramSettings")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .first();
  },
});

/**
 * Internal query: get all users who should receive a daily summary.
 * Filters for linked, enabled accounts with dailySummary notification on.
 */
export const getUsersForDailySummary = internalQuery({
  args: {},
  handler: async (ctx) => {
    const allSettings = await ctx.db
      .query("telegramSettings")
      .collect();

    return allSettings.filter(
      (s) => s.isLinked && s.isEnabled && s.notifyDailySummary
    );
  },
});
