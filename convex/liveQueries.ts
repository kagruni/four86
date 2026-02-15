import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./fnRefs";

/**
 * Build position objects directly from Hyperliquid assetPositions data.
 * Used as a fallback when the Convex database has no positions but Hyperliquid does.
 */
function buildPositionsFromHyperliquid(
  hlPositions: any[],
  marketData: Record<string, any>
): any[] {
  const positions: any[] = [];

  for (const hlPos of hlPositions) {
    const pos = hlPos.position || hlPos;
    const coin = pos.coin;
    const szi = parseFloat(pos.szi || "0");

    // Skip zero-size positions
    if (szi === 0 || !coin) continue;

    const isLong = szi > 0;
    const size = Math.abs(szi);
    const entryPrice = parseFloat(pos.entryPx || "0");
    const livePrice = marketData[coin]?.price || entryPrice;
    const leverage = pos.leverage?.value || 1;
    const positionValue = size * entryPrice;

    // Calculate P&L
    let unrealizedPnl = 0;
    if (isLong) {
      unrealizedPnl = (livePrice - entryPrice) * size;
    } else {
      unrealizedPnl = (entryPrice - livePrice) * size;
    }
    const unrealizedPnlPct = positionValue > 0 ? (unrealizedPnl / positionValue) * 100 : 0;

    positions.push({
      _id: `hl_${coin}`, // Synthetic ID for rendering
      symbol: coin,
      side: isLong ? "LONG" : "SHORT",
      size: positionValue,
      leverage,
      entryPrice,
      currentPrice: livePrice,
      unrealizedPnl,
      unrealizedPnlPct,
      stopLoss: undefined,
      takeProfit: undefined,
      liquidationPrice: pos.liquidationPx ? parseFloat(pos.liquidationPx) : 0,
      openedAt: Date.now(),
      lastUpdated: Date.now(),
      _fromHyperliquid: true, // Flag to indicate this came directly from exchange
    });
  }

  return positions;
}

// Get live positions with real-time prices from Hyperliquid
export const getLivePositions = action({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    // Get user credentials first - needed for all paths
    const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
      userId: args.userId,
    });

    if (!credentials || !credentials.hyperliquidAddress) {
      // No credentials — can only return DB positions
      const positions = await ctx.runQuery(api.queries.getPositions, {
        userId: args.userId,
      });
      return positions || [];
    }

    const testnet = credentials.hyperliquidTestnet ?? true;

    // Get stored positions from database
    const dbPositions = await ctx.runQuery(api.queries.getPositions, {
      userId: args.userId,
    });

    // Always fetch actual positions from Hyperliquid (source of truth)
    let hyperliquidPositions: any[] = [];
    try {
      hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
        address: credentials.hyperliquidAddress,
        testnet,
      });
    } catch (error) {
      console.log("[getLivePositions] Could not fetch Hyperliquid positions:", error instanceof Error ? error.message : String(error));
      // Fall back to DB positions if Hyperliquid is unreachable
      return dbPositions || [];
    }

    // Filter to only positions with non-zero size
    const activeHlPositions = (hyperliquidPositions || []).filter((hlPos: any) => {
      const pos = hlPos.position || hlPos;
      const szi = parseFloat(pos.szi || "0");
      return szi !== 0;
    });

    // If DB is empty but Hyperliquid has positions, build from exchange data directly
    if (!dbPositions || dbPositions.length === 0) {
      if (activeHlPositions.length === 0) {
        return [];
      }

      // Fetch market data for the symbols on Hyperliquid
      const hlSymbols = activeHlPositions.map((p: any) => {
        const pos = p.position || p;
        return pos.coin;
      }).filter(Boolean);

      let marketData: Record<string, any> = {};
      try {
        marketData = await ctx.runAction(api.hyperliquid.client.getMarketData, {
          symbols: [...new Set(hlSymbols)],
          testnet,
        });
      } catch (error) {
        console.log("[getLivePositions] Could not fetch market data:", error instanceof Error ? error.message : String(error));
      }

      console.log(`[getLivePositions] DB empty, built ${activeHlPositions.length} position(s) from Hyperliquid`);
      return buildPositionsFromHyperliquid(activeHlPositions, marketData);
    }

    // DB has positions — merge with live Hyperliquid data
    const symbols = [...new Set(dbPositions.map((p: any) => p.symbol))];

    // Also include symbols from Hyperliquid that might not be in DB
    for (const hlPos of activeHlPositions) {
      const coin = (hlPos.position || hlPos).coin;
      if (coin && !symbols.includes(coin)) {
        symbols.push(coin);
      }
    }

    // Fetch live prices
    let marketData: Record<string, any> = {};
    try {
      marketData = await ctx.runAction(api.hyperliquid.client.getMarketData, {
        symbols,
        testnet,
      });
    } catch (error) {
      console.log("[getLivePositions] Could not fetch market data:", error instanceof Error ? error.message : String(error));
    }

    // Create a map of Hyperliquid positions by symbol
    const hlPositionMap = new Map();
    activeHlPositions.forEach((hlPos: any) => {
      const coin = (hlPos.position || hlPos)?.coin;
      if (coin) {
        hlPositionMap.set(coin, hlPos.position || hlPos);
      }
    });

    // Update DB positions with live prices and real P&L
    const livePositions = dbPositions.map((position: any) => {
      const livePrice = marketData[position.symbol]?.price || position.currentPrice;
      const hlPosition = hlPositionMap.get(position.symbol);

      // Get actual leverage from Hyperliquid if available
      const actualLeverage = hlPosition?.leverage?.value || position.leverage;

      // Convert USD size to coin size
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
        leverage: actualLeverage,
        currentPrice: livePrice,
        unrealizedPnl,
        unrealizedPnlPct,
      };
    });

    // Add any Hyperliquid positions NOT in the database
    const dbSymbols = new Set(dbPositions.map((p: any) => p.symbol));
    const missingFromDb = activeHlPositions.filter((hlPos: any) => {
      const coin = (hlPos.position || hlPos).coin;
      return coin && !dbSymbols.has(coin);
    });

    if (missingFromDb.length > 0) {
      console.log(`[getLivePositions] Found ${missingFromDb.length} position(s) on Hyperliquid not in DB`);
      const extraPositions = buildPositionsFromHyperliquid(missingFromDb, marketData);
      livePositions.push(...extraPositions);
    }

    return livePositions;
  },
});
