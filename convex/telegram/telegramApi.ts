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
  },
  handler: async (_ctx, args): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(getTelegramUrl("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: args.chatId,
          text: args.text,
          parse_mode: args.parseMode ?? "Markdown",
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
          allowed_updates: ["message"],
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
