import { action } from "../_generated/server";
import { query } from "../_generated/server";
import { api, internal } from "../fnRefs";
import { v } from "convex/values";
import * as sdk from "../hyperliquid/sdk";

// Temporary diagnostic: list all userCredentials records
export const listAllCredentials = query({
  handler: async (ctx) => {
    const all = await ctx.db.query("userCredentials").collect();
    return all.map((c) => ({
      _id: c._id,
      userId: c.userId,
      hasOpenrouterApiKey: !!c.openrouterApiKey,
      hasHyperliquidPrivateKey: !!c.hyperliquidPrivateKey,
      hyperliquidAddress: c.hyperliquidAddress,
      hyperliquidTestnet: c.hyperliquidTestnet,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  },
});

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
      dbPositions.forEach((pos: any) => {
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
      const dbSymbols = dbPositions.map((p: any) => p.symbol);
      const hlSymbols = parsedHLPositions.map((p: any) => p.coin);

      const inDbNotHL = dbSymbols.filter((s: any) => !hlSymbols.includes(s));
      const inHLNotDb = hlSymbols.filter((s: any) => !dbSymbols.includes(s));

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

/**
 * Diagnostic: Check all open orders including trigger orders (TP/SL)
 * Uses frontendOpenOrders which includes trigger order details
 */
export const checkTpSlOrders = action({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    try {
      console.log("[diagnostic] Checking TP/SL orders for user:", args.userId);

      // Get user credentials
      const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
        userId: args.userId,
      });

      if (!credentials || !credentials.hyperliquidAddress) {
        return { error: "No credentials found" };
      }

      // Get ALL open orders (including trigger orders)
      const allOrders = await sdk.getFrontendOpenOrders(
        credentials.hyperliquidAddress,
        credentials.hyperliquidTestnet ?? true
      );

      console.log(`[diagnostic] Total orders found: ${allOrders.length}`);

      // Categorize orders
      const regularOrders: any[] = [];
      const triggerOrders: any[] = [];

      for (const order of allOrders) {
        const summary = {
          coin: order.coin,
          side: order.side === "B" ? "BUY" : "SELL",
          orderType: order.orderType,
          limitPx: order.limitPx,
          triggerPx: order.triggerPx,
          sz: order.sz,
          isTrigger: order.isTrigger,
          isPositionTpsl: order.isPositionTpsl,
          reduceOnly: order.reduceOnly,
          triggerCondition: order.triggerCondition,
          oid: order.oid,
          timestamp: new Date(order.timestamp).toISOString(),
        };

        if (order.isTrigger) {
          triggerOrders.push(summary);
          console.log(`  [TRIGGER] ${summary.coin} ${summary.orderType} @ ${summary.triggerPx} sz=${summary.sz}`);
        } else {
          regularOrders.push(summary);
          console.log(`  [REGULAR] ${summary.coin} ${summary.orderType} @ ${summary.limitPx} sz=${summary.sz}`);
        }
      }

      // Get current positions for context
      const hlPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
        address: credentials.hyperliquidAddress,
        testnet: credentials.hyperliquidTestnet ?? true,
      });

      const activePositions = hlPositions
        .filter((p: any) => {
          const szi = parseFloat((p.position || p).szi || "0");
          return szi !== 0;
        })
        .map((p: any) => {
          const pos = p.position || p;
          return {
            coin: pos.coin,
            side: parseFloat(pos.szi || "0") > 0 ? "LONG" : "SHORT",
            size: Math.abs(parseFloat(pos.szi || "0")),
            entryPx: pos.entryPx,
            liquidationPx: pos.liquidationPx,
          };
        });

      // Check which positions have TP/SL
      const positionsWithTpSl = activePositions.map((pos: any) => {
        const slOrders = triggerOrders.filter(
          (o) => o.coin === pos.coin && (o.orderType === "Stop Market" || o.orderType === "Stop Limit")
        );
        const tpOrders = triggerOrders.filter(
          (o) => o.coin === pos.coin && (o.orderType === "Take Profit Market" || o.orderType === "Take Profit Limit")
        );

        return {
          ...pos,
          hasSl: slOrders.length > 0,
          hasTp: tpOrders.length > 0,
          slDetails: slOrders,
          tpDetails: tpOrders,
        };
      });

      console.log("\n[diagnostic] Position TP/SL summary:");
      for (const pos of positionsWithTpSl) {
        console.log(`  ${pos.coin} ${pos.side}: SL=${pos.hasSl ? "YES" : "NO"}, TP=${pos.hasTp ? "YES" : "NO"}`);
      }

      return {
        success: true,
        summary: {
          totalOrders: allOrders.length,
          regularOrders: regularOrders.length,
          triggerOrders: triggerOrders.length,
          activePositions: activePositions.length,
        },
        positions: positionsWithTpSl,
        triggerOrders,
        regularOrders,
      };
    } catch (error) {
      console.error("[diagnostic] Error:", error);
      return { error: String(error) };
    }
  },
});
