"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

const getTelegramUrl = (method: string) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

export const sendMessage = internalAction({
  args: {
    chatId: v.string(),
    text: v.string(),
    parseMode: v.optional(v.string()),
    replyMarkup: v.optional(v.string()), // JSON-encoded InlineKeyboardMarkup
  },
  handler: async (_ctx, args): Promise<{ success: boolean; error?: string }> => {
    try {
      const body: Record<string, unknown> = {
        chat_id: args.chatId,
        text: args.text,
        parse_mode: args.parseMode ?? "Markdown",
      };

      if (args.replyMarkup) {
        body.reply_markup = JSON.parse(args.replyMarkup);
      }

      const response = await fetch(getTelegramUrl("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!data.ok) {
        return {
          success: false,
          error: data.description ?? "Unknown Telegram API error",
        };
      }

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, error: message };
    }
  },
});

/**
 * Acknowledge a callback query (inline keyboard button press).
 * Required by Telegram to remove the loading indicator on the button.
 */
export const answerCallbackQuery = internalAction({
  args: {
    callbackQueryId: v.string(),
    text: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(getTelegramUrl("answerCallbackQuery"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: args.callbackQueryId,
          text: args.text,
        }),
      });

      const data = await response.json();

      if (!data.ok) {
        return {
          success: false,
          error: data.description ?? "Unknown Telegram API error",
        };
      }

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, error: message };
    }
  },
});

export const setWebhook = internalAction({
  args: {
    url: v.string(),
    secretToken: v.string(),
  },
  handler: async (_ctx, args): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(getTelegramUrl("setWebhook"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: args.url,
          secret_token: args.secretToken,
          allowed_updates: ["message", "callback_query"],
        }),
      });

      const data = await response.json();

      if (!data.ok) {
        return {
          success: false,
          error: data.description ?? "Unknown Telegram API error",
        };
      }

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, error: message };
    }
  },
});

/**
 * Register bot commands with Telegram so they appear in the "/" menu.
 * Idempotent — safe to call multiple times.
 */
export const setMyCommands = internalAction({
  args: {},
  handler: async (_ctx): Promise<{ success: boolean; error?: string }> => {
    try {
      const commands = [
        { command: "positions", description: "Open positions with live P&L" },
        { command: "balance", description: "Account balance" },
        { command: "status", description: "Bot status and account info" },
        { command: "pnl", description: "Today's P&L summary" },
        { command: "start", description: "Start the trading bot" },
        { command: "stop", description: "Stop the trading bot" },
        { command: "orders", description: "View all open orders" },
        { command: "cancel", description: "Cancel an order" },
        { command: "close", description: "Close a position" },
        { command: "closeall", description: "Close all positions" },
        { command: "notifications", description: "Position update interval" },
        { command: "help", description: "Show available commands" },
      ];

      const response = await fetch(getTelegramUrl("setMyCommands"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands }),
      });

      const data = await response.json();

      if (!data.ok) {
        console.error("[Telegram] setMyCommands failed:", data.description);
        return {
          success: false,
          error: data.description ?? "Unknown Telegram API error",
        };
      }

      console.log("[Telegram] Bot commands registered successfully");
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, error: message };
    }
  },
});

