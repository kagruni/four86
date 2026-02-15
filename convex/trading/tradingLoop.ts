/**
 * Trading Loop — Thin Orchestrator
 *
 * Coordinates the trading cycle:
 * 1. Circuit breaker check
 * 2. Lock acquisition
 * 3. Market data fetch
 * 4. Position sync
 * 5. AI decision (delegates to chain)
 * 6. Trend guard → Position validation → Trade execution
 * 7. Lock release
 *
 * All heavy logic is in extracted modules:
 * - validators/trendGuard.ts — Counter-trend blocking
 * - validators/positionValidator.ts — Pre-trade validation checks
 * - executors/tradeExecutor.ts — Order placement + SL/TP
 * - converters/positionConverter.ts — Hyperliquid → AI format
 * - circuitBreaker.ts — Failure/loss tracking
 */

import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import {
  shouldAllowTrading,
  recordAiFailure,
  recordAiSuccess,
} from "./circuitBreaker";
import { convertHyperliquidPositions, extractHyperliquidSymbols } from "./converters/positionConverter";
import { checkTrendGuard } from "./validators/trendGuard";
import { validateOpenPosition } from "./validators/positionValidator";
import { executeClose, executeOpen } from "./executors/tradeExecutor";

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
      const activeBots = await ctx.runQuery(api.queries.getActiveBots);
      console.log(`[LOOP-${loopId}] Running trading cycle for ${activeBots.length} active bot(s)`);

      for (const bot of activeBots) {
        // ── 1. Circuit Breaker Check ────────────────────────────────
        const cbCheck = shouldAllowTrading(
          {
            circuitBreakerState: bot.circuitBreakerState,
            consecutiveAiFailures: bot.consecutiveAiFailures,
            consecutiveLosses: bot.consecutiveLosses,
            circuitBreakerTrippedAt: bot.circuitBreakerTrippedAt,
          },
          {
            circuitBreakerCooldownMinutes: bot.circuitBreakerCooldownMinutes,
            maxConsecutiveAiFailures: bot.maxConsecutiveAiFailures,
            maxConsecutiveLosses: bot.maxConsecutiveLosses,
          },
          Date.now()
        );

        if (!cbCheck.allowed) {
          console.log(`[LOOP-${loopId}] [CIRCUIT BREAKER] Skipping user ${bot.userId}: ${cbCheck.reason}`);
          await ctx.runMutation(api.mutations.saveSystemLog, {
            userId: bot.userId,
            level: "WARNING",
            message: `Circuit breaker blocked trading: ${cbCheck.reason}`,
            data: {
              circuitBreakerState: bot.circuitBreakerState,
              consecutiveAiFailures: bot.consecutiveAiFailures,
              consecutiveLosses: bot.consecutiveLosses,
            },
          });
          continue;
        }

        // Transition tripped → cooldown if cooldown elapsed
        if (bot.circuitBreakerState === "tripped" && cbCheck.allowed) {
          await ctx.runMutation(api.mutations.updateCircuitBreakerState, {
            userId: bot.userId,
            circuitBreakerState: "cooldown",
          });
          console.log(`[LOOP-${loopId}] [CIRCUIT BREAKER] User ${bot.userId} entering cooldown state`);
        }

        // ── 2. Lock Acquisition ─────────────────────────────────────
        const lockResult = await ctx.runMutation(api.mutations.acquireTradingLock, {
          userId: bot.userId,
          lockId: lockId,
        });

        if (!lockResult.success) {
          console.log(`[LOOP-${loopId}] ⚠️ Skipping user ${bot.userId}: ${lockResult.reason} (lock ${lockResult.lockId})`);
          continue;
        }

        console.log(`[LOOP-${loopId}] 🔒 Lock acquired for user ${bot.userId}`);

        try {
          console.log(`[LOOP-${loopId}] Processing bot ${bot._id} for user ${bot.userId}`);

          // Read trading prompt mode from bot config
          const tradingMode: "alpha_arena" | "compact" | "detailed" =
            (bot.tradingPromptMode as "alpha_arena" | "compact" | "detailed") || "alpha_arena";

          // ── 3. Credentials ────────────────────────────────────────
          const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
            userId: bot.userId,
          });

          if (!credentials || !credentials.hyperliquidPrivateKey || !credentials.hyperliquidAddress) {
            console.error(`Missing credentials for user ${bot.userId}`);
            await ctx.runMutation(api.mutations.saveSystemLog, {
              userId: bot.userId,
              level: "ERROR",
              message: "Trading cycle skipped: Missing credentials",
              data: { botId: bot._id },
            });
            continue;
          }

          // ── 4. Market Data ────────────────────────────────────────
          const symbols = credentials.hyperliquidTestnet
            ? bot.symbols.filter((s: string) => s !== "XRP")
            : bot.symbols;

          const detailedMarketData = await ctx.runAction(api.hyperliquid.detailedMarketData.getDetailedMarketData, {
            symbols,
            testnet: credentials.hyperliquidTestnet,
          });

          const accountState = await ctx.runAction(api.hyperliquid.client.getAccountState, {
            address: credentials.hyperliquidAddress,
            testnet: credentials.hyperliquidTestnet,
          });

          // ── 5. Position Sync ──────────────────────────────────────
          let hyperliquidPositions: any[] = [];
          let hlPositionsFetched = false;

          try {
            hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
              address: credentials.hyperliquidAddress,
              testnet: credentials.hyperliquidTestnet,
            });
            hlPositionsFetched = true;
          } catch (error) {
            console.warn(`[LOOP-${loopId}] Hyperliquid positions API unavailable, skipping sync: ${error instanceof Error ? error.message : String(error)}`);
          }

          const hyperliquidSymbols = extractHyperliquidSymbols(hyperliquidPositions);

          // Only sync positions if we successfully fetched from Hyperliquid
          // Syncing with empty data when API is down would wipe all DB positions
          if (hlPositionsFetched) {
            await ctx.runMutation(api.mutations.syncPositions, {
              userId: bot.userId,
              hyperliquidSymbols,
            });
          }

          let dbPositions = await ctx.runQuery(api.queries.getPositions, {
            userId: bot.userId,
          });

          // ── Backfill: Save HL positions missing from DB ───────────
          // Positions opened before DB tracking (or externally) need to be
          // saved so executeClose can find them.
          if (hlPositionsFetched && dbPositions.length === 0 && hyperliquidPositions.length > 0) {
            console.log(`[LOOP-${loopId}] Backfilling ${hyperliquidPositions.length} Hyperliquid position(s) into DB`);
            for (const hlPos of hyperliquidPositions) {
              const pos = hlPos.position || hlPos;
              const coin = pos.coin;
              const szi = parseFloat(pos.szi || "0");
              if (szi === 0) continue;

              const entryPx = parseFloat(pos.entryPx || "0");
              const leverage = parseFloat(pos.leverage?.value || pos.leverage || "1");
              const unrealizedPnl = parseFloat(pos.unrealizedPnl || "0");
              const positionValue = parseFloat(pos.positionValue || "0");
              const liquidationPx = parseFloat(pos.liquidationPx || "0");
              const currentPrice = detailedMarketData[coin]?.currentPrice || entryPx;

              try {
                await ctx.runMutation(api.mutations.savePosition, {
                  userId: bot.userId,
                  symbol: coin,
                  side: szi > 0 ? "LONG" : "SHORT",
                  size: positionValue,
                  leverage,
                  entryPrice: entryPx,
                  currentPrice,
                  unrealizedPnl,
                  unrealizedPnlPct: positionValue > 0 ? (unrealizedPnl / positionValue) * 100 : 0,
                  liquidationPrice: liquidationPx,
                });
                console.log(`[LOOP-${loopId}] Backfilled ${coin} ${szi > 0 ? "LONG" : "SHORT"} into DB`);
              } catch (e) {
                console.warn(`[LOOP-${loopId}] Failed to backfill ${coin}:`, e instanceof Error ? e.message : String(e));
              }
            }

            // Re-fetch DB positions after backfill
            dbPositions = await ctx.runQuery(api.queries.getPositions, {
              userId: bot.userId,
            });
          }

          const positions = convertHyperliquidPositions(hyperliquidPositions, dbPositions, detailedMarketData);

          console.log(`[LOOP-${loopId}] Hyperliquid has ${positions.length} active positions: ${positions.map((p: any) => `${p.symbol} ${p.side}`).join(", ") || "none"}`);
          console.log(`[LOOP-${loopId}] Database has ${dbPositions.length} positions`);

          // ── 6. Performance Metrics + Sentiment ─────────────────────
          const performanceMetrics = await ctx.runQuery(internal.trading.performanceMetrics.getPerformanceMetrics, {
            userId: bot.userId,
          });

          // Fetch latest market research/sentiment (non-blocking, may be null)
          let marketResearch = null;
          try {
            marketResearch = await ctx.runQuery(internal.queries.getLatestMarketResearchInternal, {
              userId: bot.userId,
            });
            if (marketResearch) {
              console.log(`[LOOP-${loopId}] Sentiment: ${marketResearch.overallSentiment} (bias: ${marketResearch.recommendedBias})`);
            }
          } catch (e) {
            console.log(`[LOOP-${loopId}] Market research fetch skipped:`, e instanceof Error ? e.message : String(e));
          }

          // ── 7. AI Decision (with circuit breaker tracking) ────────
          let decision;
          let systemPromptName: string;

          try {
            if (tradingMode === "alpha_arena") {
              console.log(`[LOOP-${loopId}] Using ALPHA ARENA trading system...`);
              decision = await ctx.runAction(api.ai.agents.tradingAgent.makeAlphaArenaTradingDecision, {
                userId: bot.userId,
                modelType: "openrouter",
                modelName: bot.modelName,
                detailedMarketData,
                accountState,
                positions,
                marketResearch: marketResearch || undefined,
                config: {
                  maxLeverage: bot.maxLeverage,
                  maxPositionSize: bot.maxPositionSize,
                  perTradeRiskPct: bot.perTradeRiskPct ?? 2.0,
                  maxTotalPositions: bot.maxTotalPositions ?? 3,
                  maxSameDirectionPositions: bot.maxSameDirectionPositions ?? 2,
                  minEntryConfidence: bot.minEntryConfidence ?? 0.60,
                  stopLossAtrMultiplier: bot.stopLossAtrMultiplier ?? 1.5,
                  minRiskRewardRatio: bot.minRiskRewardRatio ?? 2.0,
                  require4hAlignment: bot.require4hAlignment ?? false,
                  tradeVolatileMarkets: bot.tradeVolatileMarkets ?? true,
                  volatilitySizeReduction: bot.volatilitySizeReduction ?? 50,
                  tradingMode: bot.tradingMode ?? "balanced",
                },
              });
              systemPromptName = "Alpha Arena trading system (leverage + TP/SL discipline)";

            } else if (tradingMode === "compact") {
              console.log(`[LOOP-${loopId}] Using COMPACT signal processing...`);
              const processedSignals = await ctx.runAction(api.signals.signalProcessor.processMarketSignals, {
                detailedMarketData,
                positions,
              });
              console.log(`[LOOP-${loopId}] Signals processed in ${processedSignals.processingTimeMs}ms`);

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

            // Record AI success
            const aiSuccessState = recordAiSuccess({
              circuitBreakerState: bot.circuitBreakerState,
              consecutiveAiFailures: bot.consecutiveAiFailures,
              consecutiveLosses: bot.consecutiveLosses,
              circuitBreakerTrippedAt: bot.circuitBreakerTrippedAt,
            });
            await ctx.runMutation(api.mutations.updateCircuitBreakerState, {
              userId: bot.userId,
              circuitBreakerState: aiSuccessState.circuitBreakerState,
              consecutiveAiFailures: aiSuccessState.consecutiveAiFailures,
            });

          } catch (aiError) {
            // Record AI failure
            console.error(`[LOOP-${loopId}] AI decision failed:`, aiError);
            const aiFailState = recordAiFailure(
              {
                circuitBreakerState: bot.circuitBreakerState,
                consecutiveAiFailures: bot.consecutiveAiFailures,
                consecutiveLosses: bot.consecutiveLosses,
                circuitBreakerTrippedAt: bot.circuitBreakerTrippedAt,
              },
              { maxConsecutiveAiFailures: bot.maxConsecutiveAiFailures }
            );
            await ctx.runMutation(api.mutations.updateCircuitBreakerState, {
              userId: bot.userId,
              circuitBreakerState: aiFailState.circuitBreakerState,
              consecutiveAiFailures: aiFailState.consecutiveAiFailures,
              circuitBreakerTrippedAt: aiFailState.circuitBreakerTrippedAt,
            });

            if (aiFailState.circuitBreakerState === "tripped") {
              console.log(`[LOOP-${loopId}] [CIRCUIT BREAKER] TRIPPED after ${aiFailState.consecutiveAiFailures} AI failures`);
              // Telegram risk alert (fire-and-forget)
              try {
                ctx.runAction(internal.telegram.notifier.notifyRiskAlert, {
                  userId: bot.userId,
                  type: "circuit_breaker",
                  message: `Circuit breaker tripped after ${aiFailState.consecutiveAiFailures} consecutive AI failures`,
                  details: "Trading has been paused automatically. Check your AI model configuration.",
                });
              } catch (e) { /* Telegram failure must never block trading */ }
            }
            throw aiError;
          }

          // ── 8. Save AI Log ────────────────────────────────────────
          // Include parser warnings in parsedResponse for dashboard visibility
          const parserWarnings = (decision as any)._parserWarnings || [];
          const parsedResponseWithWarnings = {
            ...decision,
            ...(parserWarnings.length > 0 ? { _parserWarnings: parserWarnings } : {}),
          };

          await ctx.runMutation(api.mutations.saveAILog, {
            userId: bot.userId,
            modelName: bot.modelName,
            systemPrompt: systemPromptName,
            userPrompt: tradingMode === "compact" ? "Pre-processed signals" : tradingMode === "alpha_arena" ? "Alpha Arena raw data" : JSON.stringify({ detailedMarketData, accountState, positions, performanceMetrics }),
            rawResponse: JSON.stringify(decision),
            parsedResponse: parsedResponseWithWarnings,
            decision: decision.decision,
            reasoning: decision.reasoning,
            confidence: decision.confidence,
            accountValue: accountState.accountValue,
            marketData: detailedMarketData,
            processingTimeMs: 0,
          });

          // ── 9. Execute Trade ──────────────────────────────────────
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
          // Telegram risk alert (fire-and-forget)
          try {
            ctx.runAction(internal.telegram.notifier.notifyRiskAlert, {
              userId: bot.userId,
              type: "bot_error",
              message: "Trading cycle encountered an error",
              details: error instanceof Error ? error.message : String(error),
            });
          } catch (e) { /* Telegram failure must never block trading */ }
        } finally {
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

/**
 * Trade execution orchestrator.
 * Delegates to trendGuard → positionValidator → tradeExecutor.
 */
async function executeTradeDecision(ctx: any, bot: any, credentials: any, decision: any, accountState: any) {
  console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
  console.log(`│ TRADE EXECUTION: ${decision.decision} ${decision.symbol || 'N/A'}`);
  console.log(`│ Size: $${decision.size_usd?.toFixed(2) || 'N/A'} | Leverage: ${decision.leverage || 'N/A'}x`);
  console.log(`│ Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
  console.log(`└─────────────────────────────────────────────────────────────┘`);

  // ── Trend Guard ───────────────────────────────────────────────
  const trendResult = await checkTrendGuard(ctx, api, decision, credentials, bot.userId);
  if (!trendResult.allowed) return;

  // ── Position Validation ───────────────────────────────────────
  if (decision.decision === "OPEN_LONG" || decision.decision === "OPEN_SHORT") {
    const validation = await validateOpenPosition(ctx, api, bot, credentials, decision, accountState);
    if (!validation.allowed) return;

    // Legacy risk checks
    const maxPositionSizeUsd = accountState.accountValue * bot.maxPositionSize;
    if (decision.size_usd && decision.size_usd > maxPositionSizeUsd) {
      console.log(`❌ Trade rejected: position size ${decision.size_usd} exceeds max ${maxPositionSizeUsd}`);
      return;
    }
    if (decision.leverage && decision.leverage > bot.maxLeverage) {
      console.log(`❌ Trade rejected: leverage ${decision.leverage} exceeds max ${bot.maxLeverage}`);
      return;
    }
  }

  // ── Execute ───────────────────────────────────────────────────
  try {
    if (decision.decision === "CLOSE") {
      await executeClose(ctx, api, bot, credentials, decision);
    } else if (decision.decision === "OPEN_LONG" || decision.decision === "OPEN_SHORT") {
      await executeOpen(ctx, api, bot, credentials, decision, accountState);
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
