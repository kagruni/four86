import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";

// ═══════════════════════════════════════════════════════════════
// FEATURE FLAG: Trading Prompt Mode
// ═══════════════════════════════════════════════════════════════
// "alpha_arena" - Alpha Arena style (raw data, leverage, TP/SL discipline)
// "compact"     - Compact signal-based (pre-processed signals, 150-line prompt)
// "detailed"    - Old detailed system (680-line prompt)
const TRADING_MODE: "alpha_arena" | "compact" | "detailed" = "alpha_arena";

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

        // 4. Get current positions - USE HYPERLIQUID AS SOURCE OF TRUTH
        // Database positions might be stale, so we convert Hyperliquid positions to our format
        const dbPositions = await ctx.runQuery(api.queries.getPositions, {
          userId: bot.userId,
        });

        // Convert Hyperliquid positions to the format expected by the AI
        // This ensures the AI ALWAYS knows about actual positions on the exchange
        const positions = hyperliquidPositions
          .map((hlPos: any) => {
            const pos = hlPos.position || hlPos;
            const coin = pos.coin;
            const szi = parseFloat(pos.szi || "0");

            // Skip positions with zero size
            if (szi === 0) return null;

            const entryPx = parseFloat(pos.entryPx || "0");
            const leverage = parseFloat(pos.leverage?.value || pos.leverage || "1");
            const unrealizedPnl = parseFloat(pos.unrealizedPnl || "0");
            const positionValue = parseFloat(pos.positionValue || "0");
            const liquidationPx = parseFloat(pos.liquidationPx || "0");

            // Get current price from market data
            const currentPrice = detailedMarketData[coin]?.currentPrice || entryPx;

            // Calculate P&L percentage
            const unrealizedPnlPct = positionValue > 0 ? (unrealizedPnl / positionValue) * 100 : 0;

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
            };
          })
          .filter((p: any): p is NonNullable<typeof p> => p !== null);

        console.log(`[LOOP-${loopId}] Hyperliquid has ${positions.length} active positions: ${positions.map((p: any) => `${p.symbol} ${p.side}`).join(", ") || "none"}`);
        console.log(`[LOOP-${loopId}] Database has ${dbPositions.length} positions`);

        // 5. Get performance metrics
        const performanceMetrics = await ctx.runQuery(internal.trading.performanceMetrics.getPerformanceMetrics, {
          userId: bot.userId,
        });

        // 6. Make trading decision
        let decision;
        let systemPromptName: string;

        if (TRADING_MODE === "alpha_arena") {
          // ═══════════════════════════════════════════════════════════════
          // ALPHA ARENA: Replicates winning strategy (leverage + TP/SL)
          // ═══════════════════════════════════════════════════════════════
          console.log(`[LOOP-${loopId}] Using ALPHA ARENA trading system...`);
          console.log(`[LOOP-${loopId}] Strategy: Leverage 5-10x, strict TP/SL, hold until hit`);

          // Use Alpha Arena trading decision with raw market data
          decision = await ctx.runAction(api.ai.agents.tradingAgent.makeAlphaArenaTradingDecision, {
            userId: bot.userId,
            modelType: "openrouter",
            modelName: bot.modelName,
            detailedMarketData,
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

          systemPromptName = "Alpha Arena trading system (leverage + TP/SL discipline)";

        } else if (TRADING_MODE === "compact") {
          // ═══════════════════════════════════════════════════════════════
          // COMPACT: Pre-processed signals (150-line prompt)
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
          // DETAILED: Old system (680-line prompt) - for rollback
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
          userPrompt: TRADING_MODE === "compact" ? "Pre-processed signals" : TRADING_MODE === "alpha_arena" ? "Alpha Arena raw data" : JSON.stringify({ detailedMarketData, accountState, positions, performanceMetrics }),
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

    // ✅ CHECK #-2: DATABASE SYMBOL LOCK (prevents rapid duplicate orders)
    // This is the FIRST check - if we've attempted to trade this symbol in the last 60 seconds, block it
    const symbolLockResult = await ctx.runMutation(api.mutations.acquireSymbolTradeLock, {
      userId: bot.userId,
      symbol: decision.symbol!,
      side: requestedSide,
    });

    if (!symbolLockResult.success) {
      console.log(`❌ [SYMBOL LOCK] Trade blocked: ${decision.symbol} already has pending trade (${symbolLockResult.secondsRemaining}s remaining)`);
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
      return; // ABORT - symbol is locked
    }
    console.log(`✅ [SYMBOL LOCK] Lock acquired for ${decision.symbol}`);

    // ✅ CHECK #-1: HYPERLIQUID POSITION CHECK (AUTHORITATIVE - queries exchange directly)
    // This is the most reliable check - database can be stale, but exchange is truth
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
        console.log(`❌ [HYPERLIQUID CHECK] Position already exists on exchange: ${decision.symbol} (size: ${posSize})`);
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
        return; // ABORT - position already exists on exchange
      }
      console.log(`✅ [HYPERLIQUID CHECK] No existing position on ${decision.symbol}`);
    } catch (hlError) {
      console.error(`⚠️ [HYPERLIQUID CHECK] Failed to query exchange positions:`, hlError);
      // Continue with other checks - don't block entirely on API failure
    }

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

      // ═══════════════════════════════════════════════════════════════
      // RISK/REWARD VALIDATION (Minimum 1.5:1 R:R required)
      // ═══════════════════════════════════════════════════════════════
      const MIN_RISK_REWARD = 1.5;

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

        console.log(`  Risk/Reward: ${rrRatio.toFixed(2)}:1 (min ${MIN_RISK_REWARD}:1)`);
        console.log(`    Risk: $${riskDistance.toFixed(2)} | Reward: $${rewardDistance.toFixed(2)}`);

        if (rrRatio < MIN_RISK_REWARD) {
          console.log(`❌ Trade rejected: R:R ratio ${rrRatio.toFixed(2)} below minimum ${MIN_RISK_REWARD}`);
          await ctx.runMutation(api.mutations.saveSystemLog, {
            userId: bot.userId,
            level: "WARNING",
            message: `Trade rejected: R:R ${rrRatio.toFixed(2)} < ${MIN_RISK_REWARD} minimum`,
            data: {
              decision: decision.decision,
              symbol: decision.symbol,
              entryPrice,
              stopLoss: decision.stop_loss,
              takeProfit: decision.take_profit,
              rrRatio,
            },
          });
          return; // ABORT - bad risk/reward
        }
        console.log(`✅ R:R validation passed: ${rrRatio.toFixed(2)}:1`);
      } else {
        console.log(`⚠️ R:R check skipped: Missing stop_loss or take_profit`);
      }

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

      // ═══════════════════════════════════════════════════════════════
      // MANDATORY STOP LOSS WITH RETRY AND CLOSE-ON-FAILURE
      // ═══════════════════════════════════════════════════════════════

      // Default to 3% stop loss if AI didn't specify one
      if (!decision.stop_loss) {
        decision.stop_loss = isLongPosition
          ? entryPrice * 0.97  // 3% below for longs
          : entryPrice * 1.03; // 3% above for shorts
        console.log(`⚠️ No stop loss specified, using default 3%: $${decision.stop_loss.toFixed(2)}`);
      }

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

      // CRITICAL: If stop loss failed after all retries, close position for safety
      if (!stopLossPlaced) {
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
          // Close the position we just opened
          await ctx.runAction(api.hyperliquid.client.closePosition, {
            privateKey: credentials.hyperliquidPrivateKey,
            address: credentials.hyperliquidAddress,
            symbol: decision.symbol!,
            size: sizeInCoins,
            isBuy: !isLongPosition, // Opposite side to close
            testnet: credentials.hyperliquidTestnet,
          });
          console.log(`✅ Position closed safely after SL failure`);

          // Record the close
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
        return; // Exit - position was closed or we have an unprotected position logged
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
