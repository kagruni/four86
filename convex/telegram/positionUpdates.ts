"use node";

import { internalAction } from "../_generated/server";
import { api, internal } from "../fnRefs";
import { formatPositions } from "./messageTemplates";

/**
 * Scheduled action: send position status updates to users who have
 * enabled periodic notifications. Runs every 5 minutes via cron.
 * Checks each user's positionUpdateInterval to determine eligibility.
 */
export const sendPositionUpdates = internalAction({
  args: {},
  handler: async (ctx) => {
    const eligibleUsers = await ctx.runQuery(
      internal.telegram.telegramQueries.getUsersForPositionUpdates,
      {}
    );

    if (eligibleUsers.length === 0) return;

    const now = Date.now();

    for (const settings of eligibleUsers) {
      try {
        if (!settings.chatId) continue;

        // Fetch live positions
        const positions = await ctx.runAction(
          api.liveQueries.getLivePositions,
          { userId: settings.userId }
        );

        // Only send if there are open positions
        if (!positions || positions.length === 0) continue;

        const formatted = formatPositions(
          positions.map((p: any) => ({
            symbol: p.symbol,
            side: p.side,
            size: p.size,
            entryPrice: p.entryPrice,
            currentPrice: p.currentPrice,
            unrealizedPnl: p.unrealizedPnl ?? 0,
            unrealizedPnlPct: p.unrealizedPnlPct ?? 0,
            leverage: p.leverage ?? 1,
          }))
        );

        const intervalLabel = `${settings.positionUpdateInterval}min`;
        const header = `\u{1F504} *Position Update* (every ${intervalLabel})\n\n`;

        await ctx.runAction(internal.telegram.telegramApi.sendMessage, {
          chatId: settings.chatId,
          text: header + formatted,
        });

        // Update last sent timestamp
        await ctx.runMutation(
          internal.telegram.telegramMutations.updateLastPositionUpdateSent,
          { userId: settings.userId, sentAt: now }
        );
      } catch (error) {
        console.error(
          `[Telegram] Failed to send position update for user ${settings.userId}:`,
          error
        );
      }
    }
  },
});
