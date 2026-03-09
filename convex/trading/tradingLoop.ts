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
import { validateDecisionAgainstRegime } from "./validators/regimeValidator";
import { validateOpenPosition } from "./validators/positionValidator";
import { executeClose, executeOpen } from "./executors/tradeExecutor";
import {
  buildMarketSnapshot,
  summarizeMarketSnapshot,
  type DecisionContext,
} from "./decisionContext";
import { reconcilePositionsWithExchange } from "./positionSync";
import {
  buildAlphaArenaDecisionTrace,
  formatMarketDataAlphaArena,
  formatPositionsAlphaArena,
  formatSentimentContext,
} from "../ai/prompts/alphaArenaPrompt";
import {
  formatHybridCandidateSection,
  formatHybridCloseSection,
} from "../ai/prompts/hybridSelectionPrompt";
import {
  buildHybridCandidateSet,
  buildHybridHoldDecision,
  type HybridCandidateSet,
} from "./hybridSelection";

function normalizeMaxPositionSizePct(rawMaxPositionSize: number | undefined): number {
  const fallbackPct = 10;
  if (typeof rawMaxPositionSize !== "number" || !Number.isFinite(rawMaxPositionSize)) {
    return fallbackPct;
  }

  // Backward compatibility:
  // - legacy configs stored fractions (0.3 = 30%)
  // - current configs store percent integers (10 = 10%)
  const pct = rawMaxPositionSize <= 1 ? rawMaxPositionSize * 100 : rawMaxPositionSize;
  return Math.max(1, Math.min(100, pct));
}

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
        const effectiveTradingIntervalMinutes = bot.tradingIntervalMinutes ?? 5;
        const intervalMs = effectiveTradingIntervalMinutes * 60 * 1000;
        const lastTradingCycleStartedAt = bot.lastTradingCycleStartedAt ?? 0;
        const elapsedSinceLastCycle = Date.now() - lastTradingCycleStartedAt;

        if (lastTradingCycleStartedAt > 0 && elapsedSinceLastCycle < intervalMs) {
          console.log(
            `[LOOP-${loopId}] Skipping user ${bot.userId}: ${Math.ceil((intervalMs - elapsedSinceLastCycle) / 1000)}s until next ${effectiveTradingIntervalMinutes}m cycle`
          );
          continue;
        }

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

        await ctx.runMutation(api.mutations.markTradingCycleStarted, {
          userId: bot.userId,
        });

        try {
          console.log(`[LOOP-${loopId}] Processing bot ${bot._id} for user ${bot.userId}`);
          const maxPositionSizePct = normalizeMaxPositionSizePct(bot.maxPositionSize);

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
            await reconcilePositionsWithExchange(ctx, {
              userId: bot.userId,
              hyperliquidSymbols,
              address: credentials.hyperliquidAddress,
              testnet: credentials.hyperliquidTestnet,
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
              const positionValue = Math.abs(parseFloat(pos.positionValue || "0"));
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
                  unrealizedPnlPct: positionValue > 0 ? (unrealizedPnl / Math.abs(positionValue)) * 100 : 0,
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
          const marketSnapshot = buildMarketSnapshot(detailedMarketData);
          const decisionContext: DecisionContext = {
            marketSnapshot,
            marketSnapshotSummary: summarizeMarketSnapshot(marketSnapshot),
          };

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
          let hybridCandidateSet: HybridCandidateSet | null = null;

          let openOrders: any[] = [];
          try {
            openOrders = await ctx.runAction(api.hyperliquid.client.getUserOpenOrders, {
              address: credentials.hyperliquidAddress,
              testnet: credentials.hyperliquidTestnet,
            });
          } catch (error) {
            console.warn(`[LOOP-${loopId}] Open orders fetch skipped: ${error instanceof Error ? error.message : String(error)}`);
          }

          const recentTrades = await ctx.runQuery(api.queries.getRecentTrades, {
            userId: bot.userId,
            limit: 50,
          });

          try {
            if (tradingMode === "alpha_arena" && (bot.useHybridSelection ?? false)) {
              console.log(`[LOOP-${loopId}] Using ALPHA ARENA hybrid candidate selector...`);
              hybridCandidateSet = buildHybridCandidateSet({
                decisionContext,
                accountState,
                positions,
                openOrders,
                recentTrades,
                config: {
                  maxLeverage: bot.maxLeverage,
                  maxPositionSize: maxPositionSizePct,
                  perTradeRiskPct: bot.perTradeRiskPct ?? 2.0,
                  maxTotalPositions: bot.maxTotalPositions ?? 3,
                  maxSameDirectionPositions: bot.maxSameDirectionPositions ?? 2,
                  minRiskRewardRatio: bot.minRiskRewardRatio ?? 2.0,
                  stopLossAtrMultiplier: bot.stopLossAtrMultiplier ?? 1.5,
                  reentryCooldownMinutes: bot.reentryCooldownMinutes ?? 15,
                  enableRegimeFilter: bot.enableRegimeFilter ?? false,
                  require1hAlignment: bot.require1hAlignment ?? true,
                  redDayLongBlockPct: bot.redDayLongBlockPct ?? -1.5,
                  greenDayShortBlockPct: bot.greenDayShortBlockPct ?? 1.5,
                  hybridScoreFloor: bot.hybridScoreFloor,
                  hybridFourHourTrendThresholdPct: bot.hybridFourHourTrendThresholdPct,
                  hybridExtremeRsi7Block: bot.hybridExtremeRsi7Block,
                  hybridMinChopVolumeRatio: bot.hybridMinChopVolumeRatio,
                  hybridChopDistanceFromEmaPct: bot.hybridChopDistanceFromEmaPct,
                },
                allowedSymbols: symbols,
                testnet: credentials.hyperliquidTestnet,
              });

              if (hybridCandidateSet.forcedHold && hybridCandidateSet.closeCandidates.length === 0) {
                decision = buildHybridHoldDecision(
                  hybridCandidateSet.holdReason || "No valid hybrid candidates available."
                );
                (decision as any)._selectionMode = "hybrid_llm_ranked";
                (decision as any)._selectedCandidateId = null;
                (decision as any)._rawModelResponse = JSON.stringify({
                  action: "HOLD",
                  reasoning: decision.reasoning,
                });
              } else {
                decision = await ctx.runAction(api.ai.agents.tradingAgent.makeHybridAlphaArenaTradingDecision, {
                  userId: bot.userId,
                  modelType: "openrouter",
                  modelName: bot.modelName,
                  accountState,
                  positions,
                  marketResearch: marketResearch || undefined,
                  candidateSet: hybridCandidateSet,
                });
              }
              systemPromptName = "Alpha Arena hybrid candidate selector";
            } else if (tradingMode === "alpha_arena") {
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
                  maxPositionSize: maxPositionSizePct,
                  perTradeRiskPct: bot.perTradeRiskPct ?? 2.0,
                  maxTotalPositions: bot.maxTotalPositions ?? 3,
                  maxSameDirectionPositions: bot.maxSameDirectionPositions ?? 2,
                  minEntryConfidence: bot.minEntryConfidence ?? 0.60,
                  stopLossAtrMultiplier: bot.stopLossAtrMultiplier ?? 1.5,
                  minRiskRewardRatio: bot.minRiskRewardRatio ?? 2.0,
                  require4hAlignment: bot.require4hAlignment ?? false,
                  tradeVolatileMarkets: bot.tradeVolatileMarkets ?? true,
                  volatilitySizeReduction: bot.volatilitySizeReduction ?? 30,
                  tradingMode: bot.tradingMode ?? "balanced",
                  consecutiveLosses: bot.consecutiveLosses ?? 0,
                  consecutiveLossLimit: bot.consecutiveLossLimit ?? 3,
                  enableRegimeFilter: bot.enableRegimeFilter ?? false,
                  require1hAlignment: bot.require1hAlignment ?? true,
                  redDayLongBlockPct: bot.redDayLongBlockPct ?? -1.5,
                  greenDayShortBlockPct: bot.greenDayShortBlockPct ?? 1.5,
                  managedExitEnabled: bot.managedExitEnabled ?? false,
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
                  maxPositionSize: maxPositionSizePct,
                  perTradeRiskPct: bot.perTradeRiskPct ?? 2.0,
                  maxTotalPositions: bot.maxTotalPositions ?? 3,
                  maxSameDirectionPositions: bot.maxSameDirectionPositions ?? 2,
                  minEntryConfidence: bot.minEntryConfidence ?? 0.60,
                  managedExitEnabled: bot.managedExitEnabled ?? false,
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
                  maxPositionSize: maxPositionSizePct,
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
                  volatilitySizeReduction: bot.volatilitySizeReduction ?? 30,
                  stopLossAtrMultiplier: bot.stopLossAtrMultiplier ?? 1.5,
                  managedExitEnabled: bot.managedExitEnabled ?? false,
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

          // Build the actual prompt content that was sent to the model
          let renderedUserPrompt: string;
          let decisionTrace: any = null;
          if (tradingMode === "alpha_arena") {
            if ((bot.useHybridSelection ?? false) && hybridCandidateSet) {
              decisionTrace = {
                tradingMode: "alpha_arena",
                selectionMode: "hybrid_llm_ranked",
                systemPromptName,
                accountState: {
                  accountValue: accountState.accountValue,
                  withdrawable: accountState.withdrawable,
                  openPositionCount: positions.length,
                },
                hybridSelection: {
                  scoreFloor: hybridCandidateSet.scoreFloor,
                  forcedHold: hybridCandidateSet.forcedHold,
                  holdReason: hybridCandidateSet.holdReason ?? null,
                  candidateCount: hybridCandidateSet.candidates.length,
                  blockedCandidateCount: hybridCandidateSet.blockedCandidates.length,
                  closeCandidateCount: hybridCandidateSet.closeCandidates.length,
                  topCandidates: hybridCandidateSet.topCandidates,
                  blockedCandidates: hybridCandidateSet.blockedCandidates,
                  closeCandidates: hybridCandidateSet.closeCandidates,
                },
                marketSnapshotSummary: decisionContext.marketSnapshotSummary,
                sentiment: marketResearch
                  ? {
                      fearGreedIndex: marketResearch.fearGreedIndex,
                      fearGreedLabel: marketResearch.fearGreedLabel,
                      overallSentiment: marketResearch.overallSentiment,
                      recommendedBias: marketResearch.recommendedBias,
                    }
                  : null,
              };
              renderedUserPrompt = [
                `###[HYBRID CANDIDATE SELECTION - ${new Date().toISOString()}]`,
                `Score Floor: ${hybridCandidateSet.scoreFloor}`,
                `Forced Hold: ${hybridCandidateSet.forcedHold ? "yes" : "no"}`,
                hybridCandidateSet.holdReason ? `Hold Reason: ${hybridCandidateSet.holdReason}` : null,
                `###[TOP RANKED ENTRY CANDIDATES]`,
                formatHybridCandidateSection(hybridCandidateSet),
                `###[ELIGIBLE CLOSE OPTIONS]`,
                formatHybridCloseSection(hybridCandidateSet.closeCandidates),
                `###[CURRENT OPEN POSITIONS]`,
                formatPositionsAlphaArena(positions),
                formatSentimentContext(marketResearch),
              ].filter(Boolean).join("\n\n");
            } else {
              const marketSection = formatMarketDataAlphaArena(
                detailedMarketData,
                bot.stopLossAtrMultiplier ?? 1.5,
                bot.minRiskRewardRatio ?? 2.0,
                {
                  enableRegimeFilter: bot.enableRegimeFilter ?? false,
                  require1hAlignment: bot.require1hAlignment ?? true,
                  redDayLongBlockPct: bot.redDayLongBlockPct ?? -1.5,
                  greenDayShortBlockPct: bot.greenDayShortBlockPct ?? 1.5,
                }
              );
              const positionsSection = formatPositionsAlphaArena(positions);
              const sentimentSection = formatSentimentContext(marketResearch);
              decisionTrace = {
                tradingMode: "alpha_arena",
                selectionMode: "legacy_llm",
                systemPromptName,
                accountState: {
                  accountValue: accountState.accountValue,
                  withdrawable: accountState.withdrawable,
                  openPositionCount: positions.length,
                },
                promptConfig: {
                  legacyModeSemantics: "advisory",
                  maxLeverage: bot.maxLeverage,
                  maxPositionSizePct: maxPositionSizePct,
                  perTradeRiskPct: bot.perTradeRiskPct ?? 2.0,
                  maxTotalPositions: bot.maxTotalPositions ?? 3,
                  maxSameDirectionPositions: bot.maxSameDirectionPositions ?? 2,
                  minEntryConfidence: bot.minEntryConfidence ?? 0.60,
                  stopLossAtrMultiplier: bot.stopLossAtrMultiplier ?? 1.5,
                  minRiskRewardRatio: bot.minRiskRewardRatio ?? 2.0,
                  require4hAlignment: bot.require4hAlignment ?? false,
                  tradeVolatileMarkets: bot.tradeVolatileMarkets ?? true,
                  volatilitySizeReduction: bot.volatilitySizeReduction ?? 30,
                  tradingMode: bot.tradingMode ?? "balanced",
                  consecutiveLosses: bot.consecutiveLosses ?? 0,
                  consecutiveLossLimit: bot.consecutiveLossLimit ?? 3,
                  enableRegimeFilter: bot.enableRegimeFilter ?? false,
                  require1hAlignment: bot.require1hAlignment ?? true,
                  redDayLongBlockPct: bot.redDayLongBlockPct ?? -1.5,
                  greenDayShortBlockPct: bot.greenDayShortBlockPct ?? 1.5,
                  managedExitEnabled: bot.managedExitEnabled ?? false,
                },
                alphaArena: buildAlphaArenaDecisionTrace(
                  detailedMarketData,
                  positions,
                  {
                    // Keep regime diagnostics in logs even when prompt advisories are disabled.
                    enableRegimeFilter: true,
                    require1hAlignment: bot.require1hAlignment ?? true,
                    redDayLongBlockPct: bot.redDayLongBlockPct ?? -1.5,
                    greenDayShortBlockPct: bot.greenDayShortBlockPct ?? 1.5,
                  }
                ),
                marketSnapshotSummary: decisionContext.marketSnapshotSummary,
                sentiment: marketResearch
                  ? {
                      fearGreedIndex: marketResearch.fearGreedIndex,
                      fearGreedLabel: marketResearch.fearGreedLabel,
                      overallSentiment: marketResearch.overallSentiment,
                      recommendedBias: marketResearch.recommendedBias,
                      marketNarrative: marketResearch.marketNarrative,
                      perCoinSentiment: marketResearch.perCoinSentiment ?? null,
                    }
                  : null,
              };
              renderedUserPrompt = [
                `###[MARKET DATA - ${new Date().toISOString()}]`,
                marketSection,
                `###[ACCOUNT STATUS]`,
                `Account Value: ${accountState.accountValue.toFixed(2)} USD`,
                `Available Cash: ${accountState.withdrawable.toFixed(2)} USD`,
                `Open Positions: ${positions.length} / ${bot.maxTotalPositions ?? 3}`,
                `###[CURRENT OPEN POSITIONS]`,
                positionsSection,
                sentimentSection,
              ].join("\n\n");
            }
          } else if (tradingMode === "compact") {
            renderedUserPrompt = "Pre-processed signals (compact mode)";
          } else {
            renderedUserPrompt = JSON.stringify({ detailedMarketData, accountState, positions, performanceMetrics });
          }

          let executionResult: any = {
            executed: false,
            blockedBy: null,
            regimeValidation: null,
            trendValidation: null,
            positionValidation: null,
          };

          // ── 8. Execute Trade ──────────────────────────────────────
          if (decision.decision !== "HOLD") {
            executionResult = await executeTradeDecision(
              ctx,
              bot,
              credentials,
              decision,
              accountState,
              decisionContext
            );
          }

          // ── 9. Save AI Log ────────────────────────────────────────
          // Include parser warnings and decision context for dashboard visibility
          const parserWarnings = (decision as any)._parserWarnings || [];
          const selectionMode = (decision as any)._selectionMode || "legacy_llm";
          const parsedResponseWithWarnings = {
            ...decision,
            selectionMode,
            selectedCandidateId: (decision as any)._selectedCandidateId ?? null,
            decisionTrace,
            candidateSet: hybridCandidateSet,
            candidateScoreBreakdown: hybridCandidateSet?.topCandidates.map((candidate) => ({
              candidateId: candidate.id,
              score: candidate.score,
              scoreBreakdown: candidate.scoreBreakdown,
            })) ?? null,
            marketSnapshotSummary: decisionContext.marketSnapshotSummary,
            executionResult,
            ...(parserWarnings.length > 0 ? { _parserWarnings: parserWarnings } : {}),
          };

          await ctx.runMutation(api.mutations.saveAILog, {
            userId: bot.userId,
            modelName: bot.modelName,
            systemPrompt: systemPromptName,
            userPrompt: renderedUserPrompt,
            rawResponse: (decision as any)._rawModelResponse || JSON.stringify(decision),
            parsedResponse: parsedResponseWithWarnings,
            decision: decision.decision,
            reasoning: decision.reasoning,
            confidence: decision.confidence,
            accountValue: accountState.accountValue,
            marketData: {
              detailedMarketData,
              marketSnapshotSummary: decisionContext.marketSnapshotSummary,
              selectionMode,
              candidateSet: hybridCandidateSet,
            },
            processingTimeMs: 0,
          });

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
async function executeTradeDecision(
  ctx: any,
  bot: any,
  credentials: any,
  decision: any,
  accountState: any,
  decisionContext: DecisionContext
) {
  console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
  console.log(`│ TRADE DECISION: ${decision.decision} ${decision.symbol || 'N/A'}`);
  console.log(`│ Size: $${decision.size_usd?.toFixed(2) || 'N/A'} | Leverage: ${decision.leverage || 'N/A'}x`);
  console.log(`│ Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
  console.log(`└─────────────────────────────────────────────────────────────┘`);

  // ── Breakeven Close Guard (CLOSE only) ───────────────────────
  // Prevent AI from closing positions at ~$0 P&L. Only allow close if:
  // 1. Position is meaningfully profitable (>= +0.5% P&L), OR
  // 2. TP/SL orders are missing from the position
  if (decision.decision === "CLOSE" && decision.symbol) {
    const MIN_CLOSE_PNL_PCT = 0.5; // Must be at least +0.5% profitable to manually close

    const dbPositions = await ctx.runQuery(api.queries.getPositions, {
      userId: bot.userId,
    });
    const posToCheck = dbPositions.find((p: any) => p.symbol === decision.symbol);

    if (posToCheck) {
      if (posToCheck.exitMode === "managed_scalp_v2") {
        console.log(`⚠️ CLOSE ignored for ${decision.symbol}: position is using managed exits`);
        await ctx.runMutation(api.mutations.saveSystemLog, {
          userId: bot.userId,
          level: "INFO",
          message: `AI close skipped: ${decision.symbol} is managed by system exits`,
          data: { symbol: decision.symbol, reasoning: decision.reasoning },
        });
        return {
          executed: false,
          blockedBy: "managed_exit",
          regimeValidation: null,
          trendValidation: null,
          positionValidation: null,
        };
      }

      const hasTpSl = Boolean(posToCheck.stopLoss && posToCheck.takeProfit);
      let pnlPct = posToCheck.unrealizedPnlPct ?? 0;

      // Prefer live exchange P&L over stale DB P&L for anti-churn close checks.
      try {
        const hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
          address: credentials.hyperliquidAddress,
          testnet: credentials.hyperliquidTestnet,
        });
        const livePos = hyperliquidPositions.find((p: any) => {
          const pos = p.position || p;
          return pos.coin === decision.symbol && parseFloat(pos.szi || "0") !== 0;
        });
        if (livePos) {
          const pos = livePos.position || livePos;
          const unrealized = parseFloat(pos.unrealizedPnl || "0");
          const positionValue = Math.abs(parseFloat(pos.positionValue || "0"));
          if (positionValue > 0) {
            pnlPct = (unrealized / positionValue) * 100;
          }
        }
      } catch (error) {
        console.warn(
          `⚠️ Could not fetch live P&L for close guard on ${decision.symbol}, using DB value: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      if (pnlPct < MIN_CLOSE_PNL_PCT && hasTpSl) {
        console.log(`❌ CLOSE rejected: ${decision.symbol} P&L is ${pnlPct.toFixed(2)}% (need >= +${MIN_CLOSE_PNL_PCT}%). TP/SL are set — let exchange handle exit.`);
        await ctx.runMutation(api.mutations.saveSystemLog, {
          userId: bot.userId,
          level: "INFO",
          message: `AI close blocked: ${decision.symbol} P&L ${pnlPct.toFixed(2)}% below +${MIN_CLOSE_PNL_PCT}% threshold`,
          data: { symbol: decision.symbol, pnlPct, reasoning: decision.reasoning },
        });
        return {
          executed: false,
          blockedBy: "close_guard",
          regimeValidation: null,
          trendValidation: null,
          positionValidation: null,
        };
      }

      if (!hasTpSl) {
        console.log(`⚠️ ${decision.symbol} TP/SL missing — allowing close for safety (P&L: ${pnlPct.toFixed(2)}%)`);
      } else {
        console.log(`✅ ${decision.symbol} profitable at ${pnlPct.toFixed(2)}% — allowing AI close to lock gains`);
      }
    }
  }

  const ENFORCE_REGIME_VALIDATOR = false;

  // ── Regime Advisory / Guard ──────────────────────────────────
  const regimeResult = validateDecisionAgainstRegime(bot, decision, decisionContext);
  if (!regimeResult.allowed && ENFORCE_REGIME_VALIDATOR) {
    console.log(`❌ EXECUTION BLOCKED [regime_validator]: ${regimeResult.reason}`);
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "WARNING",
      message: `Regime validator blocked trade: ${decision.decision} on ${decision.symbol}`,
      data: {
        reason: regimeResult.reason,
        checks: regimeResult.checks,
        snapshot: regimeResult.snapshot,
      },
    });
    return {
      executed: false,
      blockedBy: "regime_validator",
      regimeValidation: regimeResult,
      trendValidation: null,
      positionValidation: null,
    };
  }
  if (!regimeResult.allowed && !ENFORCE_REGIME_VALIDATOR) {
    console.log(`⚠️ REGIME ADVISORY ONLY [regime_validator bypassed]: ${regimeResult.reason}`);
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "INFO",
      message: `Regime validator advisory only: ${decision.decision} on ${decision.symbol}`,
      data: {
        reason: regimeResult.reason,
        checks: regimeResult.checks,
        snapshot: regimeResult.snapshot,
      },
    });
  }

  // ── Trend Guard ───────────────────────────────────────────────
  const trendResult = await checkTrendGuard(decision, bot.userId, decisionContext);
  if (!trendResult.allowed) {
    console.log(`❌ EXECUTION BLOCKED [trend_guard]: ${trendResult.reason}`);
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "WARNING",
      message: `Trend guard blocked trade: ${decision.decision} on ${decision.symbol}`,
      data: {
        reason: trendResult.reason,
        trendDirection: trendResult.trendDirection,
        trendStrength: trendResult.trendStrength,
      },
    });
    return {
      executed: false,
      blockedBy: "trend_guard",
      regimeValidation: regimeResult,
      trendValidation: trendResult,
      positionValidation: null,
    };
  }

  // ── Size Normalization (safety net) ──────────────────────────
  if (decision.decision === "OPEN_LONG" || decision.decision === "OPEN_SHORT") {
    const maxPositionSizePct = normalizeMaxPositionSizePct(bot.maxPositionSize);
    const maxPositionSizeUsd = accountState.accountValue * (maxPositionSizePct / 100);
    const minPositionSizeUsd = Math.max(50, accountState.accountValue * 0.05);

    // Bump undersized positions to floor
    if (decision.size_usd && decision.size_usd < minPositionSizeUsd) {
      console.log(`📐 Size normalized: $${decision.size_usd.toFixed(2)} → $${minPositionSizeUsd.toFixed(2)} (floor)`);
      decision.size_usd = minPositionSizeUsd;
    }

    // Cap oversized positions to max
    if (decision.size_usd && decision.size_usd > maxPositionSizeUsd) {
      console.log(`📐 Size normalized: $${decision.size_usd.toFixed(2)} → $${maxPositionSizeUsd.toFixed(2)} (cap)`);
      decision.size_usd = maxPositionSizeUsd;
    }

    // Cap leverage to max
    if (decision.leverage && decision.leverage > bot.maxLeverage) {
      console.log(`📐 Leverage normalized: ${decision.leverage}x → ${bot.maxLeverage}x (cap)`);
      decision.leverage = bot.maxLeverage;
    }
  }

  // ── Position Validation ───────────────────────────────────────
  if (decision.decision === "OPEN_LONG" || decision.decision === "OPEN_SHORT") {
    const validation = await validateOpenPosition(ctx, api, bot, credentials, decision, accountState);
    if (!validation.allowed) {
      console.log(`❌ EXECUTION BLOCKED [position_validator/${validation.checkName}]: ${validation.reason}`);
      return {
        executed: false,
        blockedBy: "position_validator",
        regimeValidation: regimeResult,
        trendValidation: trendResult,
        positionValidation: validation,
      };
    }

    // Legacy risk checks (normalization above already handled sizing, these are now redundant safety nets)
    const maxPositionSizePct_check = normalizeMaxPositionSizePct(bot.maxPositionSize);
    const maxPositionSizeUsd_check = accountState.accountValue * (maxPositionSizePct_check / 100);
    if (decision.size_usd && decision.size_usd > maxPositionSizeUsd_check * 1.01) {
      console.log(`❌ Trade rejected: position size ${decision.size_usd} still exceeds max ${maxPositionSizeUsd_check} after normalization`);
      return {
        executed: false,
        blockedBy: "size_cap",
        regimeValidation: regimeResult,
        trendValidation: trendResult,
        positionValidation: validation,
      };
    }
    if (decision.leverage && decision.leverage > bot.maxLeverage) {
      console.log(`❌ Trade rejected: leverage ${decision.leverage} still exceeds max ${bot.maxLeverage} after normalization`);
      return {
        executed: false,
        blockedBy: "leverage_cap",
        regimeValidation: regimeResult,
        trendValidation: trendResult,
        positionValidation: validation,
      };
    }
  }

  // ── Execute ───────────────────────────────────────────────────
  try {
    console.log(`✅ EXECUTING ORDER: ${decision.decision} ${decision.symbol || "N/A"}`);
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
    return {
      executed: false,
      blockedBy: "execution_error",
      regimeValidation: regimeResult,
      trendValidation: trendResult,
      positionValidation: null,
    };
  }

  return {
    executed: true,
    blockedBy: null,
    regimeValidation: regimeResult,
    trendValidation: trendResult,
    positionValidation: null,
  };
}
