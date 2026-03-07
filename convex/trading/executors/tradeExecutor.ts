/**
 * Trade Executor
 *
 * Handles the actual execution of open and close trade decisions,
 * including stop loss/take profit placement, retry logic, and
 * emergency close on failure.
 */

import { recordTradeOutcome } from "../circuitBreaker";
import { createLogger, withTiming } from "../logger";
import { recordTradeInMemory } from "../validators/positionValidator";
import { internal } from "../../fnRefs";
import {
  MANAGED_EXIT_MODE,
  LEGACY_EXIT_MODE,
  type ManagedExitMode,
  calculateHardStopPrice,
  clampManagedStop,
  getManagedExitRules,
} from "../managedExitUtils";

/**
 * Execute a CLOSE trade decision.
 * Queries actual position size from Hyperliquid and closes it.
 */
export async function executeClose(
  ctx: any,
  api: any,
  bot: any,
  credentials: any,
  decision: any
): Promise<void> {
  const log = createLogger("EXECUTOR", undefined, bot.userId);

  // Get the position to close from database
  const positions = await ctx.runQuery(api.queries.getPositions, {
    userId: bot.userId,
  });

  let positionToClose = positions.find((p: any) => p.symbol === decision.symbol);

  // ═══════════════════════════════════════════════════════════════
  // Fetch actual position from Hyperliquid
  // If DB is empty (e.g., positions opened before DB tracking),
  // build positionToClose from Hyperliquid data.
  // ═══════════════════════════════════════════════════════════════
  let actualSize: number;

  try {
    const hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
      address: credentials.hyperliquidAddress,
      testnet: credentials.hyperliquidTestnet,
    });

    // Find the actual position on Hyperliquid
    const actualPosition = hyperliquidPositions.find((p: any) => {
      const coin = p.position?.coin || p.coin;
      return coin === decision.symbol;
    });

    if (!actualPosition) {
      log.warn(`No actual position on Hyperliquid for ${decision.symbol}, removing from database`);
      if (positionToClose) {
        let exitPrice = positionToClose.currentPrice || positionToClose.entryPrice || 0;
        try {
          const currentMarket = await ctx.runAction(api.hyperliquid.client.getMarketData, {
            symbols: [decision.symbol],
            testnet: credentials.hyperliquidTestnet,
          });
          exitPrice = currentMarket[decision.symbol]?.price || exitPrice;
        } catch {
          /* use DB fallback */
        }

        const entryPrice = positionToClose.entryPrice || exitPrice;
        const estimatedCoinSize =
          entryPrice > 0 ? Math.abs(positionToClose.size || 0) / entryPrice : 0;
        const estimatedPnl =
          positionToClose.side === "LONG"
            ? (exitPrice - entryPrice) * estimatedCoinSize
            : (entryPrice - exitPrice) * estimatedCoinSize;
        const notionalEntry = entryPrice * estimatedCoinSize;
        const estimatedPnlPct =
          notionalEntry > 0 ? (estimatedPnl / notionalEntry) * 100 : 0;

        await ctx.runMutation(api.mutations.saveTrade, {
          userId: bot.userId,
          symbol: decision.symbol,
          action: "CLOSE",
          side: positionToClose.side,
          size: Math.abs(positionToClose.size || 0),
          leverage: positionToClose.leverage || 1,
          price: exitPrice,
          pnl: Number.isFinite(estimatedPnl) ? estimatedPnl : 0,
          pnlPct: Number.isFinite(estimatedPnlPct) ? estimatedPnlPct : 0,
          aiReasoning: `${decision.reasoning} | reconciled_missing_on_exchange`,
          aiModel: bot.modelName,
          confidence: decision.confidence,
          txHash: "reconciled_missing_on_exchange",
        });

        await ctx.runMutation(api.mutations.closePosition, {
          userId: bot.userId,
          symbol: decision.symbol,
        });
      }
      return;
    }

    // Get the actual size from Hyperliquid (szi is signed)
    const pos = actualPosition.position || actualPosition;
    const szi = pos.szi || "0";
    actualSize = Math.abs(parseFloat(szi));

    // If DB position is missing, build it from Hyperliquid data
    if (!positionToClose) {
      log.warn(`No DB position for ${decision.symbol} — building from Hyperliquid data`);
      const entryPx = parseFloat(pos.entryPx || "0");
      const unrealizedPnl = parseFloat(pos.unrealizedPnl || "0");
      const positionValue = Math.abs(parseFloat(pos.positionValue || "0"));
      const leverage = parseFloat(pos.leverage?.value || pos.leverage || "1");

      positionToClose = {
        symbol: decision.symbol,
        side: parseFloat(szi) > 0 ? "LONG" : "SHORT",
        size: positionValue,
        leverage,
        entryPrice: entryPx,
        currentPrice: entryPx,
        unrealizedPnl,
        unrealizedPnlPct: positionValue > 0 ? (unrealizedPnl / Math.abs(positionValue)) * 100 : 0,
      };
    }
  } catch (error) {
    // API unavailable — use DB position data as fallback
    if (!positionToClose) {
      log.error(`Cannot close ${decision.symbol} — no DB position and Hyperliquid API unavailable`);
      return;
    }

    log.warn(`Hyperliquid API unavailable, using DB position data for close: ${error instanceof Error ? error.message : String(error)}`);

    // Convert DB size (USD) to coin size using the position's entry price
    const fallbackPrice = positionToClose.currentPrice || positionToClose.entryPrice;
    if (!fallbackPrice || fallbackPrice <= 0) {
      log.error(`Cannot close ${decision.symbol} — no price data available and API is down`);
      return;
    }
    actualSize = Math.abs(positionToClose.size || 0) / fallbackPrice;
  }

  log.info(`Closing ${decision.symbol} position`, {
    databaseSize: positionToClose.size,
    actualSize,
    side: positionToClose.side,
  });

  // Cancel existing TP/SL orders before closing to avoid orphaned trigger orders
  try {
    const cancelResult = await ctx.runAction(api.hyperliquid.client.cancelTriggerOrdersForSymbol, {
      privateKey: credentials.hyperliquidPrivateKey,
      address: credentials.hyperliquidAddress,
      symbol: decision.symbol,
      testnet: credentials.hyperliquidTestnet,
    });
    if (cancelResult.cancelledCount > 0) {
      log.info(`Cancelled ${cancelResult.cancelledCount} existing TP/SL orders for ${decision.symbol} before closing`);
    }
  } catch (cancelError) {
    log.warn(`Failed to cancel existing orders for ${decision.symbol} (proceeding with close): ${cancelError instanceof Error ? cancelError.message : String(cancelError)}`);
  }

  // Close position (opposite side)
  const result = await ctx.runAction(api.hyperliquid.client.closePosition, {
    privateKey: credentials.hyperliquidPrivateKey,
    address: credentials.hyperliquidAddress,
    symbol: decision.symbol,
    size: actualSize,
    isBuy: positionToClose.side === "SHORT",
    testnet: credentials.hyperliquidTestnet,
  });

  // Prefer actual fill price from exchange over estimated market price
  let exitPrice = result.avgPx || result.price || positionToClose.currentPrice || 0;

  // Only fall back to market data if no fill price from exchange
  if (!result.avgPx) {
    try {
      const currentMarket = await ctx.runAction(api.hyperliquid.client.getMarketData, {
        symbols: [decision.symbol],
        testnet: credentials.hyperliquidTestnet,
      });
      exitPrice = currentMarket[decision.symbol]?.price || exitPrice;
    } catch {
      /* Use existing price as fallback */
    }
  }

  // Calculate realized P&L from entry/exit and actual closed size.
  const entryPrice = positionToClose.entryPrice || exitPrice;
  const realizedPnlRaw =
    positionToClose.side === "LONG"
      ? (exitPrice - entryPrice) * actualSize
      : (entryPrice - exitPrice) * actualSize;
  const notionalEntry = entryPrice * actualSize;
  const realizedPnlPctRaw =
    notionalEntry > 0 ? (realizedPnlRaw / notionalEntry) * 100 : 0;
  const realizedPnl = Number.isFinite(realizedPnlRaw) ? realizedPnlRaw : 0;
  const realizedPnlPct = Number.isFinite(realizedPnlPctRaw) ? realizedPnlPctRaw : 0;

  // Save trade record with actual P&L data
  await ctx.runMutation(api.mutations.saveTrade, {
    userId: bot.userId,
    symbol: decision.symbol,
    action: "CLOSE",
    side: positionToClose.side,
    size: Math.abs(positionToClose.size || 0),
    leverage: positionToClose.leverage || 1,
    price: exitPrice,
    pnl: realizedPnl,
    pnlPct: realizedPnlPct,
    aiReasoning: decision.reasoning,
    aiModel: bot.modelName,
    confidence: decision.confidence,
    txHash: result.txHash,
  });

  // Remove position from database
  await ctx.runMutation(api.mutations.closePosition, {
    userId: bot.userId,
    symbol: decision.symbol,
  });

  // Telegram notification (fire-and-forget)
  try {
    const pnl = realizedPnl;
    const pnlPct = realizedPnlPct;
    const durationMs = Date.now() - (positionToClose.openedAt ?? Date.now());
    ctx.runAction(internal.telegram.notifier.notifyTradeClosed, {
      userId: bot.userId,
      symbol: decision.symbol,
      side: positionToClose.side,
      entryPrice: positionToClose.entryPrice,
      exitPrice,
      pnl,
      pnlPct,
      durationMs,
    });
  } catch (e) {
    // Telegram failure must never block trading
  }

  // ✅ CIRCUIT BREAKER: Record trade outcome (win/loss)
  const tradeWon = realizedPnl >= 0;
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
    userId: bot.userId,
    circuitBreakerState: tradeOutcomeState.circuitBreakerState,
    consecutiveLosses: tradeOutcomeState.consecutiveLosses,
    circuitBreakerTrippedAt: tradeOutcomeState.circuitBreakerTrippedAt,
  });

  if (tradeOutcomeState.circuitBreakerState === "tripped") {
    log.error(`CIRCUIT BREAKER TRIPPED after ${tradeOutcomeState.consecutiveLosses} consecutive losses`);
  }
}

