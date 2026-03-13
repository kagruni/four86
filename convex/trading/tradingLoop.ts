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
import { api, internal } from "../fnRefs";
import {
  shouldAllowTrading,
  recordAiFailure,
  recordAiSuccess,
  recordTradeOutcome,
} from "./circuitBreaker";
import { extractHyperliquidSymbols } from "./converters/positionConverter";
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
import { buildStrategyState } from "../wallets/strategyState";

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

function getAccountValue(accountState: any): number {
  const accountValue = accountState?.accountValue;
  if (typeof accountValue !== "number" || !Number.isFinite(accountValue)) {
    return 0;
  }

  return accountValue;
}

function cloneDecision(decision: any) {
  return { ...decision };
}

function buildExecutionGroupId(decision: any) {
  const symbol = decision.symbol ?? "account";
  return `ai-${decision.decision.toLowerCase()}-${symbol}-${Date.now()}`;
}

function scaleDecisionForWallet(
  decision: any,
  strategyAccountState: any,
  walletAccountState: any
) {
  if (decision.decision !== "OPEN_LONG" && decision.decision !== "OPEN_SHORT") {
    return cloneDecision(decision);
  }

  const scaledDecision = cloneDecision(decision);
  const strategyAccountValue = getAccountValue(strategyAccountState);
  const walletAccountValue = getAccountValue(walletAccountState);

  if (
    strategyAccountValue > 0 &&
    walletAccountValue > 0 &&
    typeof decision.size_usd === "number" &&
    Number.isFinite(decision.size_usd)
  ) {
    const sizePct = decision.size_usd / strategyAccountValue;
    scaledDecision.size_usd = walletAccountValue * sizePct;
  }

  return scaledDecision;
}

