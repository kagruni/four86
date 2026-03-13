"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../fnRefs";
import { buildCloseTradeFields, resolveCloseSettlement, resolveHistoricalCloseSettlement } from "./closeSettlement";
import { recordTradeOutcome } from "./circuitBreaker";

function normalizeWalletId(wallet: any) {
  return wallet?.walletId ?? undefined;
}

export async function closeSingleWalletPosition(
  ctx: any,
  params: {
    userId: string;
    bot: any;
    wallet: any;
    symbol: string;
    aiReasoning: string;
    aiModel: string;
    confidence?: number;
    countCircuitBreakerLoss?: boolean;
    executionGroupId?: string;
    notifyTelegram?: boolean;
  }
) {
  const {
    userId,
    bot,
    wallet,
    symbol,
    aiReasoning,
    aiModel,
    confidence,
    countCircuitBreakerLoss = false,
    executionGroupId,
    notifyTelegram = true,
  } = params;

  const walletId = normalizeWalletId(wallet);
  const positions = await ctx.runQuery(api.queries.getPositions, {
    userId,
    ...(walletId ? { walletId } : {}),
  });

  let positionToClose = (positions || []).find((position: any) => position.symbol === symbol);

  const hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
    address: wallet.hyperliquidAddress,
    testnet: wallet.hyperliquidTestnet,
  });

  const actualPosition = (hyperliquidPositions || []).find((position: any) => {
    const pos = position.position || position;
    return pos.coin === symbol && parseFloat(pos.szi || "0") !== 0;
  });

  if (!actualPosition) {
    if (!positionToClose) {
      throw new Error(`No open ${symbol} position found for wallet ${wallet.label}`);
    }

    const settlement = await resolveHistoricalCloseSettlement(ctx, api, {
      userId,
      address: wallet.hyperliquidAddress,
      testnet: wallet.hyperliquidTestnet,
      position: positionToClose,
      observedAt: Date.now(),
    });

    await ctx.runMutation(api.mutations.saveTrade, {
      userId,
      ...(walletId ? { walletId } : {}),
      ...(executionGroupId ? { executionGroupId } : {}),
      ...buildCloseTradeFields({
        position: positionToClose,
        settlement,
        aiReasoning: `${aiReasoning} | reconciled_missing_on_exchange`,
        aiModel,
        confidence,
        txHash: settlement.pnlSource === "reconciled_estimate"
          ? "reconciled_missing_on_exchange_estimate"
          : "reconciled_missing_on_exchange_fill",
      }),
    });

    await ctx.runMutation(api.mutations.closePosition, {
      userId,
      ...(walletId ? { walletId } : {}),
      symbol,
    });

    return {
      walletId: walletId ?? null,
      address: wallet.hyperliquidAddress,
      success: true,
      txHash: settlement.pnlSource,
      pnl: settlement.pnl,
      pnlPct: settlement.pnlPct,
      settlement,
    };
  }

  const pos = actualPosition.position || actualPosition;
  const szi = parseFloat(pos.szi || "0");
  const actualSize = Math.abs(szi);

  if (!positionToClose) {
    const entryPx = parseFloat(pos.entryPx || "0");
    const positionValue = Math.abs(parseFloat(pos.positionValue || "0"));
    const leverage = parseFloat(pos.leverage?.value || pos.leverage || "1");
    const unrealizedPnl = parseFloat(pos.unrealizedPnl || "0");
    positionToClose = {
      symbol,
      side: szi > 0 ? "LONG" : "SHORT",
      size: positionValue,
      leverage,
      entryPrice: entryPx,
      currentPrice: entryPx,
      unrealizedPnl,
      unrealizedPnlPct: positionValue > 0 ? (unrealizedPnl / positionValue) * 100 : 0,
      openedAt: Date.now(),
    };
  }

  await Promise.allSettled([
    ctx.runAction(api.hyperliquid.client.cancelAllOrdersForSymbol, {
      privateKey: wallet.hyperliquidPrivateKey,
      address: wallet.hyperliquidAddress,
      symbol,
      testnet: wallet.hyperliquidTestnet,
    }),
    ctx.runAction(api.hyperliquid.client.cancelTriggerOrdersForSymbol, {
      privateKey: wallet.hyperliquidPrivateKey,
      address: wallet.hyperliquidAddress,
      symbol,
      testnet: wallet.hyperliquidTestnet,
    }),
  ]);

  const closeSubmittedAt = Date.now();
  const result = await ctx.runAction(api.hyperliquid.client.closePosition, {
    privateKey: wallet.hyperliquidPrivateKey,
    address: wallet.hyperliquidAddress,
    symbol,
    size: actualSize,
    isBuy: positionToClose.side === "SHORT",
    testnet: wallet.hyperliquidTestnet,
  });

  if (result.status === "resting" && result.orderId) {
    await ctx.runAction(api.hyperliquid.client.cancelOrder, {
      privateKey: wallet.hyperliquidPrivateKey,
      address: wallet.hyperliquidAddress,
      symbol,
      orderId: result.orderId,
      testnet: wallet.hyperliquidTestnet,
    }).catch(() => null);
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
  const postClosePositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
    address: wallet.hyperliquidAddress,
    testnet: wallet.hyperliquidTestnet,
  });
  const remainingPosition = (postClosePositions || []).find((position: any) => {
    const nextPos = position.position || position;
    return nextPos.coin === symbol && parseFloat(nextPos.szi || "0") !== 0;
  });
  if (remainingPosition) {
    throw new Error(`Close for ${symbol} did not fully fill on wallet ${wallet.label}`);
  }

  const settlement = await resolveCloseSettlement(ctx, api, {
    userId,
    address: wallet.hyperliquidAddress,
    testnet: wallet.hyperliquidTestnet,
    symbol,
    side: positionToClose.side,
    entryPrice: positionToClose.entryPrice || result.avgPx || result.price || 0,
    position: positionToClose,
    closeResult: result,
    submittedAt: closeSubmittedAt,
  });

  await ctx.runMutation(api.mutations.saveTrade, {
    userId,
    ...(walletId ? { walletId } : {}),
    ...(executionGroupId ? { executionGroupId } : {}),
    ...buildCloseTradeFields({
      position: positionToClose,
      settlement,
      aiReasoning,
      aiModel,
      confidence,
      txHash: result.txHash,
    }),
  });

  await ctx.runMutation(api.mutations.closePosition, {
    userId,
    ...(walletId ? { walletId } : {}),
    symbol,
  });

  if (notifyTelegram) {
    ctx.runAction(internal.telegram.notifier.notifyTradeClosed, {
      userId,
      ...(walletId ? { walletId } : {}),
      symbol,
      side: positionToClose.side,
      entryPrice: positionToClose.entryPrice,
      exitPrice: settlement.exitPrice,
      pnl: settlement.pnl,
      pnlPct: settlement.pnlPct,
      durationMs: Date.now() - (positionToClose.openedAt ?? Date.now()),
    }).catch(() => null);
  }

  if (countCircuitBreakerLoss) {
    const tradeWon = (settlement.pnl ?? settlement.grossPnl) >= 0;
    const tradeOutcomeState = recordTradeOutcome(
      {
        circuitBreakerState: bot.circuitBreakerState,
        consecutiveAiFailures: bot.consecutiveAiFailures,
        consecutiveLosses: bot.consecutiveLosses,
        circuitBreakerTrippedAt: bot.circuitBreakerTrippedAt,
      },
      {
        maxConsecutiveLosses: bot.maxConsecutiveLosses,
      },
      tradeWon
    );
    await ctx.runMutation(api.mutations.updateCircuitBreakerState, {
      userId,
      circuitBreakerState: tradeOutcomeState.circuitBreakerState,
      consecutiveLosses: tradeOutcomeState.consecutiveLosses,
      circuitBreakerTrippedAt: tradeOutcomeState.circuitBreakerTrippedAt,
    });
  }

  return {
    walletId: walletId ?? null,
    address: wallet.hyperliquidAddress,
    success: true,
    txHash: result.txHash,
    pnl: settlement.pnl,
    pnlPct: settlement.pnlPct,
    settlement,
  };
}