/**
 * Execute an OPEN trade decision.
 * Places market order, mandatory stop loss (with retry), take profit,
 * and emergency close on SL failure.
 */
export async function executeOpen(
  ctx: any,
  api: any,
  bot: any,
  credentials: any,
  decision: any,
  accountState: any
): Promise<void> {
  const log = createLogger("EXECUTOR", undefined, bot.userId);

  // Get current market price to convert USD to coin size
  const currentPrice = await ctx.runAction(api.hyperliquid.client.getMarketData, {
    symbols: [decision.symbol!],
    testnet: credentials.hyperliquidTestnet,
  });

  const entryPrice = currentPrice[decision.symbol!]?.price || 0;
  if (entryPrice === 0) {
    throw new Error(`Cannot get market price for ${decision.symbol}`);
  }

  // Convert USD size to coin size
  const sizeInCoins = decision.size_usd! / entryPrice;

  log.info(`Opening position: ${decision.symbol} ${decision.decision}`, {
    sizeUsd: decision.size_usd,
    entryPrice,
    sizeInCoins: sizeInCoins.toFixed(4),
    leverage: decision.leverage,
  });

  // Risk/Reward logging
  logRiskReward(decision, entryPrice);

  // Open new position
  const { result, durationMs: orderDurationMs } = await withTiming<any>(
    `placeOrder(${decision.symbol})`,
    () => ctx.runAction(api.hyperliquid.client.placeOrder, {
      privateKey: credentials.hyperliquidPrivateKey,
      address: credentials.hyperliquidAddress,
      symbol: decision.symbol!,
      isBuy: decision.decision === "OPEN_LONG",
      size: sizeInCoins,
      leverage: decision.leverage!,
      price: entryPrice,
      testnet: credentials.hyperliquidTestnet,
    }),
    log
  );

  const isLongPosition = decision.decision === "OPEN_LONG";
  const positionSide = isLongPosition ? "LONG" : "SHORT";
  const managedExitRules = getManagedExitRules(bot);
  const managedExitEnabled = managedExitRules.managedExitEnabled;

  // ═══════════════════════════════════════════════════════════════
  // VALIDATE & FIX TP/SL VALUES
  // ═══════════════════════════════════════════════════════════════

  // Detect if AI returned percentages instead of absolute prices
  // e.g., stop_loss: 0.03 (3%) instead of $97,000 for BTC
  if (decision.stop_loss && decision.stop_loss < entryPrice * 0.1) {
    // Looks like a percentage (less than 10% of entry price)
    const pct = decision.stop_loss <= 1 ? decision.stop_loss : decision.stop_loss / 100;
    const corrected = isLongPosition
      ? entryPrice * (1 - pct)
      : entryPrice * (1 + pct);
    console.log(`⚠️ stop_loss looks like a percentage (${decision.stop_loss}), converting: $${decision.stop_loss} → $${corrected.toFixed(2)}`);
    decision.stop_loss = corrected;
  }

  if (decision.take_profit && decision.take_profit < entryPrice * 0.1) {
    // Looks like a percentage (less than 10% of entry price)
    const pct = decision.take_profit <= 1 ? decision.take_profit : decision.take_profit / 100;
    const corrected = isLongPosition
      ? entryPrice * (1 + pct)
      : entryPrice * (1 - pct);
    console.log(`⚠️ take_profit looks like a percentage (${decision.take_profit}), converting: $${decision.take_profit} → $${corrected.toFixed(2)}`);
    decision.take_profit = corrected;
  }

  // Validate SL direction: LONG SL must be below entry, SHORT SL must be above entry
  if (decision.stop_loss) {
    if (isLongPosition && decision.stop_loss >= entryPrice) {
      const corrected = entryPrice * 0.97;
      console.log(`⚠️ LONG stop_loss ($${decision.stop_loss}) >= entry ($${entryPrice}), correcting to 3% below: $${corrected.toFixed(2)}`);
      decision.stop_loss = corrected;
    } else if (!isLongPosition && decision.stop_loss <= entryPrice) {
      const corrected = entryPrice * 1.03;
      console.log(`⚠️ SHORT stop_loss ($${decision.stop_loss}) <= entry ($${entryPrice}), correcting to 3% above: $${corrected.toFixed(2)}`);
      decision.stop_loss = corrected;
    }
  }

  // Validate TP direction: LONG TP must be above entry, SHORT TP must be below entry
  if (decision.take_profit) {
    if (isLongPosition && decision.take_profit <= entryPrice) {
      const corrected = entryPrice * 1.008;
      console.log(`⚠️ LONG take_profit ($${decision.take_profit}) <= entry ($${entryPrice}), correcting to 0.8% above: $${corrected.toFixed(2)}`);
      decision.take_profit = corrected;
    } else if (!isLongPosition && decision.take_profit >= entryPrice) {
      const corrected = entryPrice * 0.992;
      console.log(`⚠️ SHORT take_profit ($${decision.take_profit}) >= entry ($${entryPrice}), correcting to 0.8% below: $${corrected.toFixed(2)}`);
      decision.take_profit = corrected;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // MANDATORY STOP LOSS WITH RETRY AND CLOSE-ON-FAILURE
  // ═══════════════════════════════════════════════════════════════

  // Default to 3% stop loss if AI didn't specify one
  if (!decision.stop_loss) {
    decision.stop_loss = isLongPosition
      ? entryPrice * 0.97
      : entryPrice * 1.03;
    console.log(`⚠️ No stop loss specified, using default 3%: $${decision.stop_loss.toFixed(2)}`);
  }

  // Default to 0.8% take profit if AI didn't specify one
  if (!managedExitEnabled && !decision.take_profit) {
    decision.take_profit = isLongPosition
      ? entryPrice * 1.008
      : entryPrice * 0.992;
    console.log(`⚠️ No take profit specified, using default 0.8%: $${decision.take_profit.toFixed(2)}`);
  }

  const filledEntryPrice = result.avgPx || result.price;
  let managedStopPrice: number | undefined;
  let exitMode: ManagedExitMode = LEGACY_EXIT_MODE;
  let exitRulesSnapshot: any = undefined;

  if (managedExitEnabled) {
    const configuredHardStop = calculateHardStopPrice(
      filledEntryPrice,
      positionSide,
      managedExitRules.managedExitHardStopLossPct
    );
    decision.stop_loss = clampManagedStop(positionSide, decision.stop_loss, configuredHardStop);
    decision.take_profit = undefined;
    managedStopPrice = decision.stop_loss;
    exitMode = MANAGED_EXIT_MODE;
    exitRulesSnapshot = {
      ...managedExitRules,
      managedExitEnabled: true,
    };
    console.log(`⚙️ Managed exit enabled for ${decision.symbol}: initial stop set to $${decision.stop_loss.toFixed(2)}`);
  }

  log.info(`TP/SL values for ${decision.symbol}:`, {
    entryPrice: filledEntryPrice,
    stopLoss: decision.stop_loss,
    takeProfit: decision.take_profit,
    slDistancePct: ((Math.abs(filledEntryPrice - decision.stop_loss) / filledEntryPrice) * 100).toFixed(2) + "%",
    tpDistancePct: decision.take_profit
      ? ((Math.abs(decision.take_profit - filledEntryPrice) / filledEntryPrice) * 100).toFixed(2) + "%"
      : "managed",
    exitMode,
  });

  // ═══════════════════════════════════════════════════════════════
  // SAVE TRADE + POSITION FIRST (before TP/SL)
  // This ensures the position is tracked even if TP/SL placement fails
  // ═══════════════════════════════════════════════════════════════

  // Save trade record
  await ctx.runMutation(api.mutations.saveTrade, {
    userId: bot.userId,
    symbol: decision.symbol!,
    action: "OPEN",
    side: decision.decision === "OPEN_LONG" ? "LONG" : "SHORT",
    size: decision.size_usd!,
    leverage: decision.leverage!,
    price: filledEntryPrice,
    aiReasoning: decision.reasoning,
    aiModel: bot.modelName,
    confidence: decision.confidence,
    txHash: result.txHash,
  });

  // Generate invalidation condition
  const invalidationCondition = generateInvalidationCondition(
    decision.symbol!,
    positionSide,
    filledEntryPrice,
    decision.stop_loss
  );

  // Save position to database
  await ctx.runMutation(api.mutations.savePosition, {
    userId: bot.userId,
    symbol: decision.symbol!,
    side: positionSide,
    size: decision.size_usd!,
    leverage: decision.leverage!,
    entryPrice: filledEntryPrice,
    currentPrice: filledEntryPrice,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    stopLoss: decision.stop_loss,
    takeProfit: decision.take_profit,
    liquidationPrice: filledEntryPrice * (decision.decision === "OPEN_LONG" ? 0.9 : 1.1),
    exitMode,
    managedPeakPrice: managedExitEnabled ? filledEntryPrice : undefined,
    managedStopPrice,
    managedStopReason: managedExitEnabled ? "hard_stop" : undefined,
    exitRulesSnapshot,
    invalidationCondition,
    entryReasoning: decision.reasoning,
    confidence: decision.confidence,
    entryOrderId: result.txHash,
  });

  log.info(`Successfully executed ${decision.decision} for ${decision.symbol} at $${result.price}`, {
    orderDurationMs,
    txHash: result.txHash,
  });

  // ═══════════════════════════════════════════════════════════════
  // PLACE TP/SL ORDERS (position is already saved above)
  // ═══════════════════════════════════════════════════════════════

  const stopLossPlaced = await placeStopLossWithRetry(
    ctx, api, credentials, decision, sizeInCoins, isLongPosition, filledEntryPrice, bot
  );

  let takeProfitPlaced = false;
  if (!managedExitEnabled) {
    // Place take-profit regardless of SL result (they're independent)
    takeProfitPlaced = await placeTakeProfitWithRetry(
      ctx, api, credentials, decision, sizeInCoins, isLongPosition, filledEntryPrice, bot
    );
  }

  // CRITICAL: If stop loss failed after all retries, emergency close
  if (!stopLossPlaced) {
    await emergencyClose(ctx, api, credentials, decision, bot, sizeInCoins, isLongPosition, filledEntryPrice);
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // VERIFY TP/SL ORDERS ACTUALLY EXIST ON EXCHANGE
  // ═══════════════════════════════════════════════════════════════
  try {
    // Small delay to let orders propagate
    await new Promise(resolve => setTimeout(resolve, 500));

    const verification = await ctx.runAction(api.hyperliquid.client.verifyTpSlOrders, {
      address: credentials.hyperliquidAddress,
      symbol: decision.symbol!,
      testnet: credentials.hyperliquidTestnet,
    });

    if (!verification.hasSl) {
      console.error(`🚨 VERIFICATION FAILED: No stop-loss order found on exchange for ${decision.symbol}!`);
      console.error(`   Expected SL at $${decision.stop_loss} — order may not have been placed correctly`);
      await ctx.runMutation(api.mutations.saveSystemLog, {
        userId: bot.userId,
        level: "CRITICAL",
        message: `TP/SL verification: No SL found on exchange for ${decision.symbol}`,
        data: {
          symbol: decision.symbol,
          expectedSl: decision.stop_loss,
          expectedTp: decision.take_profit,
          ordersFound: verification.orders,
        },
      });
    }

    if (!managedExitEnabled && !verification.hasTp) {
      console.warn(`⚠️ VERIFICATION: No take-profit order found on exchange for ${decision.symbol}`);
    }

    if (managedExitEnabled && verification.hasSl) {
      console.log(`✅ Managed stop verification passed for ${decision.symbol}: SL confirmed on exchange`);
    } else if (!managedExitEnabled && verification.hasSl && verification.hasTp) {
      console.log(`✅ TP/SL verification passed for ${decision.symbol}: SL and TP confirmed on exchange`);
    }
  } catch (verifyError) {
    console.warn(`⚠️ TP/SL verification skipped (non-critical):`, verifyError instanceof Error ? verifyError.message : String(verifyError));
  }

  // Telegram notification (fire-and-forget)
  try {
    ctx.runAction(internal.telegram.notifier.notifyTradeOpened, {
      userId: bot.userId,
      symbol: decision.symbol!,
      side: decision.decision === "OPEN_LONG" ? "LONG" : "SHORT",
      sizeUsd: decision.size_usd!,
      leverage: decision.leverage!,
      entryPrice: filledEntryPrice,
      stopLoss: decision.stop_loss,
      takeProfit: managedExitEnabled ? undefined : decision.take_profit,
      confidence: decision.confidence,
      reasoning: decision.reasoning || "",
    });
  } catch (e) {
    // Telegram failure must never block trading
  }

  // Update in-memory tracker
  const side = decision.decision === "OPEN_LONG" ? "LONG" : "SHORT";
  recordTradeInMemory(decision.symbol!, side);
}

export async function replaceManagedStopOrder(
  ctx: any,
  api: any,
  credentials: any,
  position: any,
  sizeInCoins: number,
  stopPrice: number
): Promise<void> {
  await ctx.runAction(api.hyperliquid.client.cancelTriggerOrdersForSymbol, {
    privateKey: credentials.hyperliquidPrivateKey,
    address: credentials.hyperliquidAddress,
    symbol: position.symbol,
    testnet: credentials.hyperliquidTestnet,
  });

  const slResult = await ctx.runAction(api.hyperliquid.client.placeStopLoss, {
    privateKey: credentials.hyperliquidPrivateKey,
    symbol: position.symbol,
    size: sizeInCoins,
    triggerPrice: stopPrice,
    isLongPosition: position.side === "LONG",
    testnet: credentials.hyperliquidTestnet,
  });

  if (!slResult?.success) {
    throw new Error(`Failed to replace managed stop for ${position.symbol}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function logRiskReward(decision: any, entryPrice: number): void {
  if (decision.stop_loss && decision.take_profit) {
    let riskDistance: number;
    let rewardDistance: number;

    if (decision.decision === "OPEN_LONG") {
      riskDistance = entryPrice - decision.stop_loss;
      rewardDistance = decision.take_profit - entryPrice;
    } else {
      riskDistance = decision.stop_loss - entryPrice;
      rewardDistance = entryPrice - decision.take_profit;
    }

    const rrRatio = riskDistance > 0 ? rewardDistance / riskDistance : 0;
    const tpPercent = ((rewardDistance / entryPrice) * 100).toFixed(2);
    const slPercent = ((riskDistance / entryPrice) * 100).toFixed(2);

    console.log(`  Take Profit: ${tpPercent}% from entry | Stop Loss: ${slPercent}% from entry`);
    console.log(`  Risk/Reward: ${rrRatio.toFixed(2)}:1 (scalping mode - tight TP for high win rate)`);
    console.log(`    Risk: $${riskDistance.toFixed(2)} | Reward: $${rewardDistance.toFixed(2)}`);
  } else {
    console.log(`⚠️ R:R check skipped: Missing stop_loss or take_profit`);
  }
}

async function placeStopLossWithRetry(
  ctx: any, api: any, credentials: any, decision: any,
  sizeInCoins: number, isLongPosition: boolean, entryPrice: number, bot: any
): Promise<boolean> {
  let stopLossPlaced = false;
  const MAX_SL_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_SL_RETRIES && !stopLossPlaced; attempt++) {
    // Before retrying, check if a previous attempt already landed on the exchange
    if (attempt > 1) {
      try {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Let exchange settle
        const existing = await ctx.runAction(api.hyperliquid.client.verifyTpSlOrders, {
          address: credentials.hyperliquidAddress,
          symbol: decision.symbol!,
          testnet: credentials.hyperliquidTestnet,
        });
        if (existing.hasSl) {
          console.log(`✅ Stop-loss already exists on exchange (detected before retry ${attempt}) — skipping`);
          return true;
        }
      } catch (e) {
        console.warn(`⚠️ Could not verify existing SL before retry:`, e instanceof Error ? e.message : String(e));
      }
    }

    try {
      console.log(`Placing stop-loss order at $${decision.stop_loss} (attempt ${attempt}/${MAX_SL_RETRIES})...`);
      const slResult = await ctx.runAction(api.hyperliquid.client.placeStopLoss, {
        privateKey: credentials.hyperliquidPrivateKey,
        symbol: decision.symbol!,
        size: sizeInCoins,
        triggerPrice: decision.stop_loss,
        isLongPosition,
        testnet: credentials.hyperliquidTestnet,
      });

      if (slResult && slResult.success === true) {
        stopLossPlaced = true;
        console.log(`✅ Stop-loss placed successfully at $${decision.stop_loss} (txHash: ${slResult.txHash})`);
      } else {
        console.error(`❌ Stop-loss returned unexpected result:`, JSON.stringify(slResult));
      }
    } catch (error) {
      console.error(`❌ Stop-loss attempt ${attempt} failed:`, error);
      if (attempt < MAX_SL_RETRIES) {
        const delayMs = 2000 * attempt; // 2s, 4s
        console.log(`⏳ Waiting ${delayMs / 1000}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  return stopLossPlaced;
}

async function placeTakeProfitWithRetry(
  ctx: any, api: any, credentials: any, decision: any,
  sizeInCoins: number, isLongPosition: boolean, entryPrice: number, bot: any
): Promise<boolean> {
  let takeProfitPlaced = false;
  const MAX_TP_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_TP_RETRIES && !takeProfitPlaced; attempt++) {
    // Before retrying, check if a previous attempt already landed on the exchange
    if (attempt > 1) {
      try {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Let exchange settle
        const existing = await ctx.runAction(api.hyperliquid.client.verifyTpSlOrders, {
          address: credentials.hyperliquidAddress,
          symbol: decision.symbol!,
          testnet: credentials.hyperliquidTestnet,
        });
        if (existing.hasTp) {
          console.log(`✅ Take-profit already exists on exchange (detected before retry ${attempt}) — skipping`);
          return true;
        }
      } catch (e) {
        console.warn(`⚠️ Could not verify existing TP before retry:`, e instanceof Error ? e.message : String(e));
      }
    }

    try {
      console.log(`Placing take-profit order at $${decision.take_profit} (attempt ${attempt}/${MAX_TP_RETRIES})...`);
      const tpResult = await ctx.runAction(api.hyperliquid.client.placeTakeProfit, {
        privateKey: credentials.hyperliquidPrivateKey,
        symbol: decision.symbol!,
        size: sizeInCoins,
        triggerPrice: decision.take_profit,
        isLongPosition,
        testnet: credentials.hyperliquidTestnet,
      });

      if (tpResult && tpResult.success === true) {
        takeProfitPlaced = true;
        console.log(`✅ Take-profit placed successfully at $${decision.take_profit} (txHash: ${tpResult.txHash})`);
      } else {
        console.error(`❌ Take-profit returned unexpected result:`, JSON.stringify(tpResult));
      }
    } catch (error) {
      console.error(`❌ Take-profit attempt ${attempt} failed:`, error);
      if (attempt < MAX_TP_RETRIES) {
        const delayMs = 2000 * attempt; // 2s, 4s
        console.log(`⏳ Waiting ${delayMs / 1000}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  if (!takeProfitPlaced) {
    console.warn(`⚠️ Take-profit failed after ${MAX_TP_RETRIES} attempts - position is open without TP`);
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "WARNING",
      message: `Take-profit placement failed - position open without TP`,
      data: {
        symbol: decision.symbol,
        takeProfit: decision.take_profit,
        entryPrice,
        sizeInCoins,
      },
    });
  }

  return takeProfitPlaced;
}

async function emergencyClose(
  ctx: any, api: any, credentials: any, decision: any,
  bot: any, sizeInCoins: number, isLongPosition: boolean, entryPrice: number
): Promise<void> {
  const MAX_SL_RETRIES = 2;
  console.error(`🚨 CRITICAL: Stop loss failed after ${MAX_SL_RETRIES} attempts. Closing position for safety.`);
  await ctx.runMutation(api.mutations.saveSystemLog, {
    userId: bot.userId,
    level: "CRITICAL",
    message: `Stop loss placement failed - closing position for safety`,
    data: {
      symbol: decision.symbol,
      stopLoss: decision.stop_loss,
      entryPrice,
      sizeInCoins,
    },
  });

  try {
    await ctx.runAction(api.hyperliquid.client.closePosition, {
      privateKey: credentials.hyperliquidPrivateKey,
      address: credentials.hyperliquidAddress,
      symbol: decision.symbol!,
      size: sizeInCoins,
      isBuy: !isLongPosition,
      testnet: credentials.hyperliquidTestnet,
    });
    console.log(`✅ Position closed safely after SL failure`);

    await ctx.runMutation(api.mutations.saveTrade, {
      userId: bot.userId,
      symbol: decision.symbol!,
      action: "CLOSE",
      side: decision.decision === "OPEN_LONG" ? "LONG" : "SHORT",
      size: decision.size_usd!,
      leverage: decision.leverage!,
      price: entryPrice,
      aiReasoning: "EMERGENCY CLOSE: Stop loss placement failed",
      aiModel: bot.modelName,
      confidence: 1.0,
      txHash: "emergency-close",
    });
  } catch (closeError) {
    console.error(`🚨 CRITICAL: Failed to close position after SL failure:`, closeError);
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "CRITICAL",
      message: `UNPROTECTED POSITION: Failed to close after SL failure`,
      data: {
        symbol: decision.symbol,
        error: closeError instanceof Error ? closeError.message : String(closeError),
      },
    });
  }
}

/**
 * Generate invalidation condition description for a position.
 */
export function generateInvalidationCondition(
  symbol: string,
  side: string,
  entryPrice: number,
  stopLoss?: number
): string {
  if (!stopLoss) {
    const defaultStopPct = 0.05;
    const invalidationPrice = side === "LONG"
      ? entryPrice * (1 - defaultStopPct)
      : entryPrice * (1 + defaultStopPct);

    return `If ${symbol} price closes ${side === "LONG" ? "below" : "above"} $${invalidationPrice.toFixed(2)} (${(defaultStopPct * 100).toFixed(1)}% against entry) on 3-minute candle`;
  }

  const stopPct = Math.abs((stopLoss - entryPrice) / entryPrice) * 100;

  return `If ${symbol} price closes ${side === "LONG" ? "below" : "above"} $${stopLoss.toFixed(2)} (${stopPct.toFixed(1)}% stop loss) on 3-minute candle`;
}
