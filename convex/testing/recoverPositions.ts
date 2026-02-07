import { action } from "../_generated/server";
import { api, internal } from "../fnRefs";
import { v } from "convex/values";

/**
 * Recover missing positions from Hyperliquid
 * Adds positions that exist on Hyperliquid but not in database
 */
export const recoverMissingPositions = action({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    try {
      console.log("[recover] Starting position recovery for user:", args.userId);

      // 1. Get current database positions
      const dbPositions = await ctx.runQuery(api.queries.getPositions, {
        userId: args.userId,
      });

      const dbSymbols = dbPositions.map((p: any) => p.symbol);
      console.log(`[recover] Database has: ${dbSymbols.join(", ") || "none"}`);

      // 2. Get user credentials
      const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
        userId: args.userId,
      });

      if (!credentials || !credentials.hyperliquidAddress) {
        throw new Error("No credentials found");
      }

      // 3. Get positions from Hyperliquid
      const hlPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
        address: credentials.hyperliquidAddress,
        testnet: credentials.hyperliquidTestnet,
      });

      console.log(`[recover] Hyperliquid raw positions:`, JSON.stringify(hlPositions, null, 2));

      // 4. Get current market prices
      const allSymbols = hlPositions
        .map((p: any) => p.position?.coin || p.coin)
        .filter((coin: any) => coin);

      const marketData = await ctx.runAction(api.hyperliquid.client.getMarketData, {
        symbols: allSymbols,
        testnet: credentials.hyperliquidTestnet,
      });

      // 5. Find positions on Hyperliquid but not in database
      const recovered = [];

      for (const hlPos of hlPositions) {
        const coin = hlPos.position?.coin || hlPos.coin;
        const szi = hlPos.position?.szi || hlPos.szi || "0";
        const size = parseFloat(szi);

        if (size === 0) continue; // Skip zero-size positions
        if (dbSymbols.includes(coin)) continue; // Already in database

        // This position needs to be recovered!
        const side = size > 0 ? "LONG" : "SHORT";
        const currentPrice = marketData[coin]?.price || 0;
        const leverage = hlPos.position?.leverage?.value || 1;
        const sizeUsd = Math.abs(size) * currentPrice;

        console.log(`[recover] Found missing position: ${coin} ${side} size=${Math.abs(size)} @ $${currentPrice}`);

        // Add to database
        await ctx.runMutation(api.mutations.savePosition, {
          userId: args.userId,
          symbol: coin,
          side,
          size: sizeUsd,
          leverage,
          entryPrice: currentPrice, // We don't know the actual entry price, use current
          currentPrice,
          unrealizedPnl: 0, // We don't know the actual P&L yet
          unrealizedPnlPct: 0,
          stopLoss: undefined,
          takeProfit: undefined,
          liquidationPrice: currentPrice * (side === "LONG" ? 0.9 : 1.1),
          invalidationCondition: `Recovered position - monitor manually`,
          entryReasoning: `Position recovered from Hyperliquid (was missing from database)`,
          confidence: 0.5,
          entryOrderId: "recovered",
        });

        recovered.push({ coin, side, sizeUsd: sizeUsd.toFixed(2) });
      }

      console.log(`[recover] Recovery complete. Added ${recovered.length} positions`);

      return {
        success: true,
        recovered,
        message: `Successfully recovered ${recovered.length} missing position(s)`,
      };

    } catch (error) {
      console.error("[recover] Error:", error);
      return {
        error: String(error),
      };
    }
  },
});
