/**
 * Account Snapshot Cycle
 *
 * Periodically captures account state (equity, P&L, trade stats)
 * for each active bot. Powers the analytics equity curve and
 * performance metrics on the dashboard.
 *
 * Runs every 15 minutes via cron.
 */

import { internalAction } from "../_generated/server";
import { api, internal } from "../fnRefs";

export const takeAccountSnapshots = internalAction({
  handler: async (ctx) => {
    console.log("[snapshot] Starting account snapshot cycle");

    // Get all active bots
    const activeBots = await ctx.runQuery(api.queries.getActiveBots);

    if (!activeBots || activeBots.length === 0) {
      console.log("[snapshot] No active bots, skipping");
      return;
    }

    console.log(`[snapshot] Taking snapshots for ${activeBots.length} bot(s)`);

    for (const bot of activeBots) {
      try {
        // Get credentials
        const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
          userId: bot.userId,
        });

        if (!credentials || !credentials.hyperliquidAddress) {
          console.log(`[snapshot] Skipping user ${bot.userId} — no credentials`);
          continue;
        }

        // Fetch live account state from Hyperliquid
        const accountState = await ctx.runAction(api.hyperliquid.client.getAccountState, {
          address: credentials.hyperliquidAddress,
          testnet: credentials.hyperliquidTestnet,
        });

        // Fetch closed trades to compute stats
        const trades = await ctx.runQuery(api.queries.getRecentTrades, {
          userId: bot.userId,
          limit: 1000,
        });

        const closedTrades = trades.filter((t: any) => t.action === "CLOSE");
        const numTrades = closedTrades.length;

        let totalPnl = 0;
        let wins = 0;
        for (const t of closedTrades) {
          const pnl = t.pnl ?? 0;
          totalPnl += pnl;
          if (pnl > 0) wins++;
        }

        const winRate = numTrades > 0 ? (wins / numTrades) * 100 : 0;
        const totalPnlPct =
          accountState.accountValue > 0
            ? (totalPnl / accountState.accountValue) * 100
            : 0;

        // Build simplified positions array for the snapshot
        const positions = (accountState.positions || [])
          .filter((p: any) => {
            const szi = p.position?.szi || p.szi || "0";
            return parseFloat(szi) !== 0;
          })
          .map((p: any) => ({
            coin: p.position?.coin || p.coin,
            size: p.position?.szi || p.szi || "0",
            entryPrice: p.position?.entryPx || p.entryPx || "0",
            unrealizedPnl: p.position?.unrealizedPnl || p.unrealizedPnl || "0",
          }));

        // Save snapshot
        await ctx.runMutation(api.mutations.saveAccountSnapshot, {
          userId: bot.userId,
          accountValue: accountState.accountValue,
          totalPnl,
          totalPnlPct,
          numTrades,
          winRate,
          positions,
        });

        console.log(
          `[snapshot] Saved snapshot for ${bot.userId}: $${accountState.accountValue.toFixed(2)} | PnL $${totalPnl.toFixed(2)} | ${numTrades} trades | ${winRate.toFixed(1)}% win`
        );
      } catch (error) {
        console.error(
          `[snapshot] Error for user ${bot.userId}:`,
          error instanceof Error ? error.message : String(error)
        );
        // Continue to next bot — one failure shouldn't block others
      }
    }

    console.log("[snapshot] Snapshot cycle complete");
  },
});
