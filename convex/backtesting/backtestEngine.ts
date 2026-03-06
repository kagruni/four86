"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../fnRefs";
import { v } from "convex/values";
import { fetchCandlesInternal } from "../hyperliquid/candles";
import { validateDecisionAgainstRegime } from "../trading/validators/regimeValidator";
import type { DecisionContext } from "../trading/decisionContext";
import { calculateATR } from "../indicators/technicalIndicators";
import {
  buildHybridCandidateSet,
  buildHybridHoldDecision,
} from "../trading/hybridSelection";
import {
  formatHybridCandidateSection,
  formatHybridCloseSection,
} from "../ai/prompts/hybridSelectionPrompt";
import { parseHybridSelectionOutput } from "../ai/chains/tradingChain";

/**
 * Backtest Engine (Chunked) — Realistic Hyperliquid Simulation
 *
 * Runs backtests in chunks to stay under Convex's 600s action timeout.
 * Each chunk processes up to MAX_AI_CALLS_PER_CHUNK AI decisions,
 * then schedules the next chunk with carried-over state.
 *
 * Realistic mechanics:
 * - Correct taker fee (0.045% base tier)
 * - Dynamic slippage by asset liquidity and order size
 * - Hourly funding rate charges
 * - Per-candle liquidation checks
 * - Per-asset max leverage caps
 */

// Max AI calls per chunk — keeps each action well under 600s
const MAX_AI_CALLS_PER_CHUNK = 12;

// Time-based safety: bail out of chunk before Convex's hard 600s kill
// Leave 90s buffer for scheduling next chunk + cleanup mutations
const CHUNK_TIME_BUDGET_MS = 510_000; // 510s = 8.5 minutes

// Per-AI-call fetch timeout — prevents a single hung request from eating the budget
const AI_FETCH_TIMEOUT_MS = 120_000; // 120s per call

// ─── Realistic Hyperliquid Trading Costs ─────────────────────────────────────

const TAKER_FEE_PCT = 0.00045; // 0.045% base tier (correct for <$5M volume)
const LIQUIDATION_FEE_PCT = 0.005; // 0.5% liquidation penalty
const FUNDING_INTERVAL_MS = 3600000; // 1 hour between funding charges

type LiquidityTier = "high" | "medium" | "low";

interface AssetConfig {
  maxLeverage: number;
  maintenanceMarginRate: number; // fraction (e.g. 0.0125 = 1.25%)
  liquidityTier: LiquidityTier;
  defaultFundingRate8h: number; // per 8h (e.g. 0.0001 = 0.01%)
}

const ASSET_CONFIG: Record<string, AssetConfig> = {
  BTC: { maxLeverage: 40, maintenanceMarginRate: 0.0125, liquidityTier: "high", defaultFundingRate8h: 0.0001 },
  ETH: { maxLeverage: 25, maintenanceMarginRate: 0.02, liquidityTier: "high", defaultFundingRate8h: 0.0001 },
  SOL: { maxLeverage: 20, maintenanceMarginRate: 0.025, liquidityTier: "medium", defaultFundingRate8h: 0.00015 },
  XRP: { maxLeverage: 20, maintenanceMarginRate: 0.025, liquidityTier: "medium", defaultFundingRate8h: 0.00015 },
  BNB: { maxLeverage: 10, maintenanceMarginRate: 0.05, liquidityTier: "low", defaultFundingRate8h: 0.0002 },
  DOGE: { maxLeverage: 10, maintenanceMarginRate: 0.05, liquidityTier: "low", defaultFundingRate8h: 0.0002 },
};

const DEFAULT_ASSET_CONFIG: AssetConfig = {
  maxLeverage: 10,
  maintenanceMarginRate: 0.05,
  liquidityTier: "low",
  defaultFundingRate8h: 0.0002,
};

function getAssetConfig(symbol: string): AssetConfig {
  return ASSET_CONFIG[symbol] || DEFAULT_ASSET_CONFIG;
}

/**
 * Calculate dynamic slippage based on notional size and asset liquidity.
 * Scales with order size — larger orders get worse fills.
 */
function calculateSlippage(notionalUsd: number, liquidityTier: LiquidityTier): number {
  switch (liquidityTier) {
    case "high": // BTC, ETH — deep books
      return 0.0001 + 0.0001 * (notionalUsd / 100_000);
    case "medium": // SOL, XRP
      return 0.0003 + 0.0003 * (notionalUsd / 50_000);
    case "low": // BNB, DOGE — thin books
      return 0.0005 + 0.0005 * (notionalUsd / 25_000);
    default:
      return 0.0005;
  }
}

/**
 * Calculate funding cost for a position over a time period.
 * Counts integer hours elapsed and applies hourly rate (1/8 of 8h rate).
 * Longs pay positive funding; shorts receive (and vice versa for negative).
 */
function calculateFundingForPeriod(
  symbol: string,
  side: string,
  notional: number,
  fromTime: number,
  toTime: number
): number {
  const config = getAssetConfig(symbol);
  const hourlyRate = config.defaultFundingRate8h / 8;
  const hoursElapsed = Math.floor((toTime - fromTime) / FUNDING_INTERVAL_MS);
  if (hoursElapsed <= 0) return 0;

  // Positive funding rate = longs pay, shorts receive
  // We assume default positive rate (typical in crypto)
  const rawCost = notional * hourlyRate * hoursElapsed;
  return side === "LONG" ? rawCost : -rawCost; // negative = shorts earn
}

/**
 * Advance funding checkpoint time to avoid double-charging.
 * Snaps forward to the last whole hour boundary that fits in [fromTime, toTime].
 */
