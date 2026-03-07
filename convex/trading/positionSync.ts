import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";

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

      // Group positions by userId
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
          // Get user credentials
          const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
            userId,
          });

          if (!credentials || !credentials.hyperliquidAddress || !credentials.hyperliquidPrivateKey) {
            console.log(`[positionSync] Skipping user ${userId} - missing credentials`);
            continue;
          }

          // Fetch actual positions from Hyperliquid
          const hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
            address: credentials.hyperliquidAddress,
            testnet: credentials.hyperliquidTestnet,
          });

          // Extract symbols of actual positions on Hyperliquid (only non-zero size)
          console.log(`[positionSync] Raw Hyperliquid positions:`, JSON.stringify(hyperliquidPositions, null, 2));

          const hyperliquidSymbols = hyperliquidPositions
            .map((p: any, index: number) => {
              const coin = p.position?.coin || p.coin;
              const szi = p.position?.szi || p.szi || "0";
              const sziNumber = parseFloat(szi);
              console.log(`[positionSync]   Position ${index}: coin=${coin}, szi=${szi}, parsed=${sziNumber}, isNonZero=${sziNumber !== 0}`);
              return sziNumber !== 0 ? coin : null;
            })
            .filter((s: string | null): s is string => s !== null);

          console.log(`[positionSync] User ${userId}: Hyperliquid has [${hyperliquidSymbols.join(", ") || "none"}]`);

          const dbPositions = await ctx.runQuery(api.queries.getPositions, {
            userId,
          });
          const now = Date.now();
          const GRACE_PERIOD_MS = 3 * 60 * 1000;
          const staleSymbols = (dbPositions || [])
            .filter((dbPos: any) => !hyperliquidSymbols.includes(dbPos.symbol) && now - dbPos.openedAt > GRACE_PERIOD_MS)
            .map((dbPos: any) => dbPos.symbol);

          for (const symbol of staleSymbols) {
            try {
              const regularCancelResult = await ctx.runAction(api.hyperliquid.client.cancelAllOrdersForSymbol, {
                privateKey: credentials.hyperliquidPrivateKey,
                address: credentials.hyperliquidAddress,
                symbol,
                testnet: credentials.hyperliquidTestnet,
              });
              const triggerCancelResult = await ctx.runAction(api.hyperliquid.client.cancelTriggerOrdersForSymbol, {
                privateKey: credentials.hyperliquidPrivateKey,
                address: credentials.hyperliquidAddress,
                symbol,
                testnet: credentials.hyperliquidTestnet,
              });
              const cancelledCount = regularCancelResult.cancelledCount + triggerCancelResult.cancelledCount;
              if (cancelledCount > 0) {
                console.log(`[positionSync] Cancelled ${cancelledCount} stale order(s) for ${symbol} before DB reconciliation`);
              }
            } catch (cancelError) {
              console.warn(`[positionSync] Failed to cancel stale orders for ${symbol}:`, cancelError instanceof Error ? cancelError.message : String(cancelError));
            }
          }

          // Sync database with Hyperliquid reality
          await ctx.runMutation(api.mutations.syncPositions, {
            userId,
            hyperliquidSymbols,
          });

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
