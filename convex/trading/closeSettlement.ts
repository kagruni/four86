import { calculatePnl } from "./pnlCalculator";

const FILL_LOOKBACK_MS = 60_000;
const FILL_LOOKAHEAD_MS = 120_000;
const FILL_POLL_ATTEMPTS = 5;
const FILL_POLL_DELAY_MS = 500;
const HISTORICAL_FILL_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const FILL_CLUSTER_WINDOW_MS = 5_000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getFallbackSizeInCoins(position: any, closeResult: any): number {
  if (closeResult?.totalSz) {
    return toNumber(closeResult.totalSz);
  }
  if (position?.entryPrice > 0 && position?.size) {
    return Math.abs(position.size) / position.entryPrice;
  }
  return 0;
}

function getOrderDirectionLabel(fill: any): string {
  return String(fill?.dir ?? "").toLowerCase();
}

function getStartPosition(fill: any): number {
  return toNumber(fill?.startPosition);
}

function isLikelyCloseFill(fill: any, side: string) {
  const dir = getOrderDirectionLabel(fill);
  const startPosition = getStartPosition(fill);

  if (dir.includes("close")) {
    return side === "SHORT" ? (dir.includes("short") || startPosition < 0) : (dir.includes("long") || startPosition > 0);
  }

  return side === "SHORT" ? startPosition < 0 : startPosition > 0;
}

function summarizeSettlementFills(params: {
  fills: any[];
  side: string;
  entryPrice: number;
  fallbackExitPrice: number;
  fallbackSizeInCoins: number;
  orderId?: number;
  pnlSource: string;
}) {
  const { fills, side, entryPrice, fallbackExitPrice, fallbackSizeInCoins, orderId, pnlSource } = params;

  const sizeInCoins = fills.reduce((sum: number, fill: any) => sum + toNumber(fill.sz), 0);
  const tradeValueUsd = fills.reduce((sum: number, fill: any) => sum + toNumber(fill.px) * toNumber(fill.sz), 0);
  const realizedPnlFromFills = fills.reduce((sum: number, fill: any) => sum + toNumber(fill.closedPnl), 0);
  const fee = fills.reduce((sum: number, fill: any) => sum + toNumber(fill.fee), 0);
  const fillTime = fills.reduce((latest: number, fill: any) => Math.max(latest, toNumber(fill.time)), 0);
  const feeToken = fills.find((fill: any) => fill.feeToken)?.feeToken;
  const exitPrice = sizeInCoins > 0 ? tradeValueUsd / sizeInCoins : fallbackExitPrice;
  const notionalEntry = entryPrice * (sizeInCoins || fallbackSizeInCoins);
  const grossPnl = calculatePnl({
    side,
    entryPrice,
    exitPrice,
    sizeInCoins: sizeInCoins || fallbackSizeInCoins,
  }).pnl;
  const netPnlFromGross = grossPnl - fee;
  const pnl =
    Math.abs(realizedPnlFromFills - netPnlFromGross) <= Math.abs(realizedPnlFromFills - grossPnl)
      ? realizedPnlFromFills
      : netPnlFromGross;
  const pnlPct = notionalEntry > 0 ? (pnl / notionalEntry) * 100 : undefined;

  return {
    exitPrice,
    sizeInCoins: sizeInCoins || fallbackSizeInCoins,
    tradeValueUsd: tradeValueUsd || fallbackExitPrice * fallbackSizeInCoins,
    pnl,
    pnlPct: pnlPct !== undefined && Number.isFinite(pnlPct) ? pnlPct : undefined,
    fee,
    feeToken,
    orderId,
    fillTime,
    grossPnl,
    pnlSource,
  };
}

