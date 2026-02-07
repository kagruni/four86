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

  const positionToClose = positions.find((p: any) => p.symbol === decision.symbol);

  if (!positionToClose) {
    log.warn(`No position found for ${decision.symbol}, skipping close`);
    return;
  }

  // Get actual position size from Hyperliquid (not from database)
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
    await ctx.runMutation(api.mutations.closePosition, {
      userId: bot.userId,
      symbol: decision.symbol,
    });
    return;
  }

  // Get the actual size from Hyperliquid (szi is signed)
  const szi = actualPosition.position?.szi || actualPosition.szi || "0";
  const actualSize = Math.abs(parseFloat(szi));

  log.info(`Closing ${decision.symbol} position`, {
    databaseSize: positionToClose.size,
    actualSize,
    side: positionToClose.side,
  });

  // Close position (opposite side)
  const result = await ctx.runAction(api.hyperliquid.client.closePosition, {
    privateKey: credentials.hyperliquidPrivateKey,
    address: credentials.hyperliquidAddress,
    symbol: decision.symbol,
    size: actualSize,
    isBuy: positionToClose.side === "SHORT",
    testnet: credentials.hyperliquidTestnet,
  });

  // Save trade record
  await ctx.runMutation(api.mutations.saveTrade, {
    userId: bot.userId,
    symbol: decision.symbol,
    action: "CLOSE",
    side: "CLOSE",
    size: 0,
    leverage: 1,
    price: 0,
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
    const pnl = positionToClose.unrealizedPnl ?? 0;
    const pnlPct = positionToClose.unrealizedPnlPct ?? 0;
    const durationMs = Date.now() - (positionToClose.openedAt ?? Date.now());
    ctx.runAction(internal.telegram.notifier.notifyTradeClosed, {
      userId: bot.userId,
      symbol: decision.symbol,
      side: positionToClose.side,
      entryPrice: positionToClose.entryPrice,
      exitPrice: positionToClose.currentPrice,
      pnl,
      pnlPct,
      durationMs,
    });
  } catch (e) {
    // Telegram failure must never block trading
  }

  // ✅ CIRCUIT BREAKER: Record trade outcome (win/loss)
  const tradeWon = (positionToClose.unrealizedPnl ?? 0) >= 0;
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

  const stopLossPlaced = await placeStopLossWithRetry(
    ctx, api, credentials, decision, sizeInCoins, isLongPosition, entryPrice, bot
  );

  // CRITICAL: If stop loss failed, close position for safety
  if (!stopLossPlaced) {
    await emergencyClose(ctx, api, credentials, decision, bot, sizeInCoins, isLongPosition, entryPrice);
    return;
  }

  // Place take-profit order if specified (with retry logic)
  if (decision.take_profit) {
    await placeTakeProfitWithRetry(
      ctx, api, credentials, decision, sizeInCoins, isLongPosition, entryPrice, bot
    );
  }

  // Save trade record
  await ctx.runMutation(api.mutations.saveTrade, {
    userId: bot.userId,
    symbol: decision.symbol!,
    action: "OPEN",
    side: decision.decision === "OPEN_LONG" ? "LONG" : "SHORT",
    size: decision.size_usd!,
    leverage: decision.leverage!,
    price: result.price,
    aiReasoning: decision.reasoning,
    aiModel: bot.modelName,
    confidence: decision.confidence,
    txHash: result.txHash,
  });

  // Generate invalidation condition
  const invalidationCondition = generateInvalidationCondition(
    decision.symbol!,
    decision.decision === "OPEN_LONG" ? "LONG" : "SHORT",
    result.price,
    decision.stop_loss
  );

  // Save position to database
  await ctx.runMutation(api.mutations.savePosition, {
    userId: bot.userId,
    symbol: decision.symbol!,
    side: decision.decision === "OPEN_LONG" ? "LONG" : "SHORT",
    size: decision.size_usd!,
    leverage: decision.leverage!,
    entryPrice: result.price,
    currentPrice: result.price,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    stopLoss: decision.stop_loss,
    takeProfit: decision.take_profit,
    liquidationPrice: result.price * (decision.decision === "OPEN_LONG" ? 0.9 : 1.1),
    invalidationCondition,
    entryReasoning: decision.reasoning,
    confidence: decision.confidence,
    entryOrderId: result.txHash,
  });

  log.info(`Successfully executed ${decision.decision} for ${decision.symbol} at $${result.price}`, {
    orderDurationMs,
    txHash: result.txHash,
  });

  // Telegram notification (fire-and-forget)
  try {
    ctx.runAction(internal.telegram.notifier.notifyTradeOpened, {
      userId: bot.userId,
      symbol: decision.symbol!,
      side: decision.decision === "OPEN_LONG" ? "LONG" : "SHORT",
      sizeUsd: decision.size_usd!,
      leverage: decision.leverage!,
      entryPrice: result.price,
      stopLoss: decision.stop_loss,
      takeProfit: decision.take_profit,
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
  const MAX_SL_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_SL_RETRIES && !stopLossPlaced; attempt++) {
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

      if (slResult && slResult.success !== false) {
        stopLossPlaced = true;
        console.log(`✅ Stop-loss placed successfully at $${decision.stop_loss}`);
      }
    } catch (error) {
      console.error(`❌ Stop-loss attempt ${attempt} failed:`, error);
      if (attempt < MAX_SL_RETRIES) {
        console.log(`⏳ Waiting 1 second before retry...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
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
  const MAX_TP_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_TP_RETRIES && !takeProfitPlaced; attempt++) {
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

      if (tpResult && tpResult.success !== false) {
        takeProfitPlaced = true;
        console.log(`✅ Take-profit placed successfully at $${decision.take_profit}`);
      }
    } catch (error) {
      console.error(`❌ Take-profit attempt ${attempt} failed:`, error);
      if (attempt < MAX_TP_RETRIES) {
        console.log(`⏳ Waiting 1 second before retry...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
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
