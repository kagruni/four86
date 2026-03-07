import { calculatePnl } from "./pnlCalculator";

const FILL_LOOKBACK_MS = 60_000;
const FILL_POLL_ATTEMPTS = 5;
const FILL_POLL_DELAY_MS = 500;

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
        testnet,
      });

      const matchingFills = (fills || []).filter((fill: any) =>
        fill.coin === symbol && fill.oid === closeResult.orderId && fill.time >= startTime
      );

      if (matchingFills.length > 0) {
        const sizeInCoins = matchingFills.reduce((sum: number, fill: any) => sum + toNumber(fill.sz), 0);
        const tradeValueUsd = matchingFills.reduce((sum: number, fill: any) => sum + toNumber(fill.px) * toNumber(fill.sz), 0);
        const pnl = matchingFills.reduce((sum: number, fill: any) => sum + toNumber(fill.closedPnl), 0);
        const fee = matchingFills.reduce((sum: number, fill: any) => sum + toNumber(fill.fee), 0);
        const fillTime = matchingFills.reduce((latest: number, fill: any) => Math.max(latest, toNumber(fill.time)), 0);
        const feeToken = matchingFills.find((fill: any) => fill.feeToken)?.feeToken;
        const exitPrice = sizeInCoins > 0 ? tradeValueUsd / sizeInCoins : fallbackExitPrice;
        const notionalEntry = entryPrice * sizeInCoins;
        const pnlPct = notionalEntry > 0 ? (pnl / notionalEntry) * 100 : undefined;
        const grossPnl = calculatePnl({
          side,
          entryPrice,
          exitPrice,
          sizeInCoins,
        }).pnl;

        return {
          exitPrice,
          sizeInCoins,
          tradeValueUsd,
          pnl,
          pnlPct: pnlPct !== undefined && Number.isFinite(pnlPct) ? pnlPct : undefined,
          fee,
          feeToken,
          orderId: closeResult.orderId,
          fillTime,
          grossPnl,
          pnlSource: "exchange_fill",
        };
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
