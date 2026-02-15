"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../fnRefs";
import { v } from "convex/values";
import { fetchCandlesInternal } from "../hyperliquid/candles";

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
          openrouterApiKey: args.openrouterApiKey,
          startTime: Date.now(),
          // Candle data (serialized)
          periodCandlesJson: JSON.stringify(periodCandles),
          candles1hJson: JSON.stringify(candles1h),
          candles4hJson: JSON.stringify(candles4h),
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
    openrouterApiKey: v.string(),
    startTime: v.number(),
    // Candle data
    periodCandlesJson: v.string(),
    candles1hJson: v.string(),
    candles4hJson: v.string(),
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

        // Skip AI decision if we already have a position
        if (currentPosition) {
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
              openrouterApiKey: args.openrouterApiKey,
              startTime: args.startTime,
              periodCandlesJson: args.periodCandlesJson,
              candles1hJson: args.candles1hJson,
              candles4hJson: args.candles4hJson,
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
              openrouterApiKey: args.openrouterApiKey,
              startTime: args.startTime,
              periodCandlesJson: args.periodCandlesJson,
              candles1hJson: args.candles1hJson,
              candles4hJson: args.candles4hJson,
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

        // Call AI
        try {
          aiCallsThisChunk++;
          const aiDecision = await callAIForBacktest(
            args.openrouterApiKey,
            args.modelName,
            args.symbol,
            marketContext,
            capital,
            args.maxLeverage
          );

          if (aiDecision && aiDecision.decision !== "HOLD") {
            const positionSize = Math.min(
              capital * 0.2,
              (capital * (aiDecision.size_pct || 20)) / 100
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
  const systemPrompt = `You are a crypto trading bot in backtest mode. Analyze the market data and decide:
- OPEN_LONG: Buy/go long
- OPEN_SHORT: Sell/go short
- HOLD: No trade

Respond ONLY with JSON:
{
  "decision": "HOLD" | "OPEN_LONG" | "OPEN_SHORT",
  "confidence": 0.0 to 1.0,
  "leverage": 1 to ${maxLeverage},
  "size_pct": 10 to 30,
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