async function syncWalletPositionsForLoop(
  ctx: any,
  bot: any,
  detailedMarketData: Record<string, any>,
  executionWallets: any[],
  loopId: number
) {
  for (const wallet of executionWallets) {
    const walletId = wallet.walletId ?? undefined;
    let hyperliquidPositions: any[] = [];

    try {
      hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
        address: wallet.hyperliquidAddress,
        testnet: wallet.hyperliquidTestnet,
      });
    } catch (error) {
      console.warn(
        `[LOOP-${loopId}] Position sync skipped for wallet ${wallet.label}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      continue;
    }

    await reconcilePositionsWithExchange(ctx, {
      userId: bot.userId,
      ...(walletId ? { walletId } : {}),
      hyperliquidSymbols: extractHyperliquidSymbols(hyperliquidPositions),
      address: wallet.hyperliquidAddress,
      testnet: wallet.hyperliquidTestnet,
    });

    const dbPositions = await ctx.runQuery(api.queries.getPositions, {
      userId: bot.userId,
      ...(walletId ? { walletId } : {}),
    });
    const trackedSymbols = new Set((dbPositions || []).map((position: any) => position.symbol));

    for (const hyperliquidPosition of hyperliquidPositions || []) {
      const position = hyperliquidPosition.position || hyperliquidPosition;
      const coin = position.coin;
      const szi = parseFloat(position.szi || "0");
      if (!coin || szi === 0 || trackedSymbols.has(coin)) {
        continue;
      }

      const entryPx = parseFloat(position.entryPx || "0");
      const leverage = parseFloat(position.leverage?.value || position.leverage || "1");
      const unrealizedPnl = parseFloat(position.unrealizedPnl || "0");
      const positionValue = Math.abs(parseFloat(position.positionValue || "0"));
      const liquidationPx = parseFloat(position.liquidationPx || "0");
      const currentPrice = detailedMarketData[coin]?.currentPrice || entryPx;

      try {
        await ctx.runMutation(api.mutations.savePosition, {
          userId: bot.userId,
          ...(walletId ? { walletId } : {}),
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
        console.log(
          `[LOOP-${loopId}] Backfilled ${coin} ${szi > 0 ? "LONG" : "SHORT"} into DB for wallet ${wallet.label}`
        );
      } catch (error) {
        console.warn(
          `[LOOP-${loopId}] Failed to backfill ${coin} for wallet ${wallet.label}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }
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

          // ── 3. Wallet Resolution ───────────────────────────────────
          const [primaryWallet, executionWallets] = await Promise.all([
            ctx.runQuery(internal.wallets.queries.getPrimaryWalletInternal, {
              userId: bot.userId,
            }),
            ctx.runQuery(internal.wallets.queries.getActiveConnectedWalletsInternal, {
              userId: bot.userId,
            }),
          ]);

          if (
            !primaryWallet ||
            !primaryWallet.hyperliquidPrivateKey ||
            !primaryWallet.hyperliquidAddress ||
            !executionWallets ||
            executionWallets.length === 0
          ) {
            console.error(`Missing active wallet configuration for user ${bot.userId}`);
            await ctx.runMutation(api.mutations.saveSystemLog, {
              userId: bot.userId,
              level: "ERROR",
              message: "Trading cycle skipped: Missing active wallet configuration",
              data: { botId: bot._id },
            });
            continue;
          }

          // ── 4. Market Data ────────────────────────────────────────
          const symbols = primaryWallet.hyperliquidTestnet
            ? bot.symbols.filter((s: string) => s !== "XRP")
            : bot.symbols;

          const detailedMarketData = await ctx.runAction(api.hyperliquid.detailedMarketData.getDetailedMarketData, {
            symbols,
            testnet: primaryWallet.hyperliquidTestnet,
          });

          // ── 5. Position Sync ──────────────────────────────────────
          await syncWalletPositionsForLoop(ctx, bot, detailedMarketData, executionWallets, loopId);

          const strategyState = await buildStrategyState(ctx, {
            userId: bot.userId,
            detailedMarketData,
          });
          const accountState = strategyState.strategyAccountState ?? {
            accountValue: 0,
            withdrawable: 0,
          };
          const positions = strategyState.positions;
          const openOrders = strategyState.openOrders;
          const recentTrades = strategyState.recentTrades;
          const marketSnapshot = buildMarketSnapshot(detailedMarketData);
          const decisionContext: DecisionContext = {
            marketSnapshot,
            marketSnapshotSummary: summarizeMarketSnapshot(marketSnapshot),
          };

          console.log(
            `[LOOP-${loopId}] Strategy state has ${positions.length} active symbols across ${strategyState.executionWallets.length} wallet(s): ${
              positions.map((p: any) => `${p.symbol} ${p.side}`).join(", ") || "none"
            }`
          );

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

          try {
            if (tradingMode === "alpha_arena" && (bot.useHybridSelection ?? false)) {
              console.log(`[LOOP-${loopId}] Using ALPHA ARENA hybrid candidate selector...`);
              const includeSentimentContext = bot.includeSentimentContext ?? false;
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
                testnet: primaryWallet.hyperliquidTestnet,
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
                  includeSentimentContext,
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
                  includeSentimentContext: bot.includeSentimentContext ?? false,
                  includeSuggestedZones: bot.includeSuggestedZones ?? false,
                  includeLossContext: bot.includeLossContext ?? false,
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
                  belowScoreFloor: hybridCandidateSet.belowScoreFloor,
                  scoreGapToFloor: hybridCandidateSet.scoreGapToFloor,
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
                `Below Score Floor: ${hybridCandidateSet.belowScoreFloor ? "yes" : "no"}`,
                hybridCandidateSet.belowScoreFloor
                  ? `Score Gap to Floor: ${hybridCandidateSet.scoreGapToFloor.toFixed(1)}`
                  : null,
                hybridCandidateSet.holdReason ? `Hold Reason: ${hybridCandidateSet.holdReason}` : null,
                `###[TOP RANKED ENTRY CANDIDATES]`,
                formatHybridCandidateSection(hybridCandidateSet),
                `###[ELIGIBLE CLOSE OPTIONS]`,
                formatHybridCloseSection(hybridCandidateSet.closeCandidates),
                `###[CURRENT OPEN POSITIONS]`,
                formatPositionsAlphaArena(positions),
                (bot.includeSentimentContext ?? false) ? formatSentimentContext(marketResearch) : "",
              ].filter(Boolean).join("\n\n");
            } else {
              const marketSection = formatMarketDataAlphaArena(
                detailedMarketData,
                bot.stopLossAtrMultiplier ?? 1.5,
                bot.minRiskRewardRatio ?? 2.0,
                {
                  enableRegimeFilter: bot.enableRegimeFilter ?? false,
                  includeSuggestedZones: bot.includeSuggestedZones ?? false,
                  require1hAlignment: bot.require1hAlignment ?? true,
                  redDayLongBlockPct: bot.redDayLongBlockPct ?? -1.5,
                  greenDayShortBlockPct: bot.greenDayShortBlockPct ?? 1.5,
                }
              );
              const positionsSection = formatPositionsAlphaArena(positions);
              const includeSentimentContext = bot.includeSentimentContext ?? false;
              const sentimentSection = includeSentimentContext
                ? formatSentimentContext(marketResearch)
                : "";
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
                  includeSentimentContext,
                  includeSuggestedZones: bot.includeSuggestedZones ?? false,
                  includeLossContext: bot.includeLossContext ?? false,
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
	              decision,
	              strategyState,
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
  decision: any,
  strategyState: any,
  decisionContext: DecisionContext
) {
  console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
  console.log(`│ TRADE DECISION: ${decision.decision} ${decision.symbol || 'N/A'}`);
  console.log(`│ Size: $${decision.size_usd?.toFixed(2) || 'N/A'} | Leverage: ${decision.leverage || 'N/A'}x`);
  console.log(`│ Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
  console.log(`└─────────────────────────────────────────────────────────────┘`);

  const accountState = strategyState.strategyAccountState ?? {
    accountValue: 0,
    withdrawable: 0,
  };
  const executionWallets = strategyState.executionWallets ?? [];
  const walletStates = strategyState.walletStates ?? [];
  const positions = strategyState.positions ?? [];
  const openOrders = strategyState.openOrders ?? [];
  const recentTrades = strategyState.recentTrades ?? [];

  if (executionWallets.length === 0) {
    return {
      executed: false,
      blockedBy: "no_active_wallets",
      regimeValidation: null,
      trendValidation: null,
      positionValidation: null,
      walletResults: [],
    };
  }

  // ── Breakeven Close Guard (CLOSE only) ───────────────────────
  // Prevent AI from closing positions at ~$0 P&L. Only allow close if:
  // 1. Position is meaningfully profitable (>= +0.5% P&L), OR
  // 2. TP/SL orders are missing from the position
  if (decision.decision === "CLOSE" && decision.symbol) {
    const MIN_CLOSE_PNL_PCT = 0.5; // Must be at least +0.5% profitable to manually close

    const closeTargets = walletStates
      .map((walletState: any) => {
        const dbPosition = (walletState.dbPositions || []).find(
          (position: any) => position.symbol === decision.symbol
        );
        const strategyPosition = (walletState.positions || []).find(
          (position: any) => position.symbol === decision.symbol
        );
        const livePosition = (walletState.hyperliquidPositions || []).find((position: any) => {
          const nextPosition = position.position || position;
          return nextPosition.coin === decision.symbol && parseFloat(nextPosition.szi || "0") !== 0;
        });

        if (!dbPosition && !strategyPosition && !livePosition) {
          return null;
        }

        return {
          wallet: walletState.wallet,
          walletId: walletState.walletId ?? undefined,
          position: dbPosition ?? strategyPosition ?? null,
          livePosition,
        };
      })
      .filter(Boolean);

    if (closeTargets.length === 0) {
      return {
        executed: false,
        blockedBy: "no_position",
        regimeValidation: null,
        trendValidation: null,
        positionValidation: null,
        walletResults: [],
      };
    }

    if (closeTargets.some((target: any) => target.position?.exitMode === "managed_scalp_v2")) {
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
        walletResults: closeTargets.map((target: any) => ({
          walletId: target.walletId ?? null,
          walletLabel: target.wallet.label,
          address: target.wallet.hyperliquidAddress,
          success: false,
          blockedBy: "managed_exit",
        })),
      };
    }

    const closeGuardState = closeTargets.map((target: any) => {
      let pnlPct = target.position?.unrealizedPnlPct ?? 0;
      if (target.livePosition) {
        const livePosition = target.livePosition.position || target.livePosition;
        const unrealized = parseFloat(livePosition.unrealizedPnl || "0");
        const positionValue = Math.abs(parseFloat(livePosition.positionValue || "0"));
        if (positionValue > 0) {
          pnlPct = (unrealized / positionValue) * 100;
        }
      }

      return {
        walletId: target.walletId ?? null,
        walletLabel: target.wallet.label,
        address: target.wallet.hyperliquidAddress,
        hasTpSl: Boolean(target.position?.stopLoss && target.position?.takeProfit),
        pnlPct,
      };
    });

    const allowClose = closeGuardState.some(
      (walletState: any) => !walletState.hasTpSl || walletState.pnlPct >= MIN_CLOSE_PNL_PCT
    );

    if (!allowClose) {
      console.log(
        `❌ CLOSE rejected: ${decision.symbol} remains below +${MIN_CLOSE_PNL_PCT}% on all wallets with TP/SL protection`
      );
      await ctx.runMutation(api.mutations.saveSystemLog, {
        userId: bot.userId,
        level: "INFO",
        message: `AI close blocked: ${decision.symbol} below +${MIN_CLOSE_PNL_PCT}% threshold across wallets`,
        data: {
          symbol: decision.symbol,
          closeGuardState,
          reasoning: decision.reasoning,
        },
      });
      return {
        executed: false,
        blockedBy: "close_guard",
        regimeValidation: null,
        trendValidation: null,
        positionValidation: null,
        walletResults: closeGuardState.map((walletState: any) => ({
          ...walletState,
          success: false,
          blockedBy: "close_guard",
        })),
      };
    }

    if (closeGuardState.some((walletState: any) => !walletState.hasTpSl)) {
      console.log(`⚠️ ${decision.symbol} has wallets missing TP/SL — allowing close for safety`);
    } else {
      const bestPnlPct = Math.max(...closeGuardState.map((walletState: any) => walletState.pnlPct));
      console.log(`✅ ${decision.symbol} profitable at up to ${bestPnlPct.toFixed(2)}% — allowing AI close`);
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

    const requestedSide = decision.decision === "OPEN_LONG" ? "LONG" : "SHORT";
    const existingPosition = positions.find((position: any) => position.symbol === decision.symbol);
    if (existingPosition) {
      return {
        executed: false,
        blockedBy: "duplicate_position",
        regimeValidation: regimeResult,
        trendValidation: trendResult,
        positionValidation: {
          allowed: false,
          checkName: "ACCOUNT_DUPLICATE_POSITION",
          reason: `Already have ${existingPosition.side} position on ${decision.symbol} across wallets`,
        },
        walletResults: [],
      };
    }

    const existingOpenOrder = openOrders.find(
      (order: any) => (order.coin || order.symbol) === decision.symbol
    );
    if (existingOpenOrder) {
      return {
        executed: false,
        blockedBy: "open_orders",
        regimeValidation: regimeResult,
        trendValidation: trendResult,
        positionValidation: {
          allowed: false,
          checkName: "ACCOUNT_OPEN_ORDER",
          reason: `Open order already exists on ${decision.symbol} across wallets`,
        },
        walletResults: [],
      };
    }

    const maxTotalPositions = bot.maxTotalPositions ?? 3;
    if (positions.length >= maxTotalPositions) {
      return {
        executed: false,
        blockedBy: "max_positions",
        regimeValidation: regimeResult,
        trendValidation: trendResult,
        positionValidation: {
          allowed: false,
          checkName: "ACCOUNT_MAX_POSITIONS",
          reason: `Position limit reached: ${positions.length}/${maxTotalPositions}`,
        },
        walletResults: [],
      };
    }

    const maxSameDirectionPositions = bot.maxSameDirectionPositions ?? 2;
    const sameDirectionCount = positions.filter((position: any) => position.side === requestedSide).length;
    if (sameDirectionCount >= maxSameDirectionPositions) {
      return {
        executed: false,
        blockedBy: "same_direction",
        regimeValidation: regimeResult,
        trendValidation: trendResult,
        positionValidation: {
          allowed: false,
          checkName: "ACCOUNT_SAME_DIRECTION",
          reason: `Same-direction limit reached: ${sameDirectionCount}/${maxSameDirectionPositions} ${requestedSide}`,
        },
        walletResults: [],
      };
    }

    const reentryCooldownMinutes = bot.reentryCooldownMinutes ?? 15;
    const cooldownCutoff = Date.now() - reentryCooldownMinutes * 60 * 1000;
    const recentTradeOnSymbol = recentTrades.find(
      (trade: any) => trade.symbol === decision.symbol && trade.executedAt > cooldownCutoff
    );
    if (recentTradeOnSymbol) {
      const minutesAgo = Math.floor((Date.now() - recentTradeOnSymbol.executedAt) / 60000);
      return {
        executed: false,
        blockedBy: "cooldown",
        regimeValidation: regimeResult,
        trendValidation: trendResult,
        positionValidation: {
          allowed: false,
          checkName: "ACCOUNT_COOLDOWN",
          reason: `Symbol cooldown active: traded ${minutesAgo}min ago`,
        },
        walletResults: [],
      };
    }

    const oneMinuteAgo = Date.now() - 60 * 1000;
    const veryRecentTrade = recentTrades.find(
      (trade: any) =>
        trade.symbol === decision.symbol &&
        trade.action === "OPEN" &&
        trade.executedAt > oneMinuteAgo
    );
    if (veryRecentTrade) {
      const secondsAgo = Math.floor((Date.now() - veryRecentTrade.executedAt) / 1000);
      return {
        executed: false,
        blockedBy: "duplicate_guard",
        regimeValidation: regimeResult,
        trendValidation: trendResult,
        positionValidation: {
          allowed: false,
          checkName: "ACCOUNT_DUPLICATE_GUARD",
          reason: `Duplicate guard: opened ${secondsAgo}s ago`,
        },
        walletResults: [],
      };
    }
  }

  // ── Execute ───────────────────────────────────────────────────
  console.log(`✅ EXECUTING ORDER: ${decision.decision} ${decision.symbol || "N/A"} across ${executionWallets.length} wallet(s)`);
  const executionGroupId = buildExecutionGroupId(decision);
  const walletResults = await Promise.all(
    executionWallets.map(async (wallet: any) => {
      const walletId = wallet.walletId ?? undefined;
      const walletState =
        walletStates.find((state: any) => state.wallet?.walletKey === wallet.walletKey) ?? null;
      const walletAccountState = walletState?.accountState ?? accountState;
      const walletDecision = scaleDecisionForWallet(decision, accountState, walletAccountState);
      let validation: any = null;

      try {
        if (walletDecision.decision === "OPEN_LONG" || walletDecision.decision === "OPEN_SHORT") {
          validation = await validateOpenPosition(
            ctx,
            api,
            bot,
            wallet,
            walletDecision,
            walletAccountState,
            {
              walletId,
              walletKey: wallet.walletKey,
            }
          );

          if (!validation.allowed) {
            return {
              walletId: walletId ?? null,
              walletLabel: wallet.label,
              address: wallet.hyperliquidAddress,
              success: false,
              blockedBy: `position_validator/${validation.checkName}`,
              validation,
              sizeUsd: walletDecision.size_usd ?? null,
              leverage: walletDecision.leverage ?? null,
            };
          }

          const walletMaxPositionSizePct = normalizeMaxPositionSizePct(bot.maxPositionSize);
          const walletMaxPositionSizeUsd = getAccountValue(walletAccountState) * (walletMaxPositionSizePct / 100);
          if (
            walletDecision.size_usd &&
            walletMaxPositionSizeUsd > 0 &&
            walletDecision.size_usd > walletMaxPositionSizeUsd * 1.01
          ) {
            return {
              walletId: walletId ?? null,
              walletLabel: wallet.label,
              address: wallet.hyperliquidAddress,
              success: false,
              blockedBy: "size_cap",
              validation,
              sizeUsd: walletDecision.size_usd,
              leverage: walletDecision.leverage ?? null,
            };
          }
          if (walletDecision.leverage && walletDecision.leverage > bot.maxLeverage) {
            return {
              walletId: walletId ?? null,
              walletLabel: wallet.label,
              address: wallet.hyperliquidAddress,
              success: false,
              blockedBy: "leverage_cap",
              validation,
              sizeUsd: walletDecision.size_usd ?? null,
              leverage: walletDecision.leverage,
            };
          }

          await executeOpen(ctx, api, bot, wallet, walletDecision, walletAccountState, {
            wallet,
            executionGroupId,
          });

          return {
            walletId: walletId ?? null,
            walletLabel: wallet.label,
            address: wallet.hyperliquidAddress,
            success: true,
            blockedBy: null,
            sizeUsd: walletDecision.size_usd ?? null,
            leverage: walletDecision.leverage ?? null,
          };
        }

        if (walletDecision.decision === "CLOSE") {
          const closeResult = await executeClose(ctx, api, bot, wallet, walletDecision, {
            wallet,
            executionGroupId,
            countCircuitBreakerLoss: false,
          });

          return {
            walletId: walletId ?? null,
            walletLabel: wallet.label,
            address: wallet.hyperliquidAddress,
            success: true,
            blockedBy: null,
            pnl: closeResult?.pnl ?? null,
            pnlPct: closeResult?.pnlPct ?? null,
            txHash: closeResult?.txHash ?? null,
          };
        }

        return {
          walletId: walletId ?? null,
          walletLabel: wallet.label,
          address: wallet.hyperliquidAddress,
          success: false,
          blockedBy: "unsupported_decision",
        };
      } catch (error) {
        await ctx.runMutation(api.mutations.saveSystemLog, {
          userId: bot.userId,
          level: "ERROR",
          message: `Wallet execution error: ${decision.decision} on ${decision.symbol}`,
          data: {
            walletId: walletId ?? null,
            walletLabel: wallet.label,
            error: error instanceof Error ? error.message : String(error),
            decision: walletDecision,
          },
        });

        return {
          walletId: walletId ?? null,
          walletLabel: wallet.label,
          address: wallet.hyperliquidAddress,
          success: false,
          blockedBy: "execution_error",
          error: error instanceof Error ? error.message : String(error),
          validation,
          sizeUsd: walletDecision.size_usd ?? null,
          leverage: walletDecision.leverage ?? null,
        };
      } finally {
        if (walletDecision.decision === "OPEN_LONG" || walletDecision.decision === "OPEN_SHORT") {
          await ctx.runMutation(api.mutations.releaseSymbolTradeLock, {
            userId: bot.userId,
            ...(walletId ? { walletId } : {}),
            symbol: walletDecision.symbol,
          }).catch(() => null);
        }
      }
    })
  );

  if (decision.decision === "CLOSE") {
    const successfulCloseResults = walletResults.filter((result: any) => result.success);
    if (successfulCloseResults.length > 0) {
      const aggregatePnl = successfulCloseResults.reduce((sum: number, result: any) => {
        return sum + (typeof result.pnl === "number" ? result.pnl : 0);
      }, 0);
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
        aggregatePnl >= 0
      );

      await ctx.runMutation(api.mutations.updateCircuitBreakerState, {
        userId: bot.userId,
        circuitBreakerState: tradeOutcomeState.circuitBreakerState,
        consecutiveLosses: tradeOutcomeState.consecutiveLosses,
        circuitBreakerTrippedAt: tradeOutcomeState.circuitBreakerTrippedAt,
      });
    }
  }

  const successfulWallets = walletResults.filter((result: any) => result.success);

  return {
    executed: successfulWallets.length > 0,
    blockedBy: successfulWallets.length > 0 ? null : walletResults[0]?.blockedBy ?? "execution_error",
    regimeValidation: regimeResult,
    trendValidation: trendResult,
    positionValidation:
      walletResults.find((result: any) => result.validation)?.validation ?? null,
    executionGroupId,
    requestedWalletCount: executionWallets.length,
    executedWalletCount: successfulWallets.length,
    failedWalletCount: walletResults.length - successfulWallets.length,
    walletResults,
  };
}
