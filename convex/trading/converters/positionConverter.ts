/**
 * Position Converter
 *
 * Converts Hyperliquid raw position format to the AI-compatible format
 * used throughout the trading system.
 */

/**
 * Convert Hyperliquid positions to the format expected by the AI.
 * This ensures the AI ALWAYS knows about actual positions on the exchange.
 *
 * @param hyperliquidPositions - Raw positions from Hyperliquid API
 * @param dbPositions - Positions from database (for SL/TP/metadata)
 * @param detailedMarketData - Market data for current prices
 * @returns Converted positions array
 */
export function convertHyperliquidPositions(
  hyperliquidPositions: any[],
  dbPositions: any[],
  detailedMarketData: Record<string, any>
): any[] {
  return hyperliquidPositions
    .map((hlPos: any) => {
      const pos = hlPos.position || hlPos;
      const coin = pos.coin;
      const szi = parseFloat(pos.szi || "0");

      // Skip positions with zero size
      if (szi === 0) return null;

      const entryPx = parseFloat(pos.entryPx || "0");
      const leverage = parseFloat(pos.leverage?.value || pos.leverage || "1");
      const unrealizedPnl = parseFloat(pos.unrealizedPnl || "0");
      const positionValue = Math.abs(parseFloat(pos.positionValue || "0"));
      const liquidationPx = parseFloat(pos.liquidationPx || "0");

      // Get current price from market data
      const currentPrice = detailedMarketData[coin]?.currentPrice || entryPx;

      // Calculate P&L percentage
      const unrealizedPnlPct = positionValue > 0 ? (unrealizedPnl / Math.abs(positionValue)) * 100 : 0;

      // Look up additional data from database (stop loss, take profit, etc.)
      const dbPos = dbPositions.find((p: any) => p.symbol === coin);

      return {
        symbol: coin,
        side: szi > 0 ? "LONG" : "SHORT",
        size: Math.abs(positionValue),
        leverage,
        entryPrice: entryPx,
        currentPrice,
        unrealizedPnl,
        unrealizedPnlPct,
        liquidationPrice: liquidationPx,
        // Include database data if available
        stopLoss: dbPos?.stopLoss,
        takeProfit: dbPos?.takeProfit,
        invalidationCondition: dbPos?.invalidationCondition,
        entryReasoning: dbPos?.entryReasoning,
        confidence: dbPos?.confidence,
        openedAt: dbPos?.openedAt || dbPos?._creationTime,
      };
    })
    .filter((p: any): p is NonNullable<typeof p> => p !== null);
}

/**
 * Extract symbols with non-zero positions from Hyperliquid position data.
 */
export function extractHyperliquidSymbols(hyperliquidPositions: any[]): string[] {
  return hyperliquidPositions
    .map((p: any) => {
      const coin = p.position?.coin || p.coin;
      const szi = p.position?.szi || p.szi || "0";
      return parseFloat(szi) !== 0 ? coin : null;
    })
    .filter((s: string | null): s is string => s !== null);
}
