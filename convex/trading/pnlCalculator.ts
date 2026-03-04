/**
 * Shared PnL calculator to avoid duplicating math across close paths.
 */
export function calculatePnl(params: {
  side: string;
  entryPrice: number;
  exitPrice: number;
  sizeInCoins: number;
}): { pnl: number; pnlPct: number } {
  const { side, entryPrice, exitPrice, sizeInCoins } = params;

  const pnlRaw =
    side === "LONG"
      ? (exitPrice - entryPrice) * sizeInCoins
      : (entryPrice - exitPrice) * sizeInCoins;

  const notionalEntry = entryPrice * sizeInCoins;
  const pnlPctRaw = notionalEntry > 0 ? (pnlRaw / notionalEntry) * 100 : 0;

  return {
    pnl: Number.isFinite(pnlRaw) ? pnlRaw : 0,
    pnlPct: Number.isFinite(pnlPctRaw) ? pnlPctRaw : 0,
  };
}
