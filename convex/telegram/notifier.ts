"use node";

import { internalAction, action } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../fnRefs";
import {
  formatTradeOpened,
  formatTradeClosed,
  formatRiskAlert,
} from "./messageTemplates";

/**
 * Notify user that a trade was opened.
 * Checks preferences before sending.
 */
export const notifyTradeOpened = internalAction({
  args: {
    userId: v.string(),
    symbol: v.string(),
    side: v.string(),
    sizeUsd: v.number(),
    leverage: v.number(),
    entryPrice: v.number(),
    stopLoss: v.optional(v.number()),
    takeProfit: v.optional(v.number()),
    confidence: v.optional(v.number()),
    reasoning: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const settings = await ctx.runQuery(
        internal.telegram.telegramQueries.getSettingsByUserId,
        { userId: args.userId }
      );

      if (!settings?.isLinked || !settings?.isEnabled || !settings?.notifyTradeOpened) {
        return;
      }

      const message = formatTradeOpened({
        symbol: args.symbol,
        side: args.side,
        sizeUsd: args.sizeUsd,
        leverage: args.leverage,
        entryPrice: args.entryPrice,
        stopLoss: args.stopLoss,
        takeProfit: args.takeProfit,
        confidence: args.confidence ? Math.round(args.confidence * 100) : undefined,
        reasoning: args.reasoning.slice(0, 200),
      });

      await ctx.runAction(internal.telegram.telegramApi.sendMessage, {
        chatId: settings.chatId!,
        text: message,
      });
    } catch (error) {
      console.error("[Telegram] Failed to send trade opened notification:", error);
    }
  },
});

/**
 * Notify user that a trade was closed.
 * Checks preferences before sending.
 */
export const notifyTradeClosed = internalAction({
  args: {
    userId: v.string(),
    symbol: v.string(),
    side: v.string(),
    entryPrice: v.number(),
    exitPrice: v.number(),
    pnl: v.number(),
    pnlPct: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      const settings = await ctx.runQuery(
        internal.telegram.telegramQueries.getSettingsByUserId,
        { userId: args.userId }
      );

      if (!settings?.isLinked || !settings?.isEnabled || !settings?.notifyTradeClosed) {
        return;
      }

      const message = formatTradeClosed({
        symbol: args.symbol,
        side: args.side,
        entryPrice: args.entryPrice,
        exitPrice: args.exitPrice,
        pnl: args.pnl,
        pnlPct: args.pnlPct,
        durationMs: args.durationMs,
      });

      await ctx.runAction(internal.telegram.telegramApi.sendMessage, {
        chatId: settings.chatId!,
        text: message,
      });
    } catch (error) {
      console.error("[Telegram] Failed to send trade closed notification:", error);
    }
  },
});

/**
 * Notify user of a risk alert (circuit breaker, emergency close, etc.).
 * Checks preferences before sending.
 */
export const notifyRiskAlert = internalAction({
  args: {
    userId: v.string(),
    type: v.string(),
    message: v.string(),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const settings = await ctx.runQuery(
        internal.telegram.telegramQueries.getSettingsByUserId,
        { userId: args.userId }
      );

      if (!settings?.isLinked || !settings?.isEnabled || !settings?.notifyRiskAlerts) {
        return;
      }

      const text = formatRiskAlert({
        type: args.type,
        message: args.message,
        details: args.details,
      });

      await ctx.runAction(internal.telegram.telegramApi.sendMessage, {
        chatId: settings.chatId!,
        text,
      });
    } catch (error) {
      console.error("[Telegram] Failed to send risk alert:", error);
    }
  },
});

/**
 * Send a test notification to verify the Telegram connection.
 * Called from the frontend settings page.
 */
export const sendTestNotification = action({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const settings = await ctx.runQuery(api.telegram.telegramQueries.getSettings, {
      userId: args.userId,
    });

    if (!settings?.isLinked || !settings?.chatId) {
      throw new Error("Telegram is not linked");
    }

    await ctx.runAction(internal.telegram.telegramApi.sendMessage, {
      chatId: settings.chatId,
      text: "✅ *Test Notification*\n\nYour Four86 Telegram integration is working correctly!",
    });
  },
});
