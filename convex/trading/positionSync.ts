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
      const userIds = [...new Set(allPositions.map(p => p.userId))];
      console.log(`[positionSync] Syncing positions for ${userIds.length} user(s)`);

      for (const userId of userIds) {
        try {
          // Get user credentials
          const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
            userId,
          });

          if (!credentials || !credentials.hyperliquidAddress) {
            console.log(`[positionSync] Skipping user ${userId} - no credentials`);
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

          // Sync database with Hyperliquid reality
          await ctx.runMutation(api.mutations.syncPositions, {
            userId,
            hyperliquidSymbols,
          });

        } catch (error) {
          console.error(`[positionSync] Error syncing user ${userId}:`, error);
          // Continue with next user instead of failing entire sync
        }
      }

      console.log("[positionSync] Sync complete");

    } catch (error) {
      console.error("[positionSync] Error in position sync:", error);
    }
  },
});