function selectCloseFillCluster(params: {
  fills: any[];
  symbol: string;
  side: string;
  observedAt: number;
  expectedSizeInCoins: number;
  orderId?: number;
}) {
  const { fills, symbol, side, observedAt, expectedSizeInCoins, orderId } = params;
  const symbolFills = (fills || [])
    .filter((fill: any) => fill.coin === symbol)
    .sort((a: any, b: any) => toNumber(b.time) - toNumber(a.time));

  const strictOrderFills = typeof orderId === "number"
    ? symbolFills.filter((fill: any) => fill.oid === orderId)
    : [];

  if (strictOrderFills.length > 0) {
    const strictSize = strictOrderFills.reduce((sum: number, fill: any) => sum + toNumber(fill.sz), 0);
    if (!expectedSizeInCoins || strictSize >= expectedSizeInCoins * 0.95) {
      return strictOrderFills;
    }
  }

  const closeFills = symbolFills.filter((fill: any) => isLikelyCloseFill(fill, side));
  if (closeFills.length === 0) {
    return strictOrderFills;
  }

  const anchorIndex = closeFills.findIndex((fill: any) => Math.abs(toNumber(fill.time) - observedAt) <= FILL_LOOKAHEAD_MS);
  const anchor = closeFills[anchorIndex >= 0 ? anchorIndex : 0];
  const anchorTime = toNumber(anchor.time);

  const cluster: any[] = [];
  let cumulativeSize = 0;
  for (const fill of closeFills) {
    const fillTime = toNumber(fill.time);
    if (Math.abs(anchorTime - fillTime) > FILL_CLUSTER_WINDOW_MS) {
      if (cluster.length > 0) break;
      continue;
    }
    cluster.push(fill);
    cumulativeSize += toNumber(fill.sz);
    if (!expectedSizeInCoins || cumulativeSize >= expectedSizeInCoins * 0.98) {
      break;
    }
  }

  return cluster.length > 0 ? cluster : strictOrderFills;
}

