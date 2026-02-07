import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./fnRefs";

// Get live positions with real-time prices from Hyperliquid
export const getLivePositions = action({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    // Get stored positions from database
    const positions = await ctx.runQuery(api.queries.getPositions, {
      userId: args.userId,
    });

    if (!positions || positions.length === 0) {
      return [];
    }

    // Get user credentials to fetch from Hyperliquid
    const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
      userId: args.userId,
    });

    if (!credentials || !credentials.hyperliquidAddress) {
      return positions; // Return database positions if no credentials
    }

    const testnet = credentials.hyperliquidTestnet ?? true;

    // Get unique symbols from positions
    const symbols = [...new Set(positions.map((p: any) => p.symbol))];

    // Fetch live prices from Hyperliquid
    const marketData = await ctx.runAction(api.hyperliquid.client.getMarketData, {
      symbols,
      testnet,
    });

    // Fetch actual positions from Hyperliquid to get real leverage
    let hyperliquidPositions = [];
    try {
      hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
        address: credentials.hyperliquidAddress,
        testnet,
      });
    } catch (error) {
      console.log("[getLivePositions] Could not fetch Hyperliquid positions:", error instanceof Error ? error.message : String(error));
      // Continue without leverage update if fetch fails
    }

    // Create a map of Hyperliquid positions by symbol
    const hlPositionMap = new Map();
    if (hyperliquidPositions && Array.isArray(hyperliquidPositions)) {
      hyperliquidPositions.forEach((hlPos: any) => {
        const coin = hlPos.position?.coin || hlPos.coin;
        if (coin) {
          hlPositionMap.set(coin, hlPos.position || hlPos);
        }
      });
    }

    // Update positions with live prices and calculate real-time P&L
    const livePositions = positions.map((position: any) => {
      const livePrice = marketData[position.symbol]?.price || position.currentPrice;
      const hlPosition = hlPositionMap.get(position.symbol);

      // Get actual leverage from Hyperliquid if available
      const actualLeverage = hlPosition?.leverage?.value || position.leverage;

      // Convert USD size to coin size
      // position.size is stored as USD value, but P&L calculation needs coin amount
      const coinSize = position.size / position.entryPrice;

      // Calculate real-time P&L
      let unrealizedPnl = 0;
      if (position.side === "LONG") {
        unrealizedPnl = (livePrice - position.entryPrice) * coinSize;
      } else {
        unrealizedPnl = (position.entryPrice - livePrice) * coinSize;
      }

      const unrealizedPnlPct = (unrealizedPnl / position.size) * 100;

      return {
        ...position,
        leverage: actualLeverage, // Use actual leverage from Hyperliquid
        currentPrice: livePrice,
        unrealizedPnl,
        unrealizedPnlPct,
      };
    });

    return livePositions;
  },
});
