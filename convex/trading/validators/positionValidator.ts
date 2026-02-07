/**
 * Position Validator
 *
 * All pre-trade validation checks that must pass before a new position
 * can be opened. Extracted from tradingLoop.ts for maintainability.
 */

import { createLogger } from "../logger";

export interface ValidationResult {
  allowed: boolean;
  reason: string;
  checkName: string;
}

/**
 * In-memory tracker for per-symbol cooldowns.
 * Module-level state shared across invocations within the same process.
 */
export let lastTradeBySymbol: Record<string, { time: number; side: string }> = {};

/**
 * Update the in-memory trade tracker after a successful trade.
 */
export function recordTradeInMemory(symbol: string, side: string): void {
  const symbolKey = `${symbol}-${side}`;
  lastTradeBySymbol[symbolKey] = {
    time: Date.now(),
    side,
  };
  console.log(`📝 Tracking: ${symbolKey} opened at ${new Date().toISOString()}`);
}

/**
 * Validate that a new position can be opened.
 * Runs all 7+ pre-trade validation checks in sequence.
 * Returns on first failure.
 *
 * @param ctx - Convex action context
 * @param api - Convex API reference
 * @param bot - Bot configuration
 * @param credentials - User credentials
 * @param decision - The AI trading decision
 * @param accountState - Current account state
 * @returns Validation result
 */
