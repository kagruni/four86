import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";

// ═══════════════════════════════════════════════════════════════
// FEATURE FLAG: Compact Signal Processing
// ═══════════════════════════════════════════════════════════════
// Set to true to use new pre-processed signals (150-line prompt)
// Set to false to use old detailed system (680-line prompt)
const USE_COMPACT_SIGNALS = true;

// ═══════════════════════════════════════════════════════════════
// CRITICAL: CONCURRENCY PROTECTION
// ═══════════════════════════════════════════════════════════════
// In-memory tracker for per-symbol cooldowns (still useful for same-instance prevention)
let lastTradeBySymbol: Record<string, { time: number; side: string }> = {};

export const runTradingCycle = internalAction({
  handler: async (ctx) => {
    const loopId = Date.now();
    const lockId = `lock-${loopId}-${Math.random().toString(36).slice(2)}`;
    const loopStartTime = new Date().toISOString();

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[LOOP-${loopId}] Started at ${loopStartTime}`);
    console.log(`[LOOP-${loopId}] Lock ID: ${lockId}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    try {
      // Get all active bots
      const activeBots = await ctx.runQuery(api.queries.getActiveBots);

      console.log(`[LOOP-${loopId}] Running trading cycle for ${activeBots.length} active bot(s)`);

      for (const bot of activeBots) {
        // ✅ CRITICAL: Acquire per-user database lock to prevent race conditions
        const lockResult = await ctx.runMutation(api.mutations.acquireTradingLock, {
          userId: bot.userId,
          lockId: lockId,
        });

        if (!lockResult.success) {
          console.log(`[LOOP-${loopId}] ⚠️ Skipping user ${bot.userId}: ${lockResult.reason} (lock ${lockResult.lockId})`);
          continue; // Skip this user, another loop is processing them
        }

        console.log(`[LOOP-${loopId}] 🔒 Lock acquired for user ${bot.userId}`);

        try {
          console.log(`[LOOP-${loopId}] Processing bot ${bot._id} for user ${bot.userId}`);

        // 1. Get user credentials (private keys, API keys)
        const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
          userId: bot.userId,
        });

        if (!credentials) {
          console.error(`No credentials found for user ${bot.userId}`);
          await ctx.runMutation(api.mutations.saveSystemLog, {
            userId: bot.userId,
            level: "ERROR",
            message: "Trading cycle skipped: No credentials configured",
            data: { botId: bot._id },
          });
          continue;
        }

        if (!credentials.hyperliquidPrivateKey || !credentials.hyperliquidAddress) {
          console.error(`Missing Hyperliquid credentials for user ${bot.userId}`);
          await ctx.runMutation(api.mutations.saveSystemLog, {
            userId: bot.userId,
            level: "ERROR",
            message: "Trading cycle skipped: Missing Hyperliquid credentials",
            data: { botId: bot._id },
          });
          continue;
        }

        // 2. Fetch detailed multi-timeframe market data for all symbols
        // Filter out XRP on testnet (not available)
        const symbols = credentials.hyperliquidTestnet
          ? bot.symbols.filter((s: string) => s !== "XRP")
          : bot.symbols;

        const detailedMarketData = await ctx.runAction(api.hyperliquid.detailedMarketData.getDetailedMarketData, {
          symbols,
          testnet: credentials.hyperliquidTestnet,
        });

        // 3. Get account state from Hyperliquid
        const accountState = await ctx.runAction(api.hyperliquid.client.getAccountState, {
          address: credentials.hyperliquidAddress,
          testnet: credentials.hyperliquidTestnet,
        });

        // 3.5. Sync positions with Hyperliquid (remove stale positions from database)
        const hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
          address: credentials.hyperliquidAddress,
          testnet: credentials.hyperliquidTestnet,
        });

        // Extract symbols of actual positions on Hyperliquid
        const hyperliquidSymbols = hyperliquidPositions
          .map((p: any) => {
            const coin = p.position?.coin || p.coin;
            const szi = p.position?.szi || p.szi || "0";
            // Only include positions with non-zero size
            return parseFloat(szi) !== 0 ? coin : null;
          })
          .filter((s: string | null): s is string => s !== null);

        // Sync database with reality
        await ctx.runMutation(api.mutations.syncPositions, {
          userId: bot.userId,
          hyperliquidSymbols,
        });

        // 4. Get current positions from database (now synced with Hyperliquid)
        const positions = await ctx.runQuery(api.queries.getPositions, {
          userId: bot.userId,
        });

        // 5. Get performance metrics
        const performanceMetrics = await ctx.runQuery(internal.trading.performanceMetrics.getPerformanceMetrics, {
          userId: bot.userId,
        });

        // 6. Make trading decision
        let decision;
        let systemPromptName: string;

        if (USE_COMPACT_SIGNALS) {
          // ═══════════════════════════════════════════════════════════════
          // NEW: Compact Signal Processing System (150-line prompt)
          // ═══════════════════════════════════════════════════════════════
          console.log(`[LOOP-${loopId}] Using COMPACT signal processing...`);

          // Process raw market data into actionable signals
          const processedSignals = await ctx.runAction(api.signals.signalProcessor.processMarketSignals, {
            detailedMarketData,
            positions,
          });

          console.log(`[LOOP-${loopId}] Signals processed in ${processedSignals.processingTimeMs}ms`);
          console.log(`[LOOP-${loopId}] Market overview: ${processedSignals.overview.sentiment}, best: ${processedSignals.overview.bestOpportunity || 'none'}`);

          // Use compact trading decision with pre-processed signals
          decision = await ctx.runAction(api.ai.agents.tradingAgent.makeCompactTradingDecision, {
            userId: bot.userId,
            modelType: "openrouter",
            modelName: bot.modelName,
            processedSignals,
            accountState,
            positions,
            config: {
              maxLeverage: bot.maxLeverage,
              maxPositionSize: bot.maxPositionSize,
              perTradeRiskPct: bot.perTradeRiskPct ?? 2.0,
              maxTotalPositions: bot.maxTotalPositions ?? 3,
              maxSameDirectionPositions: bot.maxSameDirectionPositions ?? 2,
              minEntryConfidence: bot.minEntryConfidence ?? 0.60,
            },
          });

          systemPromptName = "Compact signal-based trading system";

        } else {
          // ═══════════════════════════════════════════════════════════════
          // OLD: Detailed System (680-line prompt) - for rollback
          // ═══════════════════════════════════════════════════════════════
          console.log(`[LOOP-${loopId}] Using DETAILED trading system...`);

          decision = await ctx.runAction(api.ai.agents.tradingAgent.makeDetailedTradingDecision, {
            userId: bot.userId,
            modelType: "openrouter",
            modelName: bot.modelName,
            detailedMarketData,
            accountState,
            positions,
            performanceMetrics,
            config: {
              maxLeverage: bot.maxLeverage,
              maxPositionSize: bot.maxPositionSize,
              maxDailyLoss: bot.maxDailyLoss ?? 5,
              minAccountValue: bot.minAccountValue ?? 100,
              perTradeRiskPct: bot.perTradeRiskPct ?? 2.0,
              maxTotalPositions: bot.maxTotalPositions ?? 3,
              maxSameDirectionPositions: bot.maxSameDirectionPositions ?? 2,
              consecutiveLossLimit: bot.consecutiveLossLimit ?? 3,
              tradingMode: bot.tradingMode ?? "balanced",
              minEntryConfidence: bot.minEntryConfidence ?? 0.60,
              minRiskRewardRatio: bot.minRiskRewardRatio ?? 2.0,
              stopOutCooldownHours: bot.stopOutCooldownHours ?? 6,
              minEntrySignals: bot.minEntrySignals ?? 2,
              require4hAlignment: bot.require4hAlignment ?? false,
              tradeVolatileMarkets: bot.tradeVolatileMarkets ?? true,
              volatilitySizeReduction: bot.volatilitySizeReduction ?? 50,
              stopLossAtrMultiplier: bot.stopLossAtrMultiplier ?? 1.5,
            },
          });

          systemPromptName = "Detailed multi-timeframe trading system";
        }

        // 7. Save AI log
        await ctx.runMutation(api.mutations.saveAILog, {
          userId: bot.userId,
          modelName: bot.modelName,
          systemPrompt: systemPromptName,
          userPrompt: USE_COMPACT_SIGNALS ? "Pre-processed signals" : JSON.stringify({ detailedMarketData, accountState, positions, performanceMetrics }),
          rawResponse: JSON.stringify(decision),
          parsedResponse: decision,
          decision: decision.decision,
          reasoning: decision.reasoning,
          confidence: decision.confidence,
          accountValue: accountState.accountValue,
          marketData: detailedMarketData,
          processingTimeMs: 0,
        });

        // 8. Execute trade if needed
        if (decision.decision !== "HOLD") {
          await executeTradeDecision(ctx, bot, credentials, decision, accountState);
        }

        console.log(`Bot ${bot._id} decision: ${decision.decision}`);

        } catch (error) {
          console.error(`[LOOP-${loopId}] Error in trading cycle for bot ${bot._id}:`, error);
          await ctx.runMutation(api.mutations.saveSystemLog, {
            userId: bot.userId,
            level: "ERROR",
            message: "Trading cycle error",
            data: { error: String(error) },
          });
        } finally {
          // ✅ CRITICAL: Always release the lock for this user
          await ctx.runMutation(api.mutations.releaseTradingLock, {
            userId: bot.userId,
            lockId: lockId,
          });
          console.log(`[LOOP-${loopId}] 🔓 Lock released for user ${bot.userId}`);
        }
      }

      const loopEndTime = new Date().toISOString();
      const durationMs = Date.now() - loopId;
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`[LOOP-${loopId}] Finished at ${loopEndTime}`);
      console.log(`[LOOP-${loopId}] Duration: ${durationMs}ms`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    } catch (error) {
      console.error(`[LOOP-${loopId}] Fatal error in trading cycle:`, error);
    }
  },
});

