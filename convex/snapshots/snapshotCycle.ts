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
        const wallets = await ctx.runQuery(internal.wallets.queries.getActiveConnectedWalletsInternal, {
          userId: bot.userId,
        });

        if (!wallets || wallets.length === 0) {
          console.log(`[snapshot] Skipping user ${bot.userId} — no active wallets`);
          continue;
        }

        for (const wallet of wallets) {
          const walletId = wallet.walletId ?? undefined;

          const [accountState, trades] = await Promise.all([
            ctx.runAction(api.hyperliquid.client.getAccountState, {
              address: wallet.hyperliquidAddress,
              testnet: wallet.hyperliquidTestnet,
            }),
            ctx.runQuery(api.queries.getRecentTrades, {
              userId: bot.userId,
              ...(walletId ? { walletId } : {}),
              limit: 1000,
            }),
          ]);

          const closedTrades = trades.filter((trade: any) => trade.action === "CLOSE");
          const numTrades = closedTrades.length;

          let totalPnl = 0;
          let wins = 0;
          for (const trade of closedTrades) {
            const pnl = trade.pnl ?? 0;
            totalPnl += pnl;
            if (pnl > 0) wins++;
          }

          const winRate = numTrades > 0 ? (wins / numTrades) * 100 : 0;
          const totalPnlPct =
            accountState.accountValue > 0
              ? (totalPnl / accountState.accountValue) * 100
              : 0;

          const positions = (accountState.positions || [])
            .filter((position: any) => {
              const szi = position.position?.szi || position.szi || "0";
              return parseFloat(szi) !== 0;
            })
            .map((position: any) => ({
              coin: position.position?.coin || position.coin,
              size: position.position?.szi || position.szi || "0",
              entryPrice: position.position?.entryPx || position.entryPx || "0",
              unrealizedPnl: position.position?.unrealizedPnl || position.unrealizedPnl || "0",
            }));

          await ctx.runMutation(api.mutations.saveAccountSnapshot, {
            userId: bot.userId,
            ...(walletId ? { walletId } : {}),
            accountValue: accountState.accountValue,
            totalPnl,
            totalPnlPct,
            numTrades,
            winRate,
            positions,
          });

          console.log(
            `[snapshot] Saved snapshot for ${bot.userId}/${wallet.label}: $${accountState.accountValue.toFixed(2)} | PnL $${totalPnl.toFixed(2)} | ${numTrades} trades | ${winRate.toFixed(1)}% win`
          );
        }
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