export async function closeSymbolAcrossWalletsInternal(
  ctx: any,
  params: {
    userId: string;
    symbol: string;
    source: string;
  }
) {
  const [wallets, bot] = await Promise.all([
    ctx.runQuery(internal.wallets.queries.getActiveConnectedWalletsInternal, {
      userId: params.userId,
    }),
    ctx.runQuery(api.queries.getBotConfig, {
      userId: params.userId,
    }),
  ]);

  if (!wallets || wallets.length === 0) {
    return {
      requestedWalletCount: 0,
      closedWalletCount: 0,
      failedWalletCount: 0,
      results: [],
      error: "No active wallets configured",
    };
  }

  const executionGroupId = `manual-${params.source}-${params.symbol}-${Date.now()}`;
  const settled = await Promise.allSettled(
    wallets.map((wallet: any) =>
      closeSingleWalletPosition(ctx, {
        userId: params.userId,
        bot,
        wallet,
        symbol: params.symbol,
        aiReasoning: `Manual close via ${params.source}`,
        aiModel: "manual",
        confidence: 1,
        countCircuitBreakerLoss: false,
        executionGroupId,
        notifyTelegram: true,
      })
    )
  );

  const results = settled.map((result, index) => {
    const wallet = wallets[index];
    if (result.status === "fulfilled") {
      return {
        walletId: normalizeWalletId(wallet) ?? null,
        address: wallet.hyperliquidAddress,
        success: true,
        txHash: result.value.txHash ?? undefined,
        pnl: result.value.pnl ?? undefined,
        pnlPct: result.value.pnlPct ?? undefined,
      };
    }

    return {
      walletId: normalizeWalletId(wallet) ?? null,
      address: wallet.hyperliquidAddress,
      success: false,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });

  return {
    symbol: params.symbol,
    requestedWalletCount: wallets.length,
    closedWalletCount: results.filter((result) => result.success).length,
    failedWalletCount: results.filter((result) => !result.success).length,
    results,
    executionGroupId,
  };
}

export const closeSymbolAcrossWallets = action({
  args: {
    userId: v.string(),
    symbol: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => closeSymbolAcrossWalletsInternal(ctx, args),
});

export const closeAllSymbolsAcrossWallets = action({
  args: {
    userId: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const positions = await ctx.runQuery(api.queries.getPositions, {
      userId: args.userId,
    });
    const symbols = [...new Set((positions || []).map((position: any) => position.symbol))].filter(
      (symbol): symbol is string => typeof symbol === "string" && symbol.length > 0
    );

    const results = await Promise.all(
      symbols.map((symbol) =>
        closeSymbolAcrossWalletsInternal(ctx, {
          userId: args.userId,
          symbol,
          source: args.source,
        })
      )
    );

    return {
      symbolCount: symbols.length,
      results,
    };
  },
});