async function executeTradeDecision(ctx: any, bot: any, credentials: any, decision: any, accountState: any) {
  // ═══════════════════════════════════════════════════════════════
  // CRITICAL: POSITION VALIDATION CHECKS
  // ═══════════════════════════════════════════════════════════════

  console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
  console.log(`│ 🎯 TRADE EXECUTION: ${decision.decision} ${decision.symbol || 'N/A'}`);
  console.log(`│ Size: $${decision.size_usd?.toFixed(2) || 'N/A'} | Leverage: ${decision.leverage || 'N/A'}x`);
  console.log(`│ Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
  console.log(`└─────────────────────────────────────────────────────────────┘`);

  // For OPEN decisions, enforce position limits BEFORE executing
  if (decision.decision === "OPEN_LONG" || decision.decision === "OPEN_SHORT") {
    const requestedSide = decision.decision === "OPEN_LONG" ? "LONG" : "SHORT";
    const symbolKey = `${decision.symbol}-${requestedSide}`;

    // ✅ CHECK #0: In-memory duplicate prevention (ULTRA FAST)
    const lastTrade = lastTradeBySymbol[symbolKey];
    if (lastTrade) {
      const timeSinceLastTrade = Date.now() - lastTrade.time;
      if (timeSinceLastTrade < 60000) { // 60 seconds
        const secondsAgo = Math.floor(timeSinceLastTrade / 1000);
        console.log(`❌ Trade rejected: Just opened ${symbolKey} ${secondsAgo} seconds ago (in-memory check)`);
        await ctx.runMutation(api.mutations.saveSystemLog, {
          userId: bot.userId,
          level: "WARNING",
          message: `In-memory duplicate prevented: ${symbolKey} opened ${secondsAgo}s ago`,
          data: { decision },
        });
        return;
      }
    }

    // Get FRESH positions from database (already synced with Hyperliquid earlier in loop)
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
          reasoning: decision.reasoning
        },
      });
      return;
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
      return;
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
      return;
    }

    // ✅ CHECK #4: Minimum position size (dynamic based on account size)
    // For small accounts: 10% of account value
    // For large accounts: $200 minimum
    const MINIMUM_POSITION_SIZE = Math.min(200, accountState.accountValue * 0.10);
    if (decision.size_usd && decision.size_usd < MINIMUM_POSITION_SIZE) {
      console.log(`❌ Trade rejected: Position size $${decision.size_usd.toFixed(2)} below minimum $${MINIMUM_POSITION_SIZE.toFixed(2)}`);
      await ctx.runMutation(api.mutations.saveSystemLog, {
        userId: bot.userId,
        level: "WARNING",
        message: `Position too small: $${decision.size_usd.toFixed(2)} < $${MINIMUM_POSITION_SIZE.toFixed(2)} minimum`,
        data: { decision },
      });
      return;
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
      return;
    }

    console.log(`✅ Validation passed for ${decision.symbol} ${decision.decision}`);
    console.log(`  - No existing position on ${decision.symbol}`);
    console.log(`  - Total positions: ${currentPositions.length}/${maxTotalPositions}`);
    console.log(`  - ${requestedSide} positions: ${sameDirectionCount}/${maxSameDirectionPositions}`);
    console.log(`  - Position size: $${decision.size_usd} (min $${MINIMUM_POSITION_SIZE})`);
    console.log(`  - No recent trades on ${decision.symbol}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // LEGACY RISK CHECKS (kept for backward compatibility)
  // ═══════════════════════════════════════════════════════════════

  const maxPositionSizeUsd = accountState.accountValue * bot.maxPositionSize;

  if (decision.size_usd && decision.size_usd > maxPositionSizeUsd) {
    console.log(`❌ Trade rejected: position size ${decision.size_usd} exceeds max ${maxPositionSizeUsd}`);
    return;
  }

  if (decision.leverage && decision.leverage > bot.maxLeverage) {
    console.log(`❌ Trade rejected: leverage ${decision.leverage} exceeds max ${bot.maxLeverage}`);
    return;
  }

  try {
    if (decision.decision === "CLOSE") {
      // Get the position to close from database
      const positions = await ctx.runQuery(api.queries.getPositions, {
        userId: bot.userId,
      });

      const positionToClose = positions.find((p: any) => p.symbol === decision.symbol);

      if (!positionToClose) {
        console.log(`No position found for ${decision.symbol}, skipping close`);
        return;
      }

      // Get actual position size from Hyperliquid (not from database)
      const hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
        address: credentials.hyperliquidAddress,
        testnet: credentials.hyperliquidTestnet,
      });

      // Find the actual position on Hyperliquid
      const actualPosition = hyperliquidPositions.find((p: any) => {
        // Position info comes in format like { position: { coin: "BTC", szi: "0.01" } }
        const coin = p.position?.coin || p.coin;
        return coin === decision.symbol;
      });

      if (!actualPosition) {
        console.log(`No actual position found on Hyperliquid for ${decision.symbol}, removing from database`);
        await ctx.runMutation(api.mutations.closePosition, {
          userId: bot.userId,
          symbol: decision.symbol,
        });
        return;
      }

      // Get the actual size from Hyperliquid
      // szi is the signed size (positive for long, negative for short)
      const szi = actualPosition.position?.szi || actualPosition.szi || "0";
      const actualSize = Math.abs(parseFloat(szi));

      console.log(`Closing ${decision.symbol} position:`);
      console.log(`  Database size: ${positionToClose.size} USD`);
      console.log(`  Actual Hyperliquid size: ${actualSize} coins`);
      console.log(`  Side: ${positionToClose.side}`);

      // Close existing position with actual size from Hyperliquid
      // To close a LONG position, we SELL (isBuy=false)
      // To close a SHORT position, we BUY (isBuy=true)
      const result = await ctx.runAction(api.hyperliquid.client.closePosition, {
        privateKey: credentials.hyperliquidPrivateKey,
        address: credentials.hyperliquidAddress,
        symbol: decision.symbol,
        size: actualSize, // Use actual size from Hyperliquid, not database
        isBuy: positionToClose.side === "SHORT", // Opposite of position side
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

    } else if (decision.decision === "OPEN_LONG" || decision.decision === "OPEN_SHORT") {
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
      // Example: $7327 / $934 BNB = 7.84 BNB
      const sizeInCoins = decision.size_usd! / entryPrice;

      console.log(`Opening position: ${decision.symbol} ${decision.decision}`);
      console.log(`  Size: $${decision.size_usd} / $${entryPrice} = ${sizeInCoins.toFixed(4)} coins`);
      console.log(`  Leverage: ${decision.leverage}x`);

      // Open new position
      const result = await ctx.runAction(api.hyperliquid.client.placeOrder, {
        privateKey: credentials.hyperliquidPrivateKey,
        address: credentials.hyperliquidAddress,
        symbol: decision.symbol!,
        isBuy: decision.decision === "OPEN_LONG",
        size: sizeInCoins,
        leverage: decision.leverage!,
        price: entryPrice,
        testnet: credentials.hyperliquidTestnet,
      });

      const isLongPosition = decision.decision === "OPEN_LONG";

      // Place stop-loss order if specified
      if (decision.stop_loss) {
        try {
          console.log(`Placing stop-loss order at $${decision.stop_loss}...`);
          await ctx.runAction(api.hyperliquid.client.placeStopLoss, {
            privateKey: credentials.hyperliquidPrivateKey,
            symbol: decision.symbol!,
            size: sizeInCoins,
            triggerPrice: decision.stop_loss,
            isLongPosition,
            testnet: credentials.hyperliquidTestnet,
          });
        } catch (error) {
          console.error(`Failed to place stop-loss order:`, error);
          // Don't fail the entire trade if SL order fails - position is still open
        }
      }

      // Place take-profit order if specified
      if (decision.take_profit) {
        try {
          console.log(`Placing take-profit order at $${decision.take_profit}...`);
          await ctx.runAction(api.hyperliquid.client.placeTakeProfit, {
            privateKey: credentials.hyperliquidPrivateKey,
            symbol: decision.symbol!,
            size: sizeInCoins,
            triggerPrice: decision.take_profit,
            isLongPosition,
            testnet: credentials.hyperliquidTestnet,
          });
        } catch (error) {
          console.error(`Failed to place take-profit order:`, error);
          // Don't fail the entire trade if TP order fails - position is still open
        }
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

      // Generate invalidation condition based on stop loss and side
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
        liquidationPrice: result.price * (decision.decision === "OPEN_LONG" ? 0.9 : 1.1), // Mock liquidation price

        // New fields
        invalidationCondition,
        entryReasoning: decision.reasoning,
        confidence: decision.confidence,
        entryOrderId: result.txHash, // Using txHash as order ID for now
      });

      console.log(`✅ Successfully executed ${decision.decision} for ${decision.symbol} at $${result.price}`);

      // ✅ UPDATE: In-memory tracker to prevent immediate duplicates
      const side = decision.decision === "OPEN_LONG" ? "LONG" : "SHORT";
      const symbolKey = `${decision.symbol}-${side}`;
      lastTradeBySymbol[symbolKey] = {
        time: Date.now(),
        side: side
      };
      console.log(`📝 Tracking: ${symbolKey} opened at ${new Date().toISOString()}`);
    }
  } catch (error) {
    console.error("❌ Error executing trade:", error);
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "ERROR",
      message: "Trade execution error",
      data: { error: String(error), decision },
    });
  }
}

/**
 * Generate invalidation condition description for a position
 * @param symbol - Trading symbol (e.g., "BTC")
 * @param side - Position side ("LONG" or "SHORT")
 * @param entryPrice - Entry price
 * @param stopLoss - Stop loss price (optional)
 * @returns Human-readable invalidation condition
 */
function generateInvalidationCondition(
  symbol: string,
  side: string,
  entryPrice: number,
  stopLoss?: number
): string {
  if (!stopLoss) {
    // No stop loss specified - use default percentage
    const defaultStopPct = 0.05; // 5%
    const invalidationPrice = side === "LONG"
      ? entryPrice * (1 - defaultStopPct)
      : entryPrice * (1 + defaultStopPct);

    return `If ${symbol} price closes ${side === "LONG" ? "below" : "above"} $${invalidationPrice.toFixed(2)} (${(defaultStopPct * 100).toFixed(1)}% against entry) on 3-minute candle`;
  }

  // Calculate percentage from stop loss
  const stopPct = Math.abs((stopLoss - entryPrice) / entryPrice) * 100;

  return `If ${symbol} price closes ${side === "LONG" ? "below" : "above"} $${stopLoss.toFixed(2)} (${stopPct.toFixed(1)}% stop loss) on 3-minute candle`;
}
