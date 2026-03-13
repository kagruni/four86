import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { buildCloseTradeFields, resolveHistoricalCloseSettlement } from "./closeSettlement";

export async function reconcilePositionsWithExchange(
  ctx: any,
  params: {
    userId: string;
    walletId?: any;
    hyperliquidSymbols: string[];
    address: string;
    testnet: boolean;
    aiModel?: string;
  }
) {
  const {
    userId,
    walletId,
    hyperliquidSymbols,
    address,
    testnet,
    aiModel = "system_sync",
  } = params;
  const dbPositions = await ctx.runQuery(api.queries.getPositions, {
    userId,
    ...(walletId ? { walletId } : {}),
  });
  const now = Date.now();
  const GRACE_PERIOD_MS = 3 * 60 * 1000;

  const positionsToRemove = (dbPositions || []).filter((dbPos: any) => {
    if (hyperliquidSymbols.includes(dbPos.symbol)) {
      return false;
    }

    const age = now - dbPos.openedAt;
    return age > GRACE_PERIOD_MS;
  });

  for (const position of positionsToRemove) {
    const settlement = await resolveHistoricalCloseSettlement(ctx, api, {
      userId,
      address,
      testnet,
      position,
      observedAt: now,
    });

    await ctx.runMutation(api.mutations.saveTrade, {
      userId,
      ...(walletId ? { walletId } : {}),
      ...buildCloseTradeFields({
        position,
        settlement,
        aiReasoning: "SYNC_CLOSE: Position not found on exchange during reconciliation",
        aiModel,
        confidence: 1.0,
        txHash: settlement.pnlSource === "reconciled_estimate"
          ? "sync_reconcile_close_estimate"
          : "sync_reconcile_close_exchange_fill",
      }),
    });

    await ctx.runMutation(api.mutations.closePosition, {
      userId,
      ...(walletId ? { walletId } : {}),
      symbol: position.symbol,
    });
  }

  return {
    removedCount: positionsToRemove.length,
    removedSymbols: positionsToRemove.map((position: any) => position.symbol),
  };
}

/**
 * Position sync function - runs independently of trading loop
 * Ensures database positions stay in sync with Hyperliquid
 * Runs every 1 minute to catch positions closed via SL/TP on exchange
 */
export const syncAllPositions = internalAction({
  handler: async (ctx) => {
    try {
      // Get all users that have positions in the database
      const allPositions = await ctx.runQuery(internal.queries.getAllPositionsForSync);

      if (!allPositions || allPositions.length === 0) {
        console.log("[positionSync] No positions to sync");
        return;
      }

      // Group positions by userId, then walletId inside each user.
      const userIds = [...new Set(allPositions.map((p: any) => p.userId))];
      console.log(`[positionSync] Syncing positions for ${userIds.length} user(s)`);

      for (const userId of userIds) {
        const lockId = `position-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const lock = await ctx.runMutation(api.mutations.acquireTradingLock, {
          userId,
          lockId,
        });
        if (!lock.success) {
          console.log(`[positionSync] Skipping user ${userId} - trading lock held (${lock.lockId})`);
          continue;
        }

        try {
          const userPositions = allPositions.filter((position: any) => position.userId === userId);
          const walletGroups = new Map<string, any[]>();
          for (const position of userPositions) {
            const walletKey = String(position.walletId ?? "legacy");
            const positionsForWallet = walletGroups.get(walletKey) || [];
            positionsForWallet.push(position);
            walletGroups.set(walletKey, positionsForWallet);
          }

          for (const walletPositions of walletGroups.values()) {
            const walletId = walletPositions[0]?.walletId;
            const wallet = await ctx.runQuery(internal.wallets.queries.resolveSelectedWalletInternal, {
              userId,
              ...(walletId ? { walletId } : {}),
            });

            if (!wallet?.hyperliquidAddress || !wallet?.hyperliquidPrivateKey) {
              console.log(`[positionSync] Skipping user ${userId} wallet ${walletId ?? "legacy"} - missing wallet credentials`);
              continue;
            }

            const hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
              address: wallet.hyperliquidAddress,
              testnet: wallet.hyperliquidTestnet,
            });

            const hyperliquidSymbols = hyperliquidPositions
              .map((position: any) => {
                const nextPosition = position.position || position;
                const szi = parseFloat(nextPosition.szi || "0");
                return szi !== 0 ? nextPosition.coin : null;
              })
              .filter((symbol: string | null): symbol is string => symbol !== null);

            const now = Date.now();
            const GRACE_PERIOD_MS = 3 * 60 * 1000;
            const staleSymbols = (walletPositions || [])
              .filter(
                (position: any) =>
                  !hyperliquidSymbols.includes(position.symbol) &&
                  now - position.openedAt > GRACE_PERIOD_MS
              )
              .map((position: any) => position.symbol);

            for (const symbol of staleSymbols) {
              try {
                const regularCancelResult = await ctx.runAction(api.hyperliquid.client.cancelAllOrdersForSymbol, {
                  privateKey: wallet.hyperliquidPrivateKey,
                  address: wallet.hyperliquidAddress,
                  symbol,
                  testnet: wallet.hyperliquidTestnet,
                });
                const triggerCancelResult = await ctx.runAction(api.hyperliquid.client.cancelTriggerOrdersForSymbol, {
                  privateKey: wallet.hyperliquidPrivateKey,
                  address: wallet.hyperliquidAddress,
                  symbol,
                  testnet: wallet.hyperliquidTestnet,
                });
                const cancelledCount = regularCancelResult.cancelledCount + triggerCancelResult.cancelledCount;
                if (cancelledCount > 0) {
                  console.log(
                    `[positionSync] Cancelled ${cancelledCount} stale order(s) for ${symbol} on wallet ${wallet.label}`
                  );
                }
              } catch (cancelError) {
                console.warn(
                  `[positionSync] Failed to cancel stale orders for ${symbol} on wallet ${wallet.label}:`,
                  cancelError instanceof Error ? cancelError.message : String(cancelError)
                );
              }
            }

            await reconcilePositionsWithExchange(ctx, {
              userId,
              ...(walletId ? { walletId } : {}),
              hyperliquidSymbols,
              address: wallet.hyperliquidAddress,
              testnet: wallet.hyperliquidTestnet,
            });
          }

        } catch (error) {
          console.error(`[positionSync] Error syncing user ${userId}:`, error);
          // Continue with next user instead of failing entire sync
        } finally {
          await ctx.runMutation(api.mutations.releaseTradingLock, {
            userId,
            lockId,
          });
        }
      }

      console.log("[positionSync] Sync complete");

    } catch (error) {
      console.error("[positionSync] Error in position sync:", error);
    }
  },
});
