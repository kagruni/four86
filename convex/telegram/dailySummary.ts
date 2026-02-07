"use node";

import { internalAction } from "../_generated/server";
import { api, internal } from "../fnRefs";
import { formatDailySummary } from "./messageTemplates";

/**
 * Sends daily performance digests to all users who have Telegram
 * daily summaries enabled. Each user is processed independently
 * so one failure does not prevent others from receiving their digest.
 */
export const sendDailySummaries = internalAction({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.runQuery(
      internal.telegram.telegramQueries.getUsersForDailySummary,
      {}
    );

    if (users.length === 0) {
      console.log("[dailySummary] No users with daily summary enabled");
      return;
    }

    console.log(
      `[dailySummary] Sending daily summaries to ${users.length} user(s)`
    );

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const user of users) {
      try {
        // Fetch data in parallel for each user
        const [botConfig, recentTrades, snapshots, positions] =
          await Promise.all([
            ctx.runQuery(api.queries.getBotConfig, {
              userId: user.userId,
            }),
            ctx.runQuery(api.queries.getRecentTrades, {
              userId: user.userId,
              limit: 100,
            }),
            ctx.runQuery(api.queries.getAccountSnapshots, {
              userId: user.userId,
              limit: 1,
            }),
            ctx.runQuery(api.queries.getPositions, {
              userId: user.userId,
            }),
          ]);

        // Filter trades to the last 24 hours
        const todaysTrades = (recentTrades ?? []).filter(
          (trade: any) => trade.executedAt > oneDayAgo
        );

        // Calculate metrics
        const latestSnapshot = snapshots?.[0];
        const equity =
          latestSnapshot?.accountValue ?? botConfig?.currentCapital ?? 0;

        const dailyPnl = todaysTrades.reduce(
          (sum: number, t: any) => sum + (t.pnl ?? 0),
          0
        );
        const dailyPnlPct = equity > 0 ? (dailyPnl / equity) * 100 : 0;

        const openPositions = positions?.length ?? 0;
        const tradeCount = todaysTrades.length;

        const tradesWithPnl = todaysTrades.filter(
          (t: any) => t.pnl !== undefined && t.pnl !== null
        );
        const winningTrades = tradesWithPnl.filter(
          (t: any) => t.pnl > 0
        );
        const winRate =
          tradesWithPnl.length > 0
            ? (winningTrades.length / tradesWithPnl.length) * 100
            : 0;

        // Format and send
        const message = formatDailySummary({
          equity,
          dailyPnl,
          dailyPnlPct,
          openPositions,
          tradeCount,
          winRate,
        });

        await ctx.runAction(
          internal.telegram.telegramApi.sendMessage,
          {
            chatId: user.chatId,
            text: message,
          }
        );

        console.log(
          `[dailySummary] Sent summary to user ${user.userId}`
        );
      } catch (err) {
        console.error(
          `[dailySummary] Failed to send summary for user ${user.userId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  },
});