export async function validateOpenPosition(
  ctx: any,
  api: any,
  bot: any,
  credentials: any,
  decision: any,
  accountState: any
): Promise<ValidationResult> {
  const log = createLogger("VALIDATOR", undefined, bot.userId);

  // Only validate OPEN decisions
  if (decision.decision !== "OPEN_LONG" && decision.decision !== "OPEN_SHORT") {
    return { allowed: true, reason: "Not an open trade", checkName: "SKIP" };
  }

  const requestedSide = decision.decision === "OPEN_LONG" ? "LONG" : "SHORT";
  const symbolKey = `${decision.symbol}-${requestedSide}`;

  // ✅ CHECK #-2: DATABASE SYMBOL LOCK (prevents rapid duplicate orders)
  const symbolLockResult = await ctx.runMutation(api.mutations.acquireSymbolTradeLock, {
    userId: bot.userId,
    symbol: decision.symbol!,
    side: requestedSide,
  });

  if (!symbolLockResult.success) {
    log.warn(`Symbol lock blocked: ${decision.symbol} already has pending trade`, { secondsRemaining: symbolLockResult.secondsRemaining });
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "WARNING",
      message: `Symbol lock blocked duplicate: ${decision.symbol}`,
      data: {
        decision: decision.decision,
        symbol: decision.symbol,
        secondsRemaining: symbolLockResult.secondsRemaining,
      },
    });
    return { allowed: false, reason: `Symbol locked (${symbolLockResult.secondsRemaining}s remaining)`, checkName: "SYMBOL_LOCK" };
  }
  log.info(`Lock acquired for ${decision.symbol}`);

  // ✅ CHECK #-1: HYPERLIQUID POSITION CHECK (AUTHORITATIVE)
  try {
    const hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
      address: credentials.hyperliquidAddress,
      testnet: credentials.hyperliquidTestnet,
    });

    const existingHLPosition = hyperliquidPositions.find((p: any) => {
      const coin = p.position?.coin || p.coin;
      const szi = p.position?.szi || p.szi || "0";
      return coin === decision.symbol && parseFloat(szi) !== 0;
    });

    if (existingHLPosition) {
      const posSize = existingHLPosition.position?.szi || existingHLPosition.szi || "0";
      log.warn(`Position already exists on exchange: ${decision.symbol}`, { size: posSize });
      await ctx.runMutation(api.mutations.saveSystemLog, {
        userId: bot.userId,
        level: "WARNING",
        message: `Hyperliquid position check blocked duplicate: ${decision.symbol}`,
        data: {
          decision: decision.decision,
          symbol: decision.symbol,
          existingSize: posSize,
        },
      });
      return { allowed: false, reason: `Position already exists on exchange (size: ${posSize})`, checkName: "HYPERLIQUID_POSITION" };
    }
    log.info(`No existing position on ${decision.symbol}`);
  } catch (hlError) {
    log.error(`Failed to query exchange positions`, { error: hlError instanceof Error ? hlError.message : String(hlError) });
    // Continue with other checks
  }

  // ✅ CHECK #-0.5: HYPERLIQUID OPEN ORDERS CHECK
  try {
    const openOrders = await ctx.runAction(api.hyperliquid.client.getUserOpenOrders, {
      address: credentials.hyperliquidAddress,
      testnet: credentials.hyperliquidTestnet,
    });

    const pendingOrderOnSymbol = openOrders.find((order: any) => order.coin === decision.symbol);

    if (pendingOrderOnSymbol) {
      log.warn(`Pending order already exists on exchange: ${decision.symbol}`, {
        side: pendingOrderOnSymbol.side,
        size: pendingOrderOnSymbol.sz,
        price: pendingOrderOnSymbol.limitPx,
      });
      await ctx.runMutation(api.mutations.saveSystemLog, {
        userId: bot.userId,
        level: "WARNING",
        message: `Open order check blocked duplicate: ${decision.symbol}`,
        data: {
          decision: decision.decision,
          symbol: decision.symbol,
          pendingOrder: {
            side: pendingOrderOnSymbol.side,
            size: pendingOrderOnSymbol.sz,
            price: pendingOrderOnSymbol.limitPx,
          },
        },
      });
      return { allowed: false, reason: `Pending order exists on exchange`, checkName: "OPEN_ORDERS" };
    }
    log.info(`No pending orders on ${decision.symbol}`);
  } catch (ordersError) {
    log.error(`Failed to query open orders`, { error: ordersError instanceof Error ? ordersError.message : String(ordersError) });
    // Continue with other checks
  }

  // ✅ CHECK #0: In-memory duplicate prevention (ULTRA FAST)
  const lastTrade = lastTradeBySymbol[symbolKey];
  if (lastTrade) {
    const timeSinceLastTrade = Date.now() - lastTrade.time;
    if (timeSinceLastTrade < 60000) {
      const secondsAgo = Math.floor(timeSinceLastTrade / 1000);
      console.log(`❌ Trade rejected: Just opened ${symbolKey} ${secondsAgo} seconds ago (in-memory check)`);
      await ctx.runMutation(api.mutations.saveSystemLog, {
        userId: bot.userId,
        level: "WARNING",
        message: `In-memory duplicate prevented: ${symbolKey} opened ${secondsAgo}s ago`,
        data: { decision },
      });
      return { allowed: false, reason: `In-memory duplicate (${secondsAgo}s ago)`, checkName: "IN_MEMORY" };
    }
  }

  // Get FRESH positions from database
  const currentPositions = await ctx.runQuery(api.queries.getPositions, {
    userId: bot.userId,
  });

  // ✅ CHECK #1: Duplicate position on same symbol
  const existingPosition = currentPositions.find((p: any) => p.symbol === decision.symbol);
  if (existingPosition) {
    console.log(`❌ Trade rejected: Already have ${existingPosition.side} position on ${decision.symbol}`);
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "WARNING",
      message: `Duplicate position prevented: ${decision.symbol} ${decision.decision}`,
      data: {
        existingPosition: existingPosition.side,
        attemptedDecision: decision.decision,
        reasoning: decision.reasoning,
      },
    });
    return { allowed: false, reason: `Already have ${existingPosition.side} position on ${decision.symbol}`, checkName: "DUPLICATE_POSITION" };
  }

  // ✅ CHECK #2: Max total positions
  const maxTotalPositions = bot.maxTotalPositions ?? 3;
  if (currentPositions.length >= maxTotalPositions) {
    console.log(`❌ Trade rejected: Already have ${currentPositions.length}/${maxTotalPositions} positions open`);
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "WARNING",
      message: `Position limit reached: ${currentPositions.length}/${maxTotalPositions}`,
      data: { decision },
    });
    return { allowed: false, reason: `Position limit reached: ${currentPositions.length}/${maxTotalPositions}`, checkName: "MAX_POSITIONS" };
  }

  // ✅ CHECK #3: Max same-direction positions
  const maxSameDirectionPositions = bot.maxSameDirectionPositions ?? 2;
  const sameDirectionCount = currentPositions.filter((p: any) => p.side === requestedSide).length;

  if (sameDirectionCount >= maxSameDirectionPositions) {
    console.log(`❌ Trade rejected: Already have ${sameDirectionCount}/${maxSameDirectionPositions} ${requestedSide} positions`);
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "WARNING",
      message: `Same-direction limit reached: ${sameDirectionCount}/${maxSameDirectionPositions} ${requestedSide}`,
      data: { decision },
    });
    return { allowed: false, reason: `Same-direction limit: ${sameDirectionCount}/${maxSameDirectionPositions} ${requestedSide}`, checkName: "SAME_DIRECTION" };
  }

  // ✅ CHECK #4: Minimum position size
  const MINIMUM_POSITION_SIZE = Math.min(200, accountState.accountValue * 0.10);
  if (decision.size_usd && decision.size_usd < MINIMUM_POSITION_SIZE) {
    console.log(`❌ Trade rejected: Position size $${decision.size_usd.toFixed(2)} below minimum $${MINIMUM_POSITION_SIZE.toFixed(2)}`);
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "WARNING",
      message: `Position too small: $${decision.size_usd.toFixed(2)} < $${MINIMUM_POSITION_SIZE.toFixed(2)} minimum`,
      data: { decision },
    });
    return { allowed: false, reason: `Position too small: $${decision.size_usd.toFixed(2)}`, checkName: "MIN_SIZE" };
  }

  // ✅ CHECK #5: Recent trade cooldown (5 minutes per symbol)
  const recentTrades = await ctx.runQuery(api.queries.getRecentTrades, {
    userId: bot.userId,
  });

  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  const recentTradeOnSymbol = recentTrades.find((trade: any) =>
    trade.symbol === decision.symbol &&
    trade.action === "OPEN" &&
    trade.executedAt > fiveMinutesAgo
  );

  if (recentTradeOnSymbol) {
    const minutesAgo = Math.floor((Date.now() - recentTradeOnSymbol.executedAt) / 60000);
    console.log(`❌ Trade rejected: Opened ${decision.symbol} ${minutesAgo} minute(s) ago (5min cooldown)`);
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "WARNING",
      message: `Symbol cooldown active: ${decision.symbol} traded ${minutesAgo}min ago`,
      data: { decision },
    });
    return { allowed: false, reason: `Symbol cooldown: traded ${minutesAgo}min ago`, checkName: "COOLDOWN" };
  }

  // ✅ CHECK #6: Ultra-short 60-second duplicate guard
  const oneMinuteAgo = Date.now() - (60 * 1000);
  const veryRecentTrade = recentTrades.find((trade: any) =>
    trade.symbol === decision.symbol &&
    trade.action === "OPEN" &&
    trade.executedAt > oneMinuteAgo
  );

  if (veryRecentTrade) {
    const secondsAgo = Math.floor((Date.now() - veryRecentTrade.executedAt) / 1000);
    console.log(`❌ [DUPLICATE GUARD] Trade blocked: ${decision.symbol} was opened ${secondsAgo}s ago`);
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "WARNING",
      message: `Duplicate guard blocked: ${decision.symbol} opened ${secondsAgo}s ago`,
      data: { decision, veryRecentTradeId: veryRecentTrade._id },
    });
    return { allowed: false, reason: `Duplicate guard: opened ${secondsAgo}s ago`, checkName: "DUPLICATE_GUARD" };
  }

  // All checks passed
  log.info(`Validation passed for ${decision.symbol} ${decision.decision}`, {
    totalPositions: `${currentPositions.length}/${maxTotalPositions}`,
    sameDirection: `${sameDirectionCount}/${maxSameDirectionPositions} ${requestedSide}`,
    sizeUsd: decision.size_usd,
    minSize: MINIMUM_POSITION_SIZE,
  });

  return { allowed: true, reason: "All validation checks passed", checkName: "ALL_PASSED" };
}
