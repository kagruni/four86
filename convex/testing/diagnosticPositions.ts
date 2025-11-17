import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";

/**
 * Diagnostic tool to check position sync issues
 * Compares database positions vs Hyperliquid positions
 */
export const checkPositionStatus = action({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    try {
      console.log("[diagnostic] Checking position status for user:", args.userId);

      // 1. Get positions from database
      const dbPositions = await ctx.runQuery(api.queries.getPositions, {
        userId: args.userId,
      });

      console.log("[diagnostic] Database positions:", dbPositions.length);
      dbPositions.forEach(pos => {
        console.log(`  - ${pos.symbol} ${pos.side} size: $${pos.size}`);
      });

      // 2. Get user credentials
      const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
        userId: args.userId,
      });

      if (!credentials || !credentials.hyperliquidAddress) {
        return {
          error: "No credentials found",
          dbPositions: dbPositions.length,
          hlPositions: 0,
        };
      }

      // 3. Get actual positions from Hyperliquid
      const hlPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
        address: credentials.hyperliquidAddress,
        testnet: credentials.hyperliquidTestnet,
      });

      console.log("[diagnostic] Hyperliquid raw response:", JSON.stringify(hlPositions, null, 2));

      // 4. Parse Hyperliquid positions
      const parsedHLPositions = hlPositions
        .map((p: any) => {
          const coin = p.position?.coin || p.coin;
          const szi = p.position?.szi || p.szi || "0";
          const size = parseFloat(szi);
          return {
            coin,
            szi,
            size,
            isNonZero: size !== 0,
          };
        })
        .filter((p: any) => p.isNonZero);

      console.log("[diagnostic] Parsed Hyperliquid positions:", parsedHLPositions.length);
      parsedHLPositions.forEach((p: any) => {
        console.log(`  - ${p.coin} size: ${p.size} (szi: ${p.szi})`);
      });

      // 5. Find mismatches
      const dbSymbols = dbPositions.map(p => p.symbol);
      const hlSymbols = parsedHLPositions.map((p: any) => p.coin);

      const inDbNotHL = dbSymbols.filter(s => !hlSymbols.includes(s));
      const inHLNotDb = hlSymbols.filter(s => !dbSymbols.includes(s));

      console.log("[diagnostic] In DB but not HL:", inDbNotHL);
      console.log("[diagnostic] In HL but not DB:", inHLNotDb);

      return {
        success: true,
        database: {
          count: dbPositions.length,
          symbols: dbSymbols,
        },
        hyperliquid: {
          count: parsedHLPositions.length,
          symbols: hlSymbols,
          raw: parsedHLPositions,
        },
        mismatches: {
          inDbNotHL,
          inHLNotDb,
        },
      };

    } catch (error) {
      console.error("[diagnostic] Error:", error);
      return {
        error: String(error),
      };
    }
  },
});