function advanceFundingTime(fromTime: number, toTime: number): number {
  const hoursElapsed = Math.floor((toTime - fromTime) / FUNDING_INTERVAL_MS);
  if (hoursElapsed <= 0) return fromTime;
  return fromTime + hoursElapsed * FUNDING_INTERVAL_MS;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface BacktestResult {
  totalPnl: number;
  totalPnlPct: number;
  winRate: number;
  totalTrades: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  finalCapital: number;
  totalFees: number;
  totalFunding: number;
  liquidationCount: number;
}

/**
 * Entry point — fetches candles, then kicks off the first processing chunk.
 */
export const runBacktest = internalAction({
  args: {
    runId: v.id("backtestRuns"),
    userId: v.string(),
    symbol: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    modelName: v.string(),
    tradingPromptMode: v.string(),
    initialCapital: v.number(),
    maxLeverage: v.number(),
    useHybridSelection: v.optional(v.boolean()),
    enableRegimeFilter: v.optional(v.boolean()),
    require1hAlignment: v.optional(v.boolean()),
    redDayLongBlockPct: v.optional(v.number()),
    greenDayShortBlockPct: v.optional(v.number()),
    reentryCooldownMinutes: v.optional(v.number()),
    openrouterApiKey: v.string(),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    const assetConfig = getAssetConfig(args.symbol);
    const effectiveMaxLeverage = Math.min(args.maxLeverage, assetConfig.maxLeverage);

    console.log(
      `[BACKTEST] Starting backtest for ${args.symbol} from ${new Date(args.startDate).toISOString()} to ${new Date(args.endDate).toISOString()}, maxLev: ${effectiveMaxLeverage}x (user: ${args.maxLeverage}x, asset: ${assetConfig.maxLeverage}x)`
    );

    try {
      // Fetch historical candles (5-minute intervals for simulation steps)
      const candles = await fetchCandlesInternal(
        args.symbol,
        "5m",
        5000,
        args.testnet
      );

      // Filter candles to the backtest period
      const periodCandles = candles.filter(
        (c) => c.t >= args.startDate && c.t <= args.endDate
      );

      if (periodCandles.length < 10) {
        throw new Error(
          `Insufficient candle data: only ${periodCandles.length} candles in period`
        );
      }

      console.log(
        `[BACKTEST] ${periodCandles.length} candles loaded for simulation`
      );

      // Also fetch 1h and 4h candles for multi-timeframe context
      const candles1h = await fetchCandlesInternal(
        args.symbol,
        "1h",
        500,
        args.testnet
      );
      const candles4h = await fetchCandlesInternal(
        args.symbol,
        "4h",
        200,
        args.testnet
      );
      const candles1d = await fetchCandlesInternal(
        args.symbol,
        "1d",
        60,
        args.testnet
      );

      const stepSize = 6; // every 6th candle = 30 min intervals
      const totalSteps = Math.ceil((periodCandles.length - 50) / stepSize);

      // Schedule first chunk immediately
      await ctx.scheduler.runAfter(
        0,
        internal.backtesting.backtestEngine.processBacktestChunk,
        {
          runId: args.runId,
          userId: args.userId,
          symbol: args.symbol,
          modelName: args.modelName,
          initialCapital: args.initialCapital,
          maxLeverage: effectiveMaxLeverage,
          useHybridSelection: args.useHybridSelection ?? false,
          enableRegimeFilter: args.enableRegimeFilter ?? true,
          require1hAlignment: args.require1hAlignment ?? true,
          redDayLongBlockPct: args.redDayLongBlockPct ?? -1.5,
          greenDayShortBlockPct: args.greenDayShortBlockPct ?? 1.5,
          reentryCooldownMinutes: args.reentryCooldownMinutes ?? 15,
          openrouterApiKey: args.openrouterApiKey,
          testnet: args.testnet,
          startTime: Date.now(),
          // Candle data (serialized)
          periodCandlesJson: JSON.stringify(periodCandles),
          candles1hJson: JSON.stringify(candles1h),
          candles4hJson: JSON.stringify(candles4h),
          candles1dJson: JSON.stringify(candles1d),
          // Chunk state
          candleIndex: 50, // start from index 50 (need lookback)
          stepSize,
          totalSteps,
          stepCount: 0,
          // Portfolio state
          capital: args.initialCapital,
          peakCapital: args.initialCapital,
          maxDrawdown: 0,
          maxDrawdownPct: 0,
          totalFees: 0,
          totalFunding: 0,
          liquidationCount: 0,
          tradeCount: 0,
          winCount: 0,
          // For Sharpe ratio (running sums)
          returnsSum: 0,
          returnsSquaredSum: 0,
          returnsCount: 0,
          // Current position (null = no position)
          positionJson: "null",
          lastTradeTimestamp: 0,
        }
      );
    } catch (error) {
      console.error("[BACKTEST] Failed to initialize:", error);
      await ctx.runMutation(
        internal.backtesting.backtestActions.failBacktestRun,
        {
          runId: args.runId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  },
});

/**
 * Process one chunk of the backtest simulation.
 * Processes up to MAX_AI_CALLS_PER_CHUNK AI decisions, then schedules the next chunk.
 */
export const processBacktestChunk = internalAction({
  args: {
    runId: v.id("backtestRuns"),
    userId: v.string(),
    symbol: v.string(),
    modelName: v.string(),
    initialCapital: v.number(),
    maxLeverage: v.number(),
    useHybridSelection: v.boolean(),
    enableRegimeFilter: v.boolean(),
    require1hAlignment: v.boolean(),
    redDayLongBlockPct: v.number(),
    greenDayShortBlockPct: v.number(),
    reentryCooldownMinutes: v.number(),
    openrouterApiKey: v.string(),
    testnet: v.boolean(),
    startTime: v.number(),
    // Candle data
    periodCandlesJson: v.string(),
    candles1hJson: v.string(),
    candles4hJson: v.string(),
    candles1dJson: v.string(),
    // Chunk state
    candleIndex: v.number(),
    stepSize: v.number(),
    totalSteps: v.number(),
    stepCount: v.number(),
    // Portfolio state
    capital: v.number(),
    peakCapital: v.number(),
    maxDrawdown: v.number(),
    maxDrawdownPct: v.number(),
    totalFees: v.number(),
    totalFunding: v.number(),
    liquidationCount: v.number(),
    tradeCount: v.number(),
    winCount: v.number(),
    // Sharpe running sums
    returnsSum: v.number(),
    returnsSquaredSum: v.number(),
    returnsCount: v.number(),
    // Current position
    positionJson: v.string(),
    lastTradeTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      // Check for cancellation before starting chunk
      const cancelled = await ctx.runQuery(
        internal.backtesting.backtestActions.isBacktestCancelled,
        { runId: args.runId }
      );
      if (cancelled) {
        console.log(`[BACKTEST] Cancelled by user after ${args.tradeCount} trades`);
        return;
      }

      const assetConfig = getAssetConfig(args.symbol);

      // Deserialize state
      const periodCandles = JSON.parse(args.periodCandlesJson);
      const candles1h = JSON.parse(args.candles1hJson);
      const candles4h = JSON.parse(args.candles4hJson);
      const candles1d = JSON.parse(args.candles1dJson);

      let capital = args.capital;
      let peakCapital = args.peakCapital;
      let maxDrawdown = args.maxDrawdown;
      let maxDrawdownPct = args.maxDrawdownPct;
      let totalFees = args.totalFees;
      let totalFunding = args.totalFunding;
      let liquidationCount = args.liquidationCount;
      let tradeCount = args.tradeCount;
      let winCount = args.winCount;
      let returnsSum = args.returnsSum;
      let returnsSquaredSum = args.returnsSquaredSum;
      let returnsCount = args.returnsCount;
      let currentPosition = JSON.parse(args.positionJson);
      let lastTradeTimestamp = args.lastTradeTimestamp;
      let stepCount = args.stepCount;
      let aiCallsThisChunk = 0;
      let candleIndex = args.candleIndex;
      let capitalDepleted = false;
      const chunkStartMs = Date.now();

      console.log(
        `[BACKTEST] Chunk starting at candle ${candleIndex}, capital: $${capital.toFixed(2)}, trades: ${tradeCount}, AI calls budget: ${MAX_AI_CALLS_PER_CHUNK}, time budget: ${CHUNK_TIME_BUDGET_MS / 1000}s, apiKey: ${args.openrouterApiKey ? args.openrouterApiKey.slice(0, 8) + "..." : "MISSING"}, model: ${args.modelName}`
      );

      // Process steps until we run out of candles or hit AI call limit
      while (candleIndex < periodCandles.length) {
        stepCount++;
        const currentCandle = periodCandles[candleIndex];

        // Update progress every 5 steps
        if (stepCount % 5 === 0) {
          await ctx.runMutation(
            internal.backtesting.backtestActions.updateBacktestProgress,
            {
              runId: args.runId,
              currentCapital: capital,
              currentTrades: tradeCount,
              progressPct: Math.min(100, Math.round((stepCount / args.totalSteps) * 100)),
            }
          );
        }

        // ─── Position checks: funding, liquidation, SL/TP ─────────────
        if (currentPosition) {
          const prevIndex = Math.max(0, candleIndex - args.stepSize);
          let positionClosed = false;

          for (let j = prevIndex; j <= candleIndex; j++) {
            const checkCandle = periodCandles[j];
            if (!checkCandle) continue;

            const notional = currentPosition.size * currentPosition.leverage;
            const margin = currentPosition.size; // margin = position size (collateral)

            // (a) Funding charge — hourly
            const fundingCost = calculateFundingForPeriod(
              args.symbol,
              currentPosition.side,
              notional,
              currentPosition.lastFundingCheckTime,
              checkCandle.t
            );
            if (fundingCost !== 0) {
              currentPosition.accumulatedFunding += fundingCost;
              currentPosition.lastFundingCheckTime = advanceFundingTime(
                currentPosition.lastFundingCheckTime,
                checkCandle.t
              );
            }

            // (b) Liquidation check — at candle's worst price
            const worstPrice = currentPosition.side === "LONG"
              ? checkCandle.l
              : checkCandle.h;

            let unrealizedPnl: number;
            if (currentPosition.side === "LONG") {
              unrealizedPnl =
                ((worstPrice - currentPosition.entryPrice) /
                  currentPosition.entryPrice) *
                notional;
            } else {
              unrealizedPnl =
                ((currentPosition.entryPrice - worstPrice) /
                  currentPosition.entryPrice) *
                notional;
            }

            const positionEquity = margin + unrealizedPnl - currentPosition.accumulatedFunding;
            const maintenanceMargin = notional * assetConfig.maintenanceMarginRate;

            if (positionEquity <= maintenanceMargin) {
              // LIQUIDATION — forced close at worst price
              const liqFee = notional * LIQUIDATION_FEE_PCT;
              const exitFee = notional * TAKER_FEE_PCT;
              const liqPnl = unrealizedPnl - liqFee - exitFee - currentPosition.accumulatedFunding;

              totalFees += liqFee + exitFee;
              totalFunding += currentPosition.accumulatedFunding;
              liquidationCount++;

              const pnlPct = (liqPnl / currentPosition.size) * 100;
              capital += liqPnl;
              tradeCount++;
              if (liqPnl > 0) winCount++; // unlikely for liquidation
              returnsSum += pnlPct;
              returnsSquaredSum += pnlPct * pnlPct;
              returnsCount++;

              await ctx.runMutation(
                internal.backtesting.backtestActions.saveBacktestTrade,
                {
                  runId: args.runId,
                  userId: args.userId,
                  symbol: args.symbol,
                  action: "CLOSE",
                  side: currentPosition.side,
                  entryPrice: currentPosition.entryPrice,
                  exitPrice: worstPrice,
                  size: currentPosition.size,
                  leverage: currentPosition.leverage,
                  pnl: liqPnl,
                  pnlPct,
                  exitReason: "liquidation",
                  fundingPaid: currentPosition.accumulatedFunding,
                  confidence: currentPosition.confidence,
                  reasoning: currentPosition.reasoning,
                  entryTime: currentPosition.entryTime,
                  exitTime: checkCandle.t,
                }
              );

              currentPosition = null;
              positionClosed = true;
              lastTradeTimestamp = checkCandle.t;

              // Track drawdown
              if (capital > peakCapital) peakCapital = capital;
              const drawdown = peakCapital - capital;
              const drawdownPct = (drawdown / peakCapital) * 100;
              if (drawdown > maxDrawdown) maxDrawdown = drawdown;
              if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;

              break;
            }

            // (c) SL/TP check with slippage
            let hitSL = false;
            let hitTP = false;

            if (currentPosition.side === "LONG") {
              hitSL = checkCandle.l <= currentPosition.stopLoss;
              hitTP = checkCandle.h >= currentPosition.takeProfit;
            } else {
              hitSL = checkCandle.h >= currentPosition.stopLoss;
              hitTP = checkCandle.l <= currentPosition.takeProfit;
            }

            if (hitSL || hitTP) {
              // Calculate volatility multiplier from candle range
              const candleRange = (checkCandle.h - checkCandle.l) / checkCandle.c;
              const volatilityMultiplier = Math.max(1.0, candleRange / 0.005); // baseline 0.5% range

              const baseSlippage = calculateSlippage(notional, assetConfig.liquidityTier);

              let exitPrice: number;
              const exitReason = hitSL ? "stop_loss" : "take_profit";

              if (hitSL) {
                // SL gets full slippage in worse direction, scaled by volatility
                const slippagePct = baseSlippage * volatilityMultiplier;
                if (currentPosition.side === "LONG") {
                  exitPrice = currentPosition.stopLoss * (1 - slippagePct);
                } else {
                  exitPrice = currentPosition.stopLoss * (1 + slippagePct);
                }
              } else {
                // TP gets half slippage (less urgency, limit-like execution)
                const slippagePct = baseSlippage * 0.5;
                if (currentPosition.side === "LONG") {
                  exitPrice = currentPosition.takeProfit * (1 - slippagePct);
                } else {
                  exitPrice = currentPosition.takeProfit * (1 + slippagePct);
                }
              }

              let pnl: number;
              if (currentPosition.side === "LONG") {
                pnl =
                  ((exitPrice - currentPosition.entryPrice) /
                    currentPosition.entryPrice) *
                  notional;
              } else {
                pnl =
                  ((currentPosition.entryPrice - exitPrice) /
                    currentPosition.entryPrice) *
                  notional;
              }

              // Deduct exit fee + accumulated funding
              const exitFee = notional * TAKER_FEE_PCT;
              pnl -= exitFee + currentPosition.accumulatedFunding;
              totalFees += exitFee;
              totalFunding += currentPosition.accumulatedFunding;

              const pnlPct = (pnl / currentPosition.size) * 100;
              capital += pnl;
              tradeCount++;
              if (pnl > 0) winCount++;
              returnsSum += pnlPct;
              returnsSquaredSum += pnlPct * pnlPct;
              returnsCount++;

              // Save trade
              await ctx.runMutation(
                internal.backtesting.backtestActions.saveBacktestTrade,
                {
                  runId: args.runId,
                  userId: args.userId,
                  symbol: args.symbol,
                  action: "CLOSE",
                  side: currentPosition.side,
                  entryPrice: currentPosition.entryPrice,
                  exitPrice,
                  size: currentPosition.size,
                  leverage: currentPosition.leverage,
                  pnl,
                  pnlPct,
                  exitReason,
                  fundingPaid: currentPosition.accumulatedFunding,
                  confidence: currentPosition.confidence,
                  reasoning: currentPosition.reasoning,
                  entryTime: currentPosition.entryTime,
                  exitTime: checkCandle.t,
                }
              );

              currentPosition = null;
              positionClosed = true;
              lastTradeTimestamp = checkCandle.t;

              // Track drawdown
              if (capital > peakCapital) peakCapital = capital;
              const drawdown = peakCapital - capital;
              const drawdownPct = (drawdown / peakCapital) * 100;
              if (drawdown > maxDrawdown) maxDrawdown = drawdown;
              if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;

              break;
            }
          }

          // If position was closed (liquidation or SL/TP), skip to capital check
          if (positionClosed) {
            // fall through to capital check below
          }
        }

        // Legacy mode only opens and then lets TP/SL manage exits.
        // Hybrid mode may still ask the LLM whether to HOLD or CLOSE an eligible open position.
        if (currentPosition && !args.useHybridSelection) {
          candleIndex += args.stepSize;
          continue;
        }

        // Stop if capital is too low
        if (capital < args.initialCapital * 0.1) {
          console.log(
            `[BACKTEST] Capital depleted ($${capital.toFixed(2)}), stopping simulation`
          );
          capitalDepleted = true;
          break;
        }

        if (
          !currentPosition &&
          lastTradeTimestamp > 0 &&
          currentCandle.t - lastTradeTimestamp < args.reentryCooldownMinutes * 60 * 1000
        ) {
          candleIndex += args.stepSize;
          continue;
        }

        // Time watchdog: bail out before Convex's hard 600s kill
        const elapsedMs = Date.now() - chunkStartMs;
        if (elapsedMs >= CHUNK_TIME_BUDGET_MS) {
          console.log(
            `[BACKTEST] Time budget exhausted (${(elapsedMs / 1000).toFixed(0)}s elapsed, ${aiCallsThisChunk} AI calls). Scheduling next chunk...`
          );

          await ctx.runMutation(
            internal.backtesting.backtestActions.updateBacktestProgress,
            {
              runId: args.runId,
              currentCapital: capital,
              currentTrades: tradeCount,
              progressPct: Math.min(100, Math.round((stepCount / args.totalSteps) * 100)),
            }
          );

          await ctx.scheduler.runAfter(
            0,
            internal.backtesting.backtestEngine.processBacktestChunk,
            {
              runId: args.runId,
              userId: args.userId,
              symbol: args.symbol,
              modelName: args.modelName,
              initialCapital: args.initialCapital,
              maxLeverage: args.maxLeverage,
              useHybridSelection: args.useHybridSelection,
              enableRegimeFilter: args.enableRegimeFilter,
              require1hAlignment: args.require1hAlignment,
              redDayLongBlockPct: args.redDayLongBlockPct,
              greenDayShortBlockPct: args.greenDayShortBlockPct,
              reentryCooldownMinutes: args.reentryCooldownMinutes,
              openrouterApiKey: args.openrouterApiKey,
              testnet: args.testnet,
              startTime: args.startTime,
              periodCandlesJson: args.periodCandlesJson,
              candles1hJson: args.candles1hJson,
              candles4hJson: args.candles4hJson,
              candles1dJson: args.candles1dJson,
              candleIndex,
              stepSize: args.stepSize,
              totalSteps: args.totalSteps,
              stepCount,
              capital,
              peakCapital,
              maxDrawdown,
              maxDrawdownPct,
              totalFees,
              totalFunding,
              liquidationCount,
              tradeCount,
              winCount,
              returnsSum,
              returnsSquaredSum,
              returnsCount,
              positionJson: JSON.stringify(currentPosition),
              lastTradeTimestamp,
            }
          );
          return;
        }

        // Check if we've hit the AI call limit for this chunk
        if (aiCallsThisChunk >= MAX_AI_CALLS_PER_CHUNK) {
          console.log(
            `[BACKTEST] Chunk limit reached (${aiCallsThisChunk} AI calls). Scheduling next chunk...`
          );

          // Update progress before scheduling next chunk
          await ctx.runMutation(
            internal.backtesting.backtestActions.updateBacktestProgress,
            {
              runId: args.runId,
              currentCapital: capital,
              currentTrades: tradeCount,
              progressPct: Math.min(100, Math.round((stepCount / args.totalSteps) * 100)),
            }
          );

          // Schedule next chunk
          await ctx.scheduler.runAfter(
            0,
            internal.backtesting.backtestEngine.processBacktestChunk,
            {
              runId: args.runId,
              userId: args.userId,
              symbol: args.symbol,
              modelName: args.modelName,
              initialCapital: args.initialCapital,
              maxLeverage: args.maxLeverage,
              useHybridSelection: args.useHybridSelection,
              enableRegimeFilter: args.enableRegimeFilter,
              require1hAlignment: args.require1hAlignment,
              redDayLongBlockPct: args.redDayLongBlockPct,
              greenDayShortBlockPct: args.greenDayShortBlockPct,
              reentryCooldownMinutes: args.reentryCooldownMinutes,
              openrouterApiKey: args.openrouterApiKey,
              testnet: args.testnet,
              startTime: args.startTime,
              periodCandlesJson: args.periodCandlesJson,
              candles1hJson: args.candles1hJson,
              candles4hJson: args.candles4hJson,
              candles1dJson: args.candles1dJson,
              candleIndex,
              stepSize: args.stepSize,
              totalSteps: args.totalSteps,
              stepCount,
              capital,
              peakCapital,
              maxDrawdown,
              maxDrawdownPct,
              totalFees,
              totalFunding,
              liquidationCount,
              tradeCount,
              winCount,
              returnsSum,
              returnsSquaredSum,
              returnsCount,
              positionJson: JSON.stringify(currentPosition),
              lastTradeTimestamp,
            }
          );
          return; // Exit this chunk
        }

        // Build market context from candles
        const recentCandles = periodCandles.slice(Math.max(0, candleIndex - 50), candleIndex + 1);
        const recent1h = candles1h
          .filter((c: any) => c.t <= currentCandle.t)
          .slice(-24);
        const recent4h = candles4h
          .filter((c: any) => c.t <= currentCandle.t)
          .slice(-12);
        const recent1d = candles1d
          .filter((c: any) => c.t <= currentCandle.t)
          .slice(-7);

        const closes = recentCandles.map((c: any) => c.c);
        const currentPrice = currentCandle.c;
        const sma20 =
          closes.slice(-20).reduce((a: number, b: number) => a + b, 0) /
          Math.min(20, closes.length);
        const sma50 =
          closes.slice(-50).reduce((a: number, b: number) => a + b, 0) /
          Math.min(50, closes.length);
        const priceChange1h =
          recent1h.length >= 2
            ? ((currentPrice - recent1h[recent1h.length - 2].c) /
                recent1h[recent1h.length - 2].c) *
              100
            : 0;
        const priceChange4h =
          recent4h.length >= 2
            ? ((currentPrice - recent4h[recent4h.length - 2].c) /
                recent4h[recent4h.length - 2].c) *
              100
            : 0;

        const marketContext = `Symbol: ${args.symbol}
Current Price: $${currentPrice.toFixed(2)}
SMA20: $${sma20.toFixed(2)} (${currentPrice > sma20 ? "above" : "below"})
SMA50: $${sma50.toFixed(2)} (${currentPrice > sma50 ? "above" : "below"})
1h Change: ${priceChange1h.toFixed(2)}%
4h Change: ${priceChange4h.toFixed(2)}%
Recent High: $${Math.max(...recentCandles.slice(-12).map((c: any) => c.h)).toFixed(2)}
Recent Low: $${Math.min(...recentCandles.slice(-12).map((c: any) => c.l)).toFixed(2)}
Account Balance: $${capital.toFixed(2)}
Max Leverage: ${args.maxLeverage}x`;
        const decisionContext = createBacktestDecisionContext(
          args.symbol,
          currentPrice,
          recentCandles,
          recent1h,
          recent4h,
          recent1d
        );

        const backtestPositions = currentPosition
          ? [{
              symbol: args.symbol,
              side: currentPosition.side,
              stopLoss: currentPosition.stopLoss,
              takeProfit: currentPosition.takeProfit,
              unrealizedPnlPct: (() => {
                const rawMovePct = currentPosition.side === "LONG"
                  ? ((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100
                  : ((currentPosition.entryPrice - currentPrice) / currentPosition.entryPrice) * 100;
                return rawMovePct * currentPosition.leverage;
              })(),
            }]
          : [];

        // Call AI
        try {
          let aiDecision: any;
          let hybridCandidateSet = null;

          if (args.useHybridSelection) {
            hybridCandidateSet = buildHybridCandidateSet({
              decisionContext,
              accountState: {
                accountValue: capital,
                withdrawable: capital,
              },
              positions: backtestPositions,
              recentTrades: lastTradeTimestamp > 0
                ? [{ symbol: args.symbol, executedAt: lastTradeTimestamp, action: "OPEN" }]
                : [],
              config: {
                maxLeverage: args.maxLeverage,
                maxPositionSize: 20,
                perTradeRiskPct: 2,
                maxTotalPositions: 1,
                maxSameDirectionPositions: 1,
                minRiskRewardRatio: 2,
                stopLossAtrMultiplier: 1.5,
                reentryCooldownMinutes: args.reentryCooldownMinutes,
                enableRegimeFilter: args.enableRegimeFilter,
                require1hAlignment: args.require1hAlignment,
                redDayLongBlockPct: args.redDayLongBlockPct,
                greenDayShortBlockPct: args.greenDayShortBlockPct,
              },
              allowedSymbols: [args.symbol],
              testnet: args.testnet,
              now: currentCandle.t,
            });

            if (hybridCandidateSet.forcedHold && hybridCandidateSet.closeCandidates.length === 0) {
              aiDecision = buildHybridHoldDecision(
                hybridCandidateSet.holdReason || "No valid hybrid candidates in backtest."
              );
            } else {
              aiCallsThisChunk++;
              aiDecision = await callHybridAIForBacktest(
                args.openrouterApiKey,
                args.modelName,
                hybridCandidateSet,
                capital
              );
            }
          } else {
            aiCallsThisChunk++;
            aiDecision = await callAIForBacktest(
              args.openrouterApiKey,
              args.modelName,
              args.symbol,
              marketContext,
              capital,
              args.maxLeverage
            );
          }

          if (aiDecision && aiDecision.decision !== "HOLD") {
            if (currentPosition && aiDecision.decision === "CLOSE") {
              const notional = currentPosition.size * currentPosition.leverage;
              const remainingFunding = calculateFundingForPeriod(
                args.symbol,
                currentPosition.side,
                notional,
                currentPosition.lastFundingCheckTime,
                currentCandle.t
              );
              currentPosition.accumulatedFunding += remainingFunding;
              const exitSlippage = calculateSlippage(notional, assetConfig.liquidityTier);
              const exitPrice = currentPosition.side === "LONG"
                ? currentPrice * (1 - exitSlippage)
                : currentPrice * (1 + exitSlippage);

              let pnl: number;
              if (currentPosition.side === "LONG") {
                pnl =
                  ((exitPrice - currentPosition.entryPrice) /
                    currentPosition.entryPrice) *
                  notional;
              } else {
                pnl =
                  ((currentPosition.entryPrice - exitPrice) /
                    currentPosition.entryPrice) *
                  notional;
              }

              const exitFee = notional * TAKER_FEE_PCT;
              pnl -= exitFee + currentPosition.accumulatedFunding;
              totalFees += exitFee;
              totalFunding += currentPosition.accumulatedFunding;

              capital += pnl;
              const pnlPct = (pnl / currentPosition.size) * 100;
              tradeCount++;
              if (pnl > 0) winCount++;
              returnsSum += pnlPct;
              returnsSquaredSum += pnlPct * pnlPct;
              returnsCount++;
              lastTradeTimestamp = currentCandle.t;

              await ctx.runMutation(
                internal.backtesting.backtestActions.saveBacktestTrade,
                {
                  runId: args.runId,
                  userId: args.userId,
                  symbol: args.symbol,
                  action: "CLOSE",
                  side: currentPosition.side,
                  entryPrice: currentPosition.entryPrice,
                  exitPrice,
                  size: currentPosition.size,
                  leverage: currentPosition.leverage,
                  pnl,
                  pnlPct,
                  exitReason: "ai_close",
                  fundingPaid: currentPosition.accumulatedFunding,
                  confidence: aiDecision.confidence,
                  reasoning: aiDecision.reasoning,
                  entryTime: currentPosition.entryTime,
                  exitTime: currentCandle.t,
                }
              );

              currentPosition = null;
              candleIndex += args.stepSize;
              continue;
            }

            if (currentPosition) {
              candleIndex += args.stepSize;
              continue;
            }

            const regimeValidation = validateDecisionAgainstRegime(
              {
                enableRegimeFilter: args.enableRegimeFilter,
                require1hAlignment: args.require1hAlignment,
                redDayLongBlockPct: args.redDayLongBlockPct,
                greenDayShortBlockPct: args.greenDayShortBlockPct,
              },
              aiDecision,
              decisionContext
            );
            if (!regimeValidation.allowed) {
              candleIndex += args.stepSize;
              continue;
            }

            const positionSize = Math.min(
              capital * 0.2,
              aiDecision.size_usd || capital * 0.2
            );

            // Enforce per-asset max leverage
            const effectiveLeverage = Math.min(
              aiDecision.leverage || 5,
              args.maxLeverage,
              assetConfig.maxLeverage
            );

            const side = aiDecision.decision === "OPEN_LONG" ? "LONG" : "SHORT";
            const notional = positionSize * effectiveLeverage;

            // Apply dynamic entry slippage
            const entrySlippage = calculateSlippage(notional, assetConfig.liquidityTier);
            const entryPrice = side === "LONG"
              ? currentPrice * (1 + entrySlippage) // buy higher
              : currentPrice * (1 - entrySlippage); // sell lower

            // Entry fee
            const entryFee = notional * TAKER_FEE_PCT;
            totalFees += entryFee;

            currentPosition = {
              symbol: args.symbol,
              side,
              entryPrice,
              size: positionSize,
              leverage: effectiveLeverage,
              stopLoss:
                aiDecision.stop_loss ||
                (side === "LONG"
                  ? currentPrice * 0.97
                  : currentPrice * 1.03),
              takeProfit:
                aiDecision.take_profit ||
                (side === "LONG"
                  ? currentPrice * 1.008
                  : currentPrice * 0.992),
              entryTime: currentCandle.t,
              confidence: aiDecision.confidence || 0.5,
              reasoning: aiDecision.reasoning || "Backtest AI decision",
              // Funding tracking
              lastFundingCheckTime: currentCandle.t,
              accumulatedFunding: 0,
            };
            lastTradeTimestamp = currentCandle.t;

            // Save entry trade
            await ctx.runMutation(
              internal.backtesting.backtestActions.saveBacktestTrade,
              {
                runId: args.runId,
                userId: args.userId,
                symbol: args.symbol,
                action: "OPEN",
                side: currentPosition.side,
                entryPrice,
                size: positionSize,
                leverage: currentPosition.leverage,
                confidence: currentPosition.confidence,
                reasoning: currentPosition.reasoning,
                entryTime: currentCandle.t,
              }
            );
          }
        } catch (aiError) {
          console.error(
            `[BACKTEST] AI call failed at ${new Date(currentCandle.t).toISOString()}:`,
            aiError
          );
        }

        candleIndex += args.stepSize;
      }

      // If we exited the loop, we're done (all candles processed or capital depleted)
      // Close any remaining position at end of period
      if (currentPosition) {
        const lastCandle = periodCandles[periodCandles.length - 1];
        const notional = currentPosition.size * currentPosition.leverage;

        // Charge remaining funding up to last candle
        const remainingFunding = calculateFundingForPeriod(
          args.symbol,
          currentPosition.side,
          notional,
          currentPosition.lastFundingCheckTime,
          lastCandle.t
        );
        currentPosition.accumulatedFunding += remainingFunding;

        // Apply exit slippage
        const exitSlippage = calculateSlippage(notional, assetConfig.liquidityTier);
        const exitPrice = currentPosition.side === "LONG"
          ? lastCandle.c * (1 - exitSlippage) // sell lower
          : lastCandle.c * (1 + exitSlippage); // buy higher to cover

        let pnl: number;
        if (currentPosition.side === "LONG") {
          pnl =
            ((exitPrice - currentPosition.entryPrice) /
              currentPosition.entryPrice) *
            notional;
        } else {
          pnl =
            ((currentPosition.entryPrice - exitPrice) /
              currentPosition.entryPrice) *
            notional;
        }

        // Deduct exit fee + accumulated funding
        const exitFee = notional * TAKER_FEE_PCT;
        pnl -= exitFee + currentPosition.accumulatedFunding;
        totalFees += exitFee;
        totalFunding += currentPosition.accumulatedFunding;

        capital += pnl;
        const pnlPct = (pnl / currentPosition.size) * 100;
        tradeCount++;
        if (pnl > 0) winCount++;
        returnsSum += pnlPct;
        returnsSquaredSum += pnlPct * pnlPct;
        returnsCount++;
        lastTradeTimestamp = lastCandle.t;

        await ctx.runMutation(
          internal.backtesting.backtestActions.saveBacktestTrade,
          {
            runId: args.runId,
            userId: args.userId,
            symbol: args.symbol,
            action: "CLOSE",
            side: currentPosition.side,
            entryPrice: currentPosition.entryPrice,
            exitPrice,
            size: currentPosition.size,
            leverage: currentPosition.leverage,
            pnl,
            pnlPct,
            exitReason: "end_of_period",
            fundingPaid: currentPosition.accumulatedFunding,
            confidence: currentPosition.confidence,
            reasoning: currentPosition.reasoning,
            entryTime: currentPosition.entryTime,
            exitTime: lastCandle.t,
          }
        );
      }

      // Calculate final results
      const totalPnl = capital - args.initialCapital;
      const totalPnlPct = (totalPnl / args.initialCapital) * 100;

      // Sharpe ratio from running sums
      const avgReturn = returnsCount > 0 ? returnsSum / returnsCount : 0;
      const variance =
        returnsCount > 1
          ? (returnsSquaredSum - returnsSum * returnsSum / returnsCount) /
            (returnsCount - 1)
          : 0;
      const stdReturn = Math.sqrt(Math.max(0, variance));
      const sharpeRatio =
        stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

      const results: BacktestResult = {
        totalPnl,
        totalPnlPct,
        winRate: tradeCount > 0 ? (winCount / tradeCount) * 100 : 0,
        totalTrades: tradeCount,
        maxDrawdown,
        maxDrawdownPct,
        sharpeRatio,
        finalCapital: capital,
        totalFees,
        totalFunding,
        liquidationCount,
      };

      // Save results
      await ctx.runMutation(
        internal.backtesting.backtestActions.completeBacktestRun,
        {
          runId: args.runId,
          ...results,
          durationMs: Date.now() - args.startTime,
        }
      );

      console.log(
        `[BACKTEST] Complete: ${tradeCount} trades, P&L: $${totalPnl.toFixed(2)} (${totalPnlPct.toFixed(1)}%), Win Rate: ${results.winRate.toFixed(1)}%, Fees: $${totalFees.toFixed(2)}, Funding: $${totalFunding.toFixed(2)}, Liquidations: ${liquidationCount}`
      );
    } catch (error) {
      console.error("[BACKTEST] Chunk failed:", error);
      await ctx.runMutation(
        internal.backtesting.backtestActions.failBacktestRun,
        {
          runId: args.runId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  },
});

/**
 * Build a minimal shared decision context for backtests.
 * Reuses the same regime validation rules as live trading.
 */
function createBacktestDecisionContext(
  symbol: string,
  currentPrice: number,
  recentCandles: any[],
  recent1h: any[],
  recent4h: any[],
  recent1d: any[]
): DecisionContext {
  const intradayPrices = recentCandles.slice(-10).map((c: any) => c.c);
  const intradayEma20 = intradayPrices.length > 0
    ? intradayPrices.reduce((sum: number, v: number) => sum + v, 0) / intradayPrices.length
    : currentPrice;
  const intradayMomentum =
    intradayPrices.length < 5
      ? "FLAT"
      : intradayPrices[intradayPrices.length - 1] > intradayPrices[intradayPrices.length - 5]
        ? "RISING"
        : intradayPrices[intradayPrices.length - 1] < intradayPrices[intradayPrices.length - 5]
          ? "FALLING"
          : "FLAT";

  const hourlyPrices = recent1h.map((c: any) => c.c);
  const ema20_1h = hourlyPrices.length > 0
    ? hourlyPrices.slice(-20).reduce((sum: number, v: number) => sum + v, 0) / Math.min(20, hourlyPrices.length)
    : currentPrice;
  const ema50_1h = hourlyPrices.length > 0
    ? hourlyPrices.slice(-50).reduce((sum: number, v: number) => sum + v, 0) / Math.min(50, hourlyPrices.length)
    : currentPrice;

  const fourHourPrices = recent4h.map((c: any) => c.c);
  const ema20_4h = fourHourPrices.length > 0
    ? fourHourPrices.slice(-20).reduce((sum: number, v: number) => sum + v, 0) / Math.min(20, fourHourPrices.length)
    : currentPrice;
  const ema50_4h = fourHourPrices.length > 0
    ? fourHourPrices.slice(-50).reduce((sum: number, v: number) => sum + v, 0) / Math.min(50, fourHourPrices.length)
    : currentPrice;
  const atr3_4h = recent4h.length >= 3 ? calculateATR(recent4h, 3) : Math.abs(currentPrice * 0.01);
  const atr14_4h = recent4h.length >= 14 ? calculateATR(recent4h, 14) : Math.abs(currentPrice * 0.015);

  const priceVsEma20Pct = intradayEma20 > 0 ? ((currentPrice - intradayEma20) / intradayEma20) * 100 : 0;
  const ema20VsEma50Pct4h = ema50_4h > 0 ? ((ema20_4h - ema50_4h) / ema50_4h) * 100 : 0;
  const dayOpen = recent1d[recent1d.length - 1]?.o || currentPrice;
  const dayChangePct = dayOpen > 0 ? ((currentPrice - dayOpen) / dayOpen) * 100 : 0;

  return {
    marketSnapshot: {
      generatedAt: new Date().toISOString(),
      symbols: {
        [symbol]: {
          symbol,
          currentPrice,
          dayOpen,
          dayChangePct,
          intraday: {
            ema20: intradayEma20,
            priceVsEma20Pct,
            momentum: intradayMomentum,
            trendDirection: "NEUTRAL",
            priceHistory: intradayPrices,
            ema20History: [],
            macd: 0,
            macdHistory: [],
            rsi7: 50,
            rsi7History: [],
            rsi14: 50,
            rsi14History: [],
          },
          hourly: {
            ema20: ema20_1h,
            ema50: ema50_1h,
            trendDirection: ema20_1h >= ema50_1h ? "BULLISH" : "BEARISH",
            priceHistory: hourlyPrices.slice(-10),
          },
          fourHour: {
            ema20: ema20_4h,
            ema50: ema50_4h,
            ema20VsEma50Pct: ema20VsEma50Pct4h,
            trendDirection: ema20_4h >= ema50_4h ? "BULLISH" : "BEARISH",
            atr3: atr3_4h,
            atr14: atr14_4h,
            currentVolume: recent4h[recent4h.length - 1]?.v || 0,
            avgVolume: 0,
            volumeRatio: 1,
            macdHistory: [],
            rsi14History: [],
          },
          session: {
            high24h: Math.max(...recentCandles.slice(-12).map((c: any) => c.h)),
            low24h: Math.min(...recentCandles.slice(-12).map((c: any) => c.l)),
          },
        },
      },
    },
    marketSnapshotSummary: {
      generatedAt: new Date().toISOString(),
      symbols: {
        [symbol]: {
          currentPrice,
          dayChangePct,
          intradayMomentum,
          intradayTrend: "NEUTRAL",
          hourlyTrend: ema20_1h >= ema50_1h ? "BULLISH" : "BEARISH",
          fourHourTrend: ema20_4h >= ema50_4h ? "BULLISH" : "BEARISH",
          priceVsEma20Pct,
          ema20VsEma50Pct4h,
        },
      },
    },
  };
}

/**
 * Call OpenRouter AI for a backtest trading decision
 */
async function callAIForBacktest(
  apiKey: string,
  modelName: string,
  symbol: string,
  marketContext: string,
  capital: number,
  maxLeverage: number
): Promise<any> {
  const systemPrompt = `You are a crypto trading bot in backtest mode.

Return exactly ONE portfolio-level decision for the current symbol.
Allowed decisions:
- HOLD
- OPEN_LONG
- OPEN_SHORT

Respond ONLY with valid JSON:
{
  "decision": "HOLD" | "OPEN_LONG" | "OPEN_SHORT",
  "symbol": "${symbol}" | null,
  "confidence": 0.0 to 1.0,
  "leverage": 1 to ${maxLeverage},
  "size_usd": <number>,
  "stop_loss": <price>,
  "take_profit": <price>,
  "reasoning": "<brief reason>"
}`;

  const startMs = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: marketContext },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        }),
        signal: controller.signal,
      }
    );
  } catch (fetchError: any) {
    clearTimeout(timeoutId);
    if (fetchError?.name === "AbortError") {
      console.error(`[BACKTEST-AI] Fetch timed out after ${AI_FETCH_TIMEOUT_MS / 1000}s`);
      return { decision: "HOLD", reasoning: "AI call timed out" };
    }
    console.error(`[BACKTEST-AI] Fetch failed after ${Date.now() - startMs}ms:`, fetchError);
    throw fetchError;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown");
    console.error(`[BACKTEST-AI] API error ${response.status} after ${Date.now() - startMs}ms: ${errorText.slice(0, 300)}`);
    throw new Error(`OpenRouter API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  // Some reasoning models (GLM-4.7, DeepSeek R1) put thinking in a `reasoning` field
  // and the actual answer in `content`. If content is empty, check reasoning for JSON.
  let content = message?.content || "";
  const elapsed = Date.now() - startMs;

  if (!content && message?.reasoning) {
    console.log(`[BACKTEST-AI] Empty content but found reasoning field (${message.reasoning.length} chars), extracting JSON from it...`);
    content = message.reasoning;
  }

  if (!content) {
    console.error(`[BACKTEST-AI] Empty content after ${elapsed}ms. Full response: ${JSON.stringify(data).slice(0, 300)}`);
    return { decision: "HOLD", reasoning: "Empty AI response" };
  }

  console.log(`[BACKTEST-AI] Response in ${elapsed}ms, ${content.length} chars, decision preview: ${content.slice(0, 80)}`);

  // Extract JSON
  const jsonMatch = content.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    console.error(`[BACKTEST-AI] No JSON found in response: ${content.slice(0, 200)}`);
    return { decision: "HOLD", reasoning: "No JSON in AI response" };
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    // Try repairing single quotes etc.
    try {
      const repaired = jsonMatch[0].replace(/'/g, '"').replace(/,\s*([\]}])/g, "$1");
      return JSON.parse(repaired);
    } catch {
      console.error(`[BACKTEST-AI] JSON parse failed: ${jsonMatch[0].slice(0, 200)}`);
      return { decision: "HOLD", reasoning: "JSON parse failed" };
    }
  }
}

async function callHybridAIForBacktest(
  apiKey: string,
  modelName: string,
  candidateSet: ReturnType<typeof buildHybridCandidateSet>,
  capital: number
): Promise<any> {
  const systemPrompt = `You are the final selector in a hybrid crypto trading backtest.

Choose exactly one action:
- HOLD
- SELECT_CANDIDATE using one provided candidate_id
- CLOSE using one provided close_symbol

You may only choose from the provided options. Prefer HOLD over forcing a weak trade.

Respond ONLY with valid JSON:
{
  "action": "HOLD" | "SELECT_CANDIDATE" | "CLOSE",
  "candidate_id": "<provided candidate_id or null>",
  "close_symbol": "<provided close symbol or null>",
  "confidence": 0.0 to 1.0,
  "reasoning": "<brief reason>"
}`;

  const userPrompt = [
    `Account Balance: $${capital.toFixed(2)}`,
    `Score Floor: ${candidateSet.scoreFloor}`,
    `Top Entry Candidates:`,
    formatHybridCandidateSection(candidateSet),
    `Eligible Close Options:`,
    formatHybridCloseSection(candidateSet.closeCandidates),
  ].join("\n\n");

  const startMs = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      }
    );
  } catch (fetchError: any) {
    clearTimeout(timeoutId);
    if (fetchError?.name === "AbortError") {
      return buildHybridHoldDecision("Hybrid AI call timed out");
    }
    throw fetchError;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown");
    throw new Error(`OpenRouter API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  const content = message?.content || message?.reasoning || "";
  const elapsed = Date.now() - startMs;
  console.log(`[BACKTEST-HYBRID-AI] Response in ${elapsed}ms, ${content.length} chars`);

  const selection = parseHybridSelectionOutput(
    content,
    new Set(candidateSet.topCandidates.map((candidate) => candidate.id)),
    new Set(candidateSet.closeCandidates.map((candidate) => candidate.symbol))
  );

  if (selection.action === "SELECT_CANDIDATE" && selection.candidate_id) {
    const selected = candidateSet.topCandidates.find((candidate) => candidate.id === selection.candidate_id);
    if (!selected) {
      return buildHybridHoldDecision("Selected candidate missing from shortlist");
    }
    return {
      decision: selected.decision,
      symbol: selected.symbol,
      confidence: selection.confidence,
      reasoning: selection.reasoning,
      leverage: selected.executionPlan.leverage,
      size_usd: selected.executionPlan.sizeUsd,
      stop_loss: selected.executionPlan.stopLoss,
      take_profit: selected.executionPlan.takeProfit,
      invalidation_condition: selected.executionPlan.invalidationCondition,
    };
  }

  if (selection.action === "CLOSE" && selection.close_symbol) {
    return {
      decision: "CLOSE",
      symbol: selection.close_symbol,
      confidence: selection.confidence,
      reasoning: selection.reasoning,
    };
  }

  return {
    decision: "HOLD",
    symbol: null,
    confidence: selection.confidence,
    reasoning: selection.reasoning,
  };
}