export async function resolveCloseSettlement(
  ctx: any,
  api: any,
  params: {
    userId: string;
    address: string;
    testnet: boolean;
    symbol: string;
    side: string;
    entryPrice: number;
    position: any;
    closeResult: any;
    submittedAt: number;
  }
) {
  const {
    userId,
    address,
    testnet,
    symbol,
    side,
    entryPrice,
    position,
    closeResult,
    submittedAt,
  } = params;

  const fallbackExitPrice = closeResult?.avgPx || closeResult?.price || position?.currentPrice || entryPrice || 0;
  const fallbackSizeInCoins = getFallbackSizeInCoins(position, closeResult);
  const fallbackTradeValueUsd = fallbackExitPrice * fallbackSizeInCoins;
  const fallbackGross = calculatePnl({
    side,
    entryPrice,
    exitPrice: fallbackExitPrice,
    sizeInCoins: fallbackSizeInCoins,
  }).pnl;

  const unresolved = {
    exitPrice: fallbackExitPrice,
    sizeInCoins: fallbackSizeInCoins,
    tradeValueUsd: fallbackTradeValueUsd,
    pnl: undefined as number | undefined,
    pnlPct: undefined as number | undefined,
    fee: undefined as number | undefined,
    feeToken: undefined as string | undefined,
    orderId: closeResult?.orderId,
    fillTime: undefined as number | undefined,
    grossPnl: fallbackGross,
    pnlSource: "unresolved",
  };

  if (!closeResult?.orderId) {
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId,
      level: "WARN",
      message: `Close settlement unresolved for ${symbol}: missing orderId`,
      data: {
        symbol,
        txHash: closeResult?.txHash,
      },
    });
    return unresolved;
  }

  const startTime = Math.max(0, submittedAt - FILL_LOOKBACK_MS);

  for (let attempt = 1; attempt <= FILL_POLL_ATTEMPTS; attempt++) {
    try {
      const fills = await ctx.runAction(api.hyperliquid.client.getUserFillsByTime, {
        address,
        startTime,
        endTime: submittedAt + FILL_LOOKAHEAD_MS,
        testnet,
      });

      const matchingFills = selectCloseFillCluster({
        fills,
        symbol,
        side,
        observedAt: submittedAt,
        expectedSizeInCoins: fallbackSizeInCoins,
        orderId: closeResult.orderId,
      });

      if (matchingFills.length > 0) {
        return summarizeSettlementFills({
          fills: matchingFills,
          side,
          entryPrice,
          fallbackExitPrice,
          fallbackSizeInCoins,
          orderId: closeResult.orderId,
          pnlSource: matchingFills.every((fill: any) => fill.oid === closeResult.orderId)
            ? "exchange_fill"
            : "exchange_fill_window",
        });
      }
    } catch (error) {
      if (attempt === FILL_POLL_ATTEMPTS) {
        await ctx.runMutation(api.mutations.saveSystemLog, {
          userId,
          level: "WARN",
          message: `Close settlement lookup failed for ${symbol}`,
          data: {
            symbol,
            orderId: closeResult.orderId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    if (attempt < FILL_POLL_ATTEMPTS) {
      await delay(FILL_POLL_DELAY_MS);
    }
  }

  await ctx.runMutation(api.mutations.saveSystemLog, {
    userId,
    level: "WARN",
    message: `Close settlement unresolved for ${symbol}: no matching fill found`,
    data: {
      symbol,
      orderId: closeResult.orderId,
      txHash: closeResult.txHash,
      startTime,
    },
  });

  return unresolved;
}

export async function resolveHistoricalCloseSettlement(
  ctx: any,
  api: any,
  params: {
    userId: string;
    address: string;
    testnet: boolean;
    position: any;
    observedAt: number;
  }
) {
  const { userId, address, testnet, position, observedAt } = params;
  const fallbackExitPrice = position?.currentPrice || position?.entryPrice || 0;
  const fallbackSizeInCoins = position?.entryPrice > 0
    ? Math.abs(position?.size || 0) / position.entryPrice
    : 0;
  const fallbackTradeValueUsd = fallbackExitPrice * fallbackSizeInCoins;
  const fallbackGross = calculatePnl({
    side: position.side,
    entryPrice: position.entryPrice || fallbackExitPrice,
    exitPrice: fallbackExitPrice,
    sizeInCoins: fallbackSizeInCoins,
  }).pnl;

  const unresolved = {
    exitPrice: fallbackExitPrice,
    sizeInCoins: fallbackSizeInCoins,
    tradeValueUsd: fallbackTradeValueUsd,
    pnl: position?.unrealizedPnl,
    pnlPct: position?.unrealizedPnlPct,
    fee: undefined as number | undefined,
    feeToken: undefined as string | undefined,
    orderId: undefined as number | undefined,
    fillTime: undefined as number | undefined,
    grossPnl: fallbackGross,
    pnlSource: "reconciled_estimate",
  };

  const startTime = Math.max(
    0,
    (position?.openedAt ?? observedAt) - FILL_LOOKBACK_MS,
    observedAt - HISTORICAL_FILL_LOOKBACK_MS
  );

  try {
    const fills = await ctx.runAction(api.hyperliquid.client.getUserFillsByTime, {
      address,
      startTime,
      endTime: observedAt + FILL_LOOKAHEAD_MS,
      testnet,
    });

    const matchingFills = selectCloseFillCluster({
      fills,
      symbol: position.symbol,
      side: position.side,
      observedAt,
      expectedSizeInCoins: fallbackSizeInCoins,
    });

    if (matchingFills.length > 0) {
      return summarizeSettlementFills({
        fills: matchingFills,
        side: position.side,
        entryPrice: position.entryPrice || fallbackExitPrice,
        fallbackExitPrice,
        fallbackSizeInCoins,
        pnlSource: "exchange_fill_reconciled",
      });
    }
  } catch (error) {
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId,
      level: "WARN",
      message: `Historical close settlement lookup failed for ${position.symbol}`,
      data: {
        symbol: position.symbol,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  return unresolved;
}

export function buildCloseTradeFields(params: {
  position: any;
  settlement: Awaited<ReturnType<typeof resolveCloseSettlement>>;
  aiReasoning: string;
  aiModel: string;
  confidence?: number;
  txHash?: string;
}) {
  const { position, settlement, aiReasoning, aiModel, confidence, txHash } = params;

  return {
    symbol: position.symbol,
    action: "CLOSE",
    side: position.side,
    size: settlement.tradeValueUsd,
    sizeInCoins: settlement.sizeInCoins,
    tradeValueUsd: settlement.tradeValueUsd,
    leverage: position.leverage || 1,
    price: settlement.exitPrice,
    pnl: settlement.pnl,
    pnlPct: settlement.pnlPct,
    orderId: settlement.orderId,
    fillTime: settlement.fillTime,
    fee: settlement.fee,
    feeToken: settlement.feeToken,
    grossPnl: settlement.grossPnl,
    pnlSource: settlement.pnlSource,
    aiReasoning,
    aiModel,
    confidence,
    txHash,
  };
}
