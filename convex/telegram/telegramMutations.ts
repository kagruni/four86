import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Generate a 6-character alphanumeric verification code for Telegram linking.
 * Upserts the telegramSettings record for the user.
 */
export const generateVerificationCode = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes
    const now = Date.now();

    const existing = await ctx.db
      .query("telegramSettings")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        verificationCode: code,
        verificationExpiresAt: expiresAt,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("telegramSettings", {
        userId: args.userId,
        isLinked: false,
        isEnabled: true,
        notifyTradeOpened: true,
        notifyTradeClosed: true,
        notifyRiskAlerts: true,
        notifyDailySummary: true,
        verificationCode: code,
        verificationExpiresAt: expiresAt,
        createdAt: now,
        updatedAt: now,
      });
    }

    return code;
  },
});

/**
 * Verify a Telegram link using the verification code sent by the user in chat.
 * Called internally by the webhook handler.
 */
export const verifyLink = internalMutation({
  args: {
    chatId: v.string(),
    verificationCode: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ success: boolean; userId?: string; error?: string }> => {
    const settings = await ctx.db
      .query("telegramSettings")
      .withIndex("by_verificationCode", (q) =>
        q.eq("verificationCode", args.verificationCode)
      )
      .unique();

    if (!settings) {
      return { success: false, error: "Invalid verification code" };
    }

    if (
      settings.verificationExpiresAt &&
      Date.now() > settings.verificationExpiresAt
    ) {
      return { success: false, error: "Verification code has expired" };
    }

    await ctx.db.patch(settings._id, {
      chatId: args.chatId,
      isLinked: true,
      verificationCode: undefined,
      verificationExpiresAt: undefined,
      updatedAt: Date.now(),
    });

    return { success: true, userId: settings.userId };
  },
});

/**
 * Unlink a Telegram account from the user.
 */
export const unlinkTelegram = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("telegramSettings")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (!settings) {
      return;
    }

    await ctx.db.patch(settings._id, {
      chatId: undefined,
      isLinked: false,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update notification preference toggles for a user.
 */
export const updateNotificationPrefs = mutation({
  args: {
    userId: v.string(),
    notifyTradeOpened: v.optional(v.boolean()),
    notifyTradeClosed: v.optional(v.boolean()),
    notifyRiskAlerts: v.optional(v.boolean()),
    notifyDailySummary: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("telegramSettings")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (!settings) {
      throw new Error("Telegram settings not found for user");
    }

    const patch: Record<string, boolean | number> = {
      updatedAt: Date.now(),
    };

    if (args.notifyTradeOpened !== undefined) {
      patch.notifyTradeOpened = args.notifyTradeOpened;
    }
    if (args.notifyTradeClosed !== undefined) {
      patch.notifyTradeClosed = args.notifyTradeClosed;
    }
    if (args.notifyRiskAlerts !== undefined) {
      patch.notifyRiskAlerts = args.notifyRiskAlerts;
    }
    if (args.notifyDailySummary !== undefined) {
      patch.notifyDailySummary = args.notifyDailySummary;
    }

    await ctx.db.patch(settings._id, patch);
  },
});

/**
 * Store a pending confirmation for a dangerous action (e.g. close all positions).
 * Called internally by the bot command handler.
 */
export const storePendingConfirmation = internalMutation({
  args: {
    userId: v.string(),
    action: v.string(),
    token: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("telegramSettings")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (!settings) {
      throw new Error("Telegram settings not found for user");
    }

    await ctx.db.patch(settings._id, {
      pendingAction: args.action,
      pendingActionToken: args.token,
      pendingActionExpiresAt: args.expiresAt,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Clear a pending confirmation after it has been processed or expired.
 * Called internally after confirmation or cancellation.
 */
export const clearPendingConfirmation = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("telegramSettings")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (!settings) {
      return;
    }

    await ctx.db.patch(settings._id, {
      pendingAction: undefined,
      pendingActionToken: undefined,
      pendingActionExpiresAt: undefined,
      updatedAt: Date.now(),
    });
  },
});
