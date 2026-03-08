"use node";

import { internalAction } from "../_generated/server";
import { api, internal } from "../fnRefs";
import { v } from "convex/values";
import { fetchCandlesForRangeInternal } from "../hyperliquid/candles";
import { validateDecisionAgainstRegime } from "../trading/validators/regimeValidator";
import {
  buildMarketSnapshot,
  summarizeMarketSnapshot,
  type DecisionContext,
} from "../trading/decisionContext";
import {
  buildDetailedCoinDataFromCandles,
  type DetailedCoinData,
} from "../hyperliquid/detailedMarketData";
import {
  buildHybridCandidateSet,
  buildHybridHoldDecision,
} from "../trading/hybridSelection";
import { checkTrendGuard } from "../trading/validators/trendGuard";
import {
  MANAGED_EXIT_MODE,
  LEGACY_EXIT_MODE,
  calculateHardStopPrice,
  clampManagedStop,
  getBreakEvenStopPrice,
  getManagedExitRules,
  getManagedPeakPrice,
  getTrailingStopPrice,
  hasStopBeenCrossed,
  tightenManagedStop,
} from "../trading/managedExitUtils";
import {
  formatHybridCandidateSection,
  formatHybridCloseSection,
} from "../ai/prompts/hybridSelectionPrompt";
import { parseHybridSelectionOutput } from "../ai/chains/tradingChain";
import {
  computeMarketOverview,
  evaluatePositions,
  processAllCoins,
} from "../signals/signalProcessor";

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

const ONE_MINUTE_MS = 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FOUR_HOURS_MS = 4 * ONE_HOUR_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

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

type BacktestTradingMode = "alpha_arena" | "compact" | "detailed";

interface SimulatedPosition {
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  size: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
  liquidationPrice: number;
  exitMode: typeof MANAGED_EXIT_MODE | typeof LEGACY_EXIT_MODE;
  managedPeakPrice?: number;
  managedStopPrice?: number;
  managedStopReason?: string;
  entryTime: number;
  confidence: number;
  reasoning: string;
  lastFundingCheckTime: number;
  accumulatedFunding: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeMaxPositionSizePct(rawMaxPositionSize: number): number {
  const pct = rawMaxPositionSize <= 1 ? rawMaxPositionSize * 100 : rawMaxPositionSize;
  return Math.max(1, Math.min(100, pct));
}

function buildHistoricalDetailedCoinData(
  symbol: string,
  recent1m: any[],
  recent1h: any[],
  recent4h: any[],
  recent1d: any[]
): DetailedCoinData {
  return buildDetailedCoinDataFromCandles(
    symbol,
    recent1m,
    recent1h,
    recent4h,
    recent1d
  );
}

function createBacktestDecisionContext(
  marketData: Record<string, DetailedCoinData>
): DecisionContext {
  const marketSnapshot = buildMarketSnapshot(marketData);
  return {
    marketSnapshot,
    marketSnapshotSummary: summarizeMarketSnapshot(marketSnapshot),
  };
}

function createBacktestPositionView(
  currentPositions: SimulatedPosition[],
  currentPrices: Record<string, number>
): any[] {
  return currentPositions.map((position) => {
    const currentPrice = currentPrices[position.symbol] ?? position.entryPrice;
    const notional = position.size * position.leverage;
    const rawPnl = position.side === "LONG"
      ? ((currentPrice - position.entryPrice) / position.entryPrice) * notional
      : ((position.entryPrice - currentPrice) / position.entryPrice) * notional;
    const unrealizedPnl = rawPnl - position.accumulatedFunding;
    const unrealizedPnlPct = position.size > 0
      ? (unrealizedPnl / position.size) * 100
      : 0;

    return {
      symbol: position.symbol,
      side: position.side,
      size: position.size,
      leverage: position.leverage,
      entryPrice: position.entryPrice,
      currentPrice,
      unrealizedPnl,
      unrealizedPnlPct,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      liquidationPrice: position.liquidationPrice,
      exitMode: position.exitMode,
      managedPeakPrice: position.managedPeakPrice,
      managedStopPrice: position.managedStopPrice,
      managedStopReason: position.managedStopReason,
      openedAt: position.entryTime,
      entryReasoning: position.reasoning,
      confidence: position.confidence,
    };
  });
}

function createBacktestAccountState(
  capital: number,
  currentPositions: SimulatedPosition[],
  currentPrices: Record<string, number>
) {
  let unrealizedPnl = 0;
  let usedMargin = 0;

  for (const position of currentPositions) {
    const currentPrice = currentPrices[position.symbol] ?? position.entryPrice;
    const notional = position.size * position.leverage;
    const rawPnl = position.side === "LONG"
      ? ((currentPrice - position.entryPrice) / position.entryPrice) * notional
      : ((position.entryPrice - currentPrice) / position.entryPrice) * notional;
    unrealizedPnl += rawPnl - position.accumulatedFunding;
    usedMargin += position.size;
  }

  return {
    accountValue: capital + unrealizedPnl,
    withdrawable: Math.max(0, capital - usedMargin),
  };
}

function createBacktestPerformanceMetrics(
  initialCapital: number,
  capital: number,
  startTime: number,
  returnsSum: number,
  returnsSquaredSum: number,
  returnsCount: number,
  invocationCount: number
) {
  const totalReturnPct =
    initialCapital > 0 ? ((capital - initialCapital) / initialCapital) * 100 : 0;
  const variance =
    returnsCount > 1
      ? (returnsSquaredSum - (returnsSum * returnsSum) / returnsCount) /
        (returnsCount - 1)
      : 0;
  const stdReturn = Math.sqrt(Math.max(0, variance));
  const sharpeRatio =
    stdReturn > 0 ? (returnsSum / returnsCount / stdReturn) * Math.sqrt(252) : 0;

  return {
    totalReturnPct,
    sharpeRatio: Number.isFinite(sharpeRatio) ? sharpeRatio : 0,
    invocationCount,
    minutesSinceStart: Math.floor((Date.now() - startTime) / 60000),
  };
}

function getLatestCandleAtOrBefore(
  candles: any[],
  timestamp: number
): any | null {
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    if (candles[i]?.t <= timestamp) {
      return candles[i];
    }
  }

  return null;
}

function buildHistoricalMarketDataForSymbols(
  symbols: string[],
  currentTime: number,
  candles1mBySymbol: Record<string, any[]>,
  candles1hBySymbol: Record<string, any[]>,
  candles4hBySymbol: Record<string, any[]>,
  candles1dBySymbol: Record<string, any[]>
): Record<string, DetailedCoinData> {
  const marketData: Record<string, DetailedCoinData> = {};

  for (const symbol of symbols) {
    const recent1m = (candles1mBySymbol[symbol] ?? [])
      .filter((c: any) => c.t <= currentTime)
      .slice(-120);
    const recent1h = (candles1hBySymbol[symbol] ?? [])
      .filter((c: any) => c.t <= currentTime)
      .slice(-80);
    const recent4h = (candles4hBySymbol[symbol] ?? [])
      .filter((c: any) => c.t <= currentTime)
      .slice(-60);
    const recent1d = (candles1dBySymbol[symbol] ?? [])
      .filter((c: any) => c.t <= currentTime)
      .slice(-7);

    if (recent1m.length === 0) {
      continue;
    }

    marketData[symbol] = buildHistoricalDetailedCoinData(
      symbol,
      recent1m,
      recent1h,
      recent4h,
      recent1d
    );
  }

  return marketData;
}

function buildBacktestRecentTrades(
  lastTradeTimestamps: Record<string, number>
): Array<{ symbol: string; executedAt: number; action: string }> {
  return Object.entries(lastTradeTimestamps)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 50)
    .map(([symbol, executedAt]) => ({
      symbol,
      executedAt,
      action: "OPEN",
    }));
}

function calculatePositionRawPnl(
  position: SimulatedPosition,
  exitPrice: number
): number {
  const notional = position.size * position.leverage;
  return position.side === "LONG"
    ? ((exitPrice - position.entryPrice) / position.entryPrice) * notional
    : ((position.entryPrice - exitPrice) / position.entryPrice) * notional;
}

/**
 * Entry point — fetches candles, then kicks off the first processing chunk.
 */
export const runBacktest = internalAction({
  args: {
    runId: v.id("backtestRuns"),
    userId: v.string(),
    symbol: v.string(),
    symbols: v.optional(v.array(v.string())),
    startDate: v.number(),
    endDate: v.number(),
    modelName: v.string(),
    tradingPromptMode: v.string(),
    initialCapital: v.number(),
    maxLeverage: v.number(),
    maxPositionSize: v.number(),
    maxDailyLoss: v.number(),
    minAccountValue: v.number(),
    perTradeRiskPct: v.number(),
    maxTotalPositions: v.number(),
    maxSameDirectionPositions: v.number(),
    consecutiveLossLimit: v.number(),
    tradingMode: v.string(),
    minEntryConfidence: v.number(),
    minRiskRewardRatio: v.number(),
    stopOutCooldownHours: v.number(),
    minEntrySignals: v.number(),
    require4hAlignment: v.boolean(),
    tradeVolatileMarkets: v.boolean(),
    volatilitySizeReduction: v.number(),
    stopLossAtrMultiplier: v.number(),
    useHybridSelection: v.optional(v.boolean()),
    enableRegimeFilter: v.optional(v.boolean()),
    require1hAlignment: v.optional(v.boolean()),
    redDayLongBlockPct: v.optional(v.number()),
    greenDayShortBlockPct: v.optional(v.number()),
    reentryCooldownMinutes: v.optional(v.number()),
    hybridScoreFloor: v.optional(v.number()),
    hybridFourHourTrendThresholdPct: v.optional(v.number()),
    hybridExtremeRsi7Block: v.optional(v.number()),
    hybridMinChopVolumeRatio: v.optional(v.number()),
    hybridChopDistanceFromEmaPct: v.optional(v.number()),
    managedExitEnabled: v.boolean(),
    managedExitHardStopLossPct: v.optional(v.number()),
    managedExitBreakEvenTriggerPct: v.optional(v.number()),
    managedExitBreakEvenLockProfitPct: v.optional(v.number()),
    managedExitTrailingTriggerPct: v.optional(v.number()),
    managedExitTrailingDistancePct: v.optional(v.number()),
    managedExitTightenTriggerPct: v.optional(v.number()),
    managedExitTightenedDistancePct: v.optional(v.number()),
    managedExitStaleMinutes: v.optional(v.number()),
    managedExitStaleMinProfitPct: v.optional(v.number()),
    managedExitMaxHoldMinutes: v.optional(v.number()),
    openrouterApiKey: v.string(),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    const configuredSymbols = args.symbols?.length ? args.symbols : [args.symbol];

    console.log(
      `[BACKTEST] Starting backtest for ${configuredSymbols.join(", ")} from ${new Date(args.startDate).toISOString()} to ${new Date(args.endDate).toISOString()}, maxLev: ${args.maxLeverage}x`
    );

    try {
      const symbolDataEntries = await Promise.all(
        configuredSymbols.map(async (symbol) => {
          const intradayStart = Math.max(
            0,
            args.startDate - 120 * ONE_MINUTE_MS
          );
          const periodStart = Math.max(
            0,
            args.startDate - 50 * FIVE_MINUTES_MS
          );
          const hourlyStart = Math.max(0, args.startDate - 80 * ONE_HOUR_MS);
          const fourHourStart = Math.max(
            0,
            args.startDate - 60 * FOUR_HOURS_MS
          );
          const dailyStart = Math.max(0, args.startDate - 7 * ONE_DAY_MS);
          const [candles5m, candles1m, candles1h, candles4h, candles1d] = await Promise.all([
            fetchCandlesForRangeInternal(
              symbol,
              "5m",
              periodStart,
              args.endDate,
              args.testnet
            ),
            fetchCandlesForRangeInternal(
              symbol,
              "1m",
              intradayStart,
              args.endDate,
              args.testnet
            ),
            fetchCandlesForRangeInternal(
              symbol,
              "1h",
              hourlyStart,
              args.endDate,
              args.testnet
            ),
            fetchCandlesForRangeInternal(
              symbol,
              "4h",
              fourHourStart,
              args.endDate,
              args.testnet
            ),
            fetchCandlesForRangeInternal(
              symbol,
              "1d",
              dailyStart,
              args.endDate,
              args.testnet
            ),
          ]);

          const simulationCandleCount = candles5m.filter(
            (c) => c.t >= args.startDate && c.t <= args.endDate
          ).length;
          const simulationStartIndex = candles5m.findIndex(
            (c) => c.t >= args.startDate
          );

          return {
            symbol,
            periodCandles: candles5m.filter((c) => c.t <= args.endDate),
            candles1m: candles1m.filter((c) => c.t <= args.endDate),
            candles1h,
            candles4h,
            candles1d,
            simulationCandleCount,
            simulationStartIndex,
          };
        })
      );

      const activeEntries = symbolDataEntries.filter(
        (entry) =>
          entry.simulationCandleCount >= 10 && entry.simulationStartIndex >= 0
      );
      if (activeEntries.length === 0) {
        throw new Error("Insufficient candle data for all configured symbols");
      }

      const activeSymbols = activeEntries.map((entry) => entry.symbol);
      const primarySymbol = activeSymbols[0];
      const primaryEntry = activeEntries.find(
        (entry) => entry.symbol === primarySymbol
      );
      const primaryPeriodCandles = primaryEntry?.periodCandles ?? [];
      const simulationStartIndex = Math.max(
        0,
        primaryEntry?.simulationStartIndex ?? 0
      );

      console.log(
        `[BACKTEST] Loaded candle history for ${activeSymbols.join(", ")} (primary ${primarySymbol}: ${primaryEntry?.simulationCandleCount ?? 0} in-range candles, start index ${simulationStartIndex}, total buffered candles ${primaryPeriodCandles.length})`
      );

      const periodCandlesBySymbol = Object.fromEntries(
        activeEntries.map((entry) => [entry.symbol, entry.periodCandles])
      );
      const candles1mBySymbol = Object.fromEntries(
        activeEntries.map((entry) => [entry.symbol, entry.candles1m])
      );
      const candles1hBySymbol = Object.fromEntries(
        activeEntries.map((entry) => [entry.symbol, entry.candles1h])
      );
      const candles4hBySymbol = Object.fromEntries(
        activeEntries.map((entry) => [entry.symbol, entry.candles4h])
      );
      const candles1dBySymbol = Object.fromEntries(
        activeEntries.map((entry) => [entry.symbol, entry.candles1d])
      );

      const stepSize = 1; // mirror the live trading loop cadence: every 5 minutes
      const totalSteps = Math.max(
        1,
        Math.ceil((primaryPeriodCandles.length - simulationStartIndex) / stepSize)
      );

      // Schedule first chunk immediately
      await ctx.scheduler.runAfter(
        0,
        internal.backtesting.backtestEngine.processBacktestChunk,
        {
          runId: args.runId,
          userId: args.userId,
          symbol: args.symbol,
          symbols: activeSymbols,
          modelName: args.modelName,
          tradingPromptMode: args.tradingPromptMode,
          initialCapital: args.initialCapital,
          maxLeverage: args.maxLeverage,
          maxPositionSize: args.maxPositionSize,
          maxDailyLoss: args.maxDailyLoss,
          minAccountValue: args.minAccountValue,
          perTradeRiskPct: args.perTradeRiskPct,
          maxTotalPositions: args.maxTotalPositions,
          maxSameDirectionPositions: args.maxSameDirectionPositions,
          consecutiveLossLimit: args.consecutiveLossLimit,
          tradingMode: args.tradingMode,
          minEntryConfidence: args.minEntryConfidence,
          minRiskRewardRatio: args.minRiskRewardRatio,
          stopOutCooldownHours: args.stopOutCooldownHours,
          minEntrySignals: args.minEntrySignals,
          require4hAlignment: args.require4hAlignment,
          tradeVolatileMarkets: args.tradeVolatileMarkets,
          volatilitySizeReduction: args.volatilitySizeReduction,
          stopLossAtrMultiplier: args.stopLossAtrMultiplier,
          useHybridSelection: args.useHybridSelection ?? false,
          enableRegimeFilter: args.enableRegimeFilter ?? true,
          require1hAlignment: args.require1hAlignment ?? true,
          redDayLongBlockPct: args.redDayLongBlockPct ?? -1.5,
          greenDayShortBlockPct: args.greenDayShortBlockPct ?? 1.5,
          reentryCooldownMinutes: args.reentryCooldownMinutes ?? 15,
          hybridScoreFloor: args.hybridScoreFloor,
          hybridFourHourTrendThresholdPct: args.hybridFourHourTrendThresholdPct,
          hybridExtremeRsi7Block: args.hybridExtremeRsi7Block,
          hybridMinChopVolumeRatio: args.hybridMinChopVolumeRatio,
          hybridChopDistanceFromEmaPct: args.hybridChopDistanceFromEmaPct,
          managedExitEnabled: args.managedExitEnabled,
          managedExitHardStopLossPct: args.managedExitHardStopLossPct,
          managedExitBreakEvenTriggerPct: args.managedExitBreakEvenTriggerPct,
          managedExitBreakEvenLockProfitPct:
            args.managedExitBreakEvenLockProfitPct,
          managedExitTrailingTriggerPct: args.managedExitTrailingTriggerPct,
          managedExitTrailingDistancePct:
            args.managedExitTrailingDistancePct,
          managedExitTightenTriggerPct: args.managedExitTightenTriggerPct,
          managedExitTightenedDistancePct:
            args.managedExitTightenedDistancePct,
          managedExitStaleMinutes: args.managedExitStaleMinutes,
          managedExitStaleMinProfitPct: args.managedExitStaleMinProfitPct,
          managedExitMaxHoldMinutes: args.managedExitMaxHoldMinutes,
          openrouterApiKey: args.openrouterApiKey,
          testnet: args.testnet,
          startTime: Date.now(),
          // Candle data (serialized)
          periodCandlesJson: JSON.stringify(periodCandlesBySymbol),
          candles1mJson: JSON.stringify(candles1mBySymbol),
          candles1hJson: JSON.stringify(candles1hBySymbol),
          candles4hJson: JSON.stringify(candles4hBySymbol),
          candles1dJson: JSON.stringify(candles1dBySymbol),
          // Chunk state
          candleIndex: simulationStartIndex,
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
          // Current positions / per-symbol cooldown state
          positionsJson: "[]",
          lastTradeTimestampsJson: "{}",
          consecutiveLosses: 0,
          aiInvocationCount: 0,
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
    symbols: v.optional(v.array(v.string())),
    modelName: v.string(),
    tradingPromptMode: v.string(),
    initialCapital: v.number(),
    maxLeverage: v.number(),
    maxPositionSize: v.number(),
    maxDailyLoss: v.number(),
    minAccountValue: v.number(),
    perTradeRiskPct: v.number(),
    maxTotalPositions: v.number(),
    maxSameDirectionPositions: v.number(),
    consecutiveLossLimit: v.number(),
    tradingMode: v.string(),
    minEntryConfidence: v.number(),
    minRiskRewardRatio: v.number(),
    stopOutCooldownHours: v.number(),
    minEntrySignals: v.number(),
    require4hAlignment: v.boolean(),
    tradeVolatileMarkets: v.boolean(),
    volatilitySizeReduction: v.number(),
    stopLossAtrMultiplier: v.number(),
    useHybridSelection: v.boolean(),
    enableRegimeFilter: v.boolean(),
    require1hAlignment: v.boolean(),
    redDayLongBlockPct: v.number(),
    greenDayShortBlockPct: v.number(),
    reentryCooldownMinutes: v.number(),
    hybridScoreFloor: v.optional(v.number()),
    hybridFourHourTrendThresholdPct: v.optional(v.number()),
    hybridExtremeRsi7Block: v.optional(v.number()),
    hybridMinChopVolumeRatio: v.optional(v.number()),
    hybridChopDistanceFromEmaPct: v.optional(v.number()),
    managedExitEnabled: v.boolean(),
    managedExitHardStopLossPct: v.optional(v.number()),
    managedExitBreakEvenTriggerPct: v.optional(v.number()),
    managedExitBreakEvenLockProfitPct: v.optional(v.number()),
    managedExitTrailingTriggerPct: v.optional(v.number()),
    managedExitTrailingDistancePct: v.optional(v.number()),
    managedExitTightenTriggerPct: v.optional(v.number()),
    managedExitTightenedDistancePct: v.optional(v.number()),
    managedExitStaleMinutes: v.optional(v.number()),
    managedExitStaleMinProfitPct: v.optional(v.number()),
    managedExitMaxHoldMinutes: v.optional(v.number()),
    openrouterApiKey: v.string(),
    testnet: v.boolean(),
    startTime: v.number(),
    // Candle data
    periodCandlesJson: v.string(),
    candles1mJson: v.string(),
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
    // Current positions and per-symbol cooldown state
    positionsJson: v.string(),
    lastTradeTimestampsJson: v.string(),
    consecutiveLosses: v.number(),
    aiInvocationCount: v.number(),
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

      // Deserialize state
      const periodCandlesBySymbol = JSON.parse(args.periodCandlesJson) as Record<string, any[]>;
      const candles1mBySymbol = JSON.parse(args.candles1mJson) as Record<string, any[]>;
      const candles1hBySymbol = JSON.parse(args.candles1hJson) as Record<string, any[]>;
      const candles4hBySymbol = JSON.parse(args.candles4hJson) as Record<string, any[]>;
      const candles1dBySymbol = JSON.parse(args.candles1dJson) as Record<string, any[]>;
      const symbols = args.symbols?.length ? args.symbols : [args.symbol];
      const primarySymbol = symbols[0];
      const primaryPeriodCandles = periodCandlesBySymbol[primarySymbol] ?? [];

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
      let currentPositions = JSON.parse(args.positionsJson) as SimulatedPosition[];
      let lastTradeTimestamps = JSON.parse(args.lastTradeTimestampsJson) as Record<string, number>;
      let consecutiveLosses = args.consecutiveLosses;
      let aiInvocationCount = args.aiInvocationCount;
      let stepCount = args.stepCount;
      let aiCallsThisChunk = 0;
      let candleIndex = args.candleIndex;
      let capitalDepleted = false;
      let forcedHoldSteps = 0;
      let lastForcedHoldReason: string | null = null;
      let lastProcessedTime =
        primaryPeriodCandles[Math.max(0, candleIndex - args.stepSize)]?.t ??
        primaryPeriodCandles[0]?.t ??
        args.startTime;
      const chunkStartMs = Date.now();
      const safeTotalSteps = Math.max(1, args.totalSteps);

      const updateDrawdown = () => {
        if (capital > peakCapital) peakCapital = capital;
        const drawdown = peakCapital - capital;
        const drawdownPct = peakCapital > 0 ? (drawdown / peakCapital) * 100 : 0;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;
      };

      const scheduleNextChunk = async () => {
        await ctx.runMutation(
          internal.backtesting.backtestActions.updateBacktestProgress,
          {
            runId: args.runId,
            currentCapital: capital,
            currentTrades: tradeCount,
            progressPct: Math.min(
              100,
              Math.round((stepCount / safeTotalSteps) * 100)
            ),
          }
        );

        await ctx.scheduler.runAfter(
          0,
          internal.backtesting.backtestEngine.processBacktestChunk,
          {
            ...args,
            symbols,
            candleIndex,
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
            positionsJson: JSON.stringify(currentPositions),
            lastTradeTimestampsJson: JSON.stringify(lastTradeTimestamps),
            consecutiveLosses,
            aiInvocationCount,
          }
        );
      };

      const closePosition = async (
        position: SimulatedPosition,
        exitPrice: number,
        exitTime: number,
        exitReason: string,
        confidence: number | undefined,
        reasoning: string | undefined,
        options?: {
          addFundingToExitTime?: boolean;
          extraFeePct?: number;
        }
      ) => {
        const notional = position.size * position.leverage;

        if (options?.addFundingToExitTime) {
          const remainingFunding = calculateFundingForPeriod(
            position.symbol,
            position.side,
            notional,
            position.lastFundingCheckTime,
            exitTime
          );
          if (remainingFunding !== 0) {
            position.accumulatedFunding += remainingFunding;
            position.lastFundingCheckTime = advanceFundingTime(
              position.lastFundingCheckTime,
              exitTime
            );
          }
        }

        let pnl = calculatePositionRawPnl(position, exitPrice);
        const exitFee = notional * TAKER_FEE_PCT;
        const extraFee = notional * (options?.extraFeePct ?? 0);
        pnl -= exitFee + extraFee + position.accumulatedFunding;

        totalFees += exitFee + extraFee;
        totalFunding += position.accumulatedFunding;
        capital += pnl;

        const pnlPct = position.size > 0 ? (pnl / position.size) * 100 : 0;
        tradeCount += 1;
        if (pnl > 0) {
          winCount += 1;
          consecutiveLosses = 0;
        } else {
          consecutiveLosses += 1;
        }
        returnsSum += pnlPct;
        returnsSquaredSum += pnlPct * pnlPct;
        returnsCount += 1;
        lastTradeTimestamps[position.symbol] = exitTime;
        currentPositions = currentPositions.filter(
          (candidate) => candidate.symbol !== position.symbol
        );

        await ctx.runMutation(
          internal.backtesting.backtestActions.saveBacktestTrade,
          {
            runId: args.runId,
            userId: args.userId,
            symbol: position.symbol,
            action: "CLOSE",
            side: position.side,
            entryPrice: position.entryPrice,
            exitPrice,
            size: position.size,
            leverage: position.leverage,
            pnl,
            pnlPct,
            exitReason,
            fundingPaid: position.accumulatedFunding,
            confidence,
            reasoning,
            entryTime: position.entryTime,
            exitTime,
          }
        );

        updateDrawdown();
      };

      console.log(
        `[BACKTEST] Chunk starting at candle ${candleIndex}/${primaryPeriodCandles.length - 1}, capital: $${capital.toFixed(2)}, trades: ${tradeCount}, AI calls budget: ${MAX_AI_CALLS_PER_CHUNK}, time budget: ${CHUNK_TIME_BUDGET_MS / 1000}s, apiKey: ${args.openrouterApiKey ? args.openrouterApiKey.slice(0, 8) + "..." : "MISSING"}, model: ${args.modelName}`
      );

      // Process steps until we run out of candles or hit AI call limit
      while (candleIndex < primaryPeriodCandles.length) {
        stepCount++;
        const currentCandle = primaryPeriodCandles[candleIndex];
        lastProcessedTime = currentCandle.t;

        // Update progress every 5 steps
        if (stepCount % 5 === 0) {
          await ctx.runMutation(
            internal.backtesting.backtestActions.updateBacktestProgress,
            {
              runId: args.runId,
              currentCapital: capital,
              currentTrades: tradeCount,
              progressPct: Math.min(
                100,
                Math.round((stepCount / safeTotalSteps) * 100)
              ),
            }
          );
        }

        // ─── Position checks: funding, liquidation, managed exits, SL/TP ───
        const previousAnchorTime =
          primaryPeriodCandles[Math.max(0, candleIndex - args.stepSize)]?.t ??
          currentCandle.t;

        for (const position of [...currentPositions]) {
          if (!currentPositions.some((candidate) => candidate.symbol === position.symbol)) {
            continue;
          }

          const assetConfig = getAssetConfig(position.symbol);
          const symbolCandles = periodCandlesBySymbol[position.symbol] ?? [];
          const candlesToCheck = symbolCandles.filter(
            (candle) => candle.t > previousAnchorTime && candle.t <= currentCandle.t
          );
          if (candlesToCheck.length === 0) {
            const latestCandle = getLatestCandleAtOrBefore(
              symbolCandles,
              currentCandle.t
            );
            if (latestCandle) {
              candlesToCheck.push(latestCandle);
            }
          }

          for (const checkCandle of candlesToCheck) {
            if (!currentPositions.some((candidate) => candidate.symbol === position.symbol)) {
              break;
            }

            const notional = position.size * position.leverage;
            const margin = position.size;
            const fundingCost = calculateFundingForPeriod(
              position.symbol,
              position.side,
              notional,
              position.lastFundingCheckTime,
              checkCandle.t
            );
            if (fundingCost !== 0) {
              position.accumulatedFunding += fundingCost;
              position.lastFundingCheckTime = advanceFundingTime(
                position.lastFundingCheckTime,
                checkCandle.t
              );
            }

            const worstPrice = position.side === "LONG" ? checkCandle.l : checkCandle.h;
            const worstCasePnl = calculatePositionRawPnl(position, worstPrice);
            const positionEquity = margin + worstCasePnl - position.accumulatedFunding;
            const maintenanceMargin =
              notional * assetConfig.maintenanceMarginRate;

            if (positionEquity <= maintenanceMargin) {
              liquidationCount += 1;
              await closePosition(
                position,
                worstPrice,
                checkCandle.t,
                "liquidation",
                position.confidence,
                position.reasoning,
                { extraFeePct: LIQUIDATION_FEE_PCT }
              );
              break;
            }

            if (position.exitMode === MANAGED_EXIT_MODE) {
              const managedExitRules = getManagedExitRules({
                managedExitEnabled: args.managedExitEnabled,
                managedExitHardStopLossPct: args.managedExitHardStopLossPct,
                managedExitBreakEvenTriggerPct:
                  args.managedExitBreakEvenTriggerPct,
                managedExitBreakEvenLockProfitPct:
                  args.managedExitBreakEvenLockProfitPct,
                managedExitTrailingTriggerPct:
                  args.managedExitTrailingTriggerPct,
                managedExitTrailingDistancePct:
                  args.managedExitTrailingDistancePct,
                managedExitTightenTriggerPct:
                  args.managedExitTightenTriggerPct,
                managedExitTightenedDistancePct:
                  args.managedExitTightenedDistancePct,
                managedExitStaleMinutes: args.managedExitStaleMinutes,
                managedExitStaleMinProfitPct:
                  args.managedExitStaleMinProfitPct,
                managedExitMaxHoldMinutes: args.managedExitMaxHoldMinutes,
              });
              const priceForPeak = checkCandle.c;
              const livePnlPct =
                position.side === "LONG"
                  ? ((priceForPeak - position.entryPrice) / position.entryPrice) *
                    100 *
                    position.leverage
                  : ((position.entryPrice - priceForPeak) / position.entryPrice) *
                    100 *
                    position.leverage;
              const peakPrice = getManagedPeakPrice(
                position.side,
                position.managedPeakPrice,
                priceForPeak
              );
              const hardStop = calculateHardStopPrice(
                position.entryPrice,
                position.side,
                managedExitRules.managedExitHardStopLossPct
              );
              const breakEvenStop =
                livePnlPct >= managedExitRules.managedExitBreakEvenTriggerPct
                  ? getBreakEvenStopPrice(
                      position.entryPrice,
                      position.side,
                      managedExitRules.managedExitBreakEvenLockProfitPct
                    )
                  : undefined;
              const trailingStop =
                livePnlPct >= managedExitRules.managedExitTrailingTriggerPct
                  ? getTrailingStopPrice(
                      peakPrice,
                      position.side,
                      managedExitRules.managedExitTrailingDistancePct
                    )
                  : undefined;
              const tightenedStop =
                livePnlPct >= managedExitRules.managedExitTightenTriggerPct
                  ? getTrailingStopPrice(
                      peakPrice,
                      position.side,
                      managedExitRules.managedExitTightenedDistancePct
                    )
                  : undefined;
              const effectiveStop = tightenManagedStop(
                position.side,
                position.managedStopPrice,
                [hardStop, breakEvenStop, trailingStop, tightenedStop]
              );

              position.managedPeakPrice = peakPrice;
              position.managedStopPrice = effectiveStop;
              position.stopLoss = effectiveStop;
              position.managedStopReason =
                effectiveStop === tightenedStop
                  ? "tightened_trailing_stop"
                  : effectiveStop === trailingStop
                    ? "trailing_stop"
                    : effectiveStop === breakEvenStop
                      ? "break_even_stop"
                      : "hard_stop";

              const ageMinutes =
                (checkCandle.t - position.entryTime) / 60000;
              let managedExitReason: string | null = null;
              let managedExitPrice = checkCandle.c;

              if (
                ageMinutes >= managedExitRules.managedExitStaleMinutes &&
                livePnlPct < managedExitRules.managedExitStaleMinProfitPct
              ) {
                managedExitReason = "stale_trade";
              } else if (
                ageMinutes >= managedExitRules.managedExitMaxHoldMinutes
              ) {
                managedExitReason = "max_hold";
              } else if (
                typeof effectiveStop === "number" &&
                hasStopBeenCrossed(
                  position.side,
                  position.side === "LONG" ? checkCandle.l : checkCandle.h,
                  effectiveStop
                )
              ) {
                const baseSlippage = calculateSlippage(
                  notional,
                  assetConfig.liquidityTier
                );
                const slippagePct =
                  baseSlippage *
                  Math.max(1, (checkCandle.h - checkCandle.l) / checkCandle.c / 0.005);
                managedExitPrice =
                  position.side === "LONG"
                    ? effectiveStop * (1 - slippagePct)
                    : effectiveStop * (1 + slippagePct);
                managedExitReason = position.managedStopReason || "hard_stop";
              }

              if (managedExitReason) {
                await closePosition(
                  position,
                  managedExitPrice,
                  checkCandle.t,
                  managedExitReason,
                  position.confidence,
                  position.reasoning
                );
                break;
              }
            }

            let hitSL = false;
            let hitTP = false;

            if (position.side === "LONG") {
              hitSL =
                typeof position.stopLoss === "number" &&
                checkCandle.l <= position.stopLoss;
              hitTP =
                typeof position.takeProfit === "number" &&
                checkCandle.h >= position.takeProfit;
            } else {
              hitSL =
                typeof position.stopLoss === "number" &&
                checkCandle.h >= position.stopLoss;
              hitTP =
                typeof position.takeProfit === "number" &&
                checkCandle.l <= position.takeProfit;
            }

            if (hitSL || hitTP) {
              const candleRange = (checkCandle.h - checkCandle.l) / checkCandle.c;
              const volatilityMultiplier = Math.max(1, candleRange / 0.005);
              const baseSlippage = calculateSlippage(
                notional,
                assetConfig.liquidityTier
              );
              const exitReason = hitSL ? "stop_loss" : "take_profit";

              let exitPrice: number;
              if (hitSL) {
                const slippagePct = baseSlippage * volatilityMultiplier;
                exitPrice =
                  position.side === "LONG"
                    ? position.stopLoss! * (1 - slippagePct)
                    : position.stopLoss! * (1 + slippagePct);
              } else {
                const slippagePct = baseSlippage * 0.5;
                exitPrice =
                  position.side === "LONG"
                    ? position.takeProfit! * (1 - slippagePct)
                    : position.takeProfit! * (1 + slippagePct);
              }

              await closePosition(
                position,
                exitPrice,
                checkCandle.t,
                exitReason,
                position.confidence,
                position.reasoning
              );
              break;
            }
          }
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
          await scheduleNextChunk();
          return;
        }

        // Check if we've hit the AI call limit for this chunk
        if (aiCallsThisChunk >= MAX_AI_CALLS_PER_CHUNK) {
          console.log(
            `[BACKTEST] Chunk limit reached (${aiCallsThisChunk} AI calls). Scheduling next chunk...`
          );
          await scheduleNextChunk();
          return; // Exit this chunk
        }

        // Build historical market snapshot that matches the live prompt contracts.
        const historicalMarketData = buildHistoricalMarketDataForSymbols(
          symbols,
          currentCandle.t,
          candles1mBySymbol,
          candles1hBySymbol,
          candles4hBySymbol,
          candles1dBySymbol
        );
        if (Object.keys(historicalMarketData).length === 0) {
          candleIndex += args.stepSize;
          continue;
        }

        const currentPrices = Object.fromEntries(
          Object.entries(historicalMarketData).map(([symbol, data]) => [
            symbol,
            data.currentPrice,
          ])
        );
        const decisionContext = createBacktestDecisionContext(
          historicalMarketData
        );
        const backtestPositions = createBacktestPositionView(
          currentPositions,
          currentPrices
        );
        const accountState = createBacktestAccountState(
          capital,
          currentPositions,
          currentPrices
        );
        const performanceMetrics = createBacktestPerformanceMetrics(
          args.initialCapital,
          capital,
          args.startTime,
          returnsSum,
          returnsSquaredSum,
          returnsCount,
          aiInvocationCount
        );
        const tradingPromptMode =
          (args.tradingPromptMode as BacktestTradingMode) || "alpha_arena";

        try {
          let aiDecision: any;
          let hybridCandidateSet = null;
          const recentTrades = buildBacktestRecentTrades(lastTradeTimestamps);

          if (tradingPromptMode === "alpha_arena" && args.useHybridSelection) {
            hybridCandidateSet = buildHybridCandidateSet({
              decisionContext,
              accountState,
              positions: backtestPositions,
              recentTrades,
              config: {
                maxLeverage: args.maxLeverage,
                maxPositionSize: normalizeMaxPositionSizePct(args.maxPositionSize),
                perTradeRiskPct: args.perTradeRiskPct,
                maxTotalPositions: args.maxTotalPositions,
                maxSameDirectionPositions: args.maxSameDirectionPositions,
                minRiskRewardRatio: args.minRiskRewardRatio,
                stopLossAtrMultiplier: args.stopLossAtrMultiplier,
                reentryCooldownMinutes: args.reentryCooldownMinutes,
                enableRegimeFilter: args.enableRegimeFilter,
                require1hAlignment: args.require1hAlignment,
                redDayLongBlockPct: args.redDayLongBlockPct,
                greenDayShortBlockPct: args.greenDayShortBlockPct,
                hybridScoreFloor: args.hybridScoreFloor,
                hybridFourHourTrendThresholdPct:
                  args.hybridFourHourTrendThresholdPct,
                hybridExtremeRsi7Block: args.hybridExtremeRsi7Block,
                hybridMinChopVolumeRatio: args.hybridMinChopVolumeRatio,
                hybridChopDistanceFromEmaPct: args.hybridChopDistanceFromEmaPct,
              },
              allowedSymbols: symbols,
              testnet: args.testnet,
              now: currentCandle.t,
            });

            if (
              hybridCandidateSet.forcedHold &&
              hybridCandidateSet.closeCandidates.length === 0
            ) {
              forcedHoldSteps += 1;
              lastForcedHoldReason =
                hybridCandidateSet.holdReason ||
                "No valid hybrid candidates in backtest.";
              aiDecision = buildHybridHoldDecision(
                lastForcedHoldReason
              );
            } else {
              aiCallsThisChunk += 1;
              aiInvocationCount += 1;
              aiDecision = await ctx.runAction(
                api.ai.agents.tradingAgent.makeHybridAlphaArenaTradingDecision,
                {
                  userId: args.userId,
                  modelType: "openrouter",
                  modelName: args.modelName,
                  accountState,
                  positions: backtestPositions,
                  candidateSet: hybridCandidateSet,
                }
              );
            }
          } else if (tradingPromptMode === "alpha_arena") {
            aiCallsThisChunk += 1;
            aiInvocationCount += 1;
            aiDecision = await ctx.runAction(
              api.ai.agents.tradingAgent.makeAlphaArenaTradingDecision,
              {
                userId: args.userId,
                modelType: "openrouter",
                modelName: args.modelName,
                detailedMarketData: historicalMarketData,
                accountState,
                positions: backtestPositions,
                config: {
                  maxLeverage: args.maxLeverage,
                  maxPositionSize: normalizeMaxPositionSizePct(
                    args.maxPositionSize
                  ),
                  perTradeRiskPct: args.perTradeRiskPct,
                  maxTotalPositions: args.maxTotalPositions,
                  maxSameDirectionPositions: args.maxSameDirectionPositions,
                  minEntryConfidence: args.minEntryConfidence,
                  stopLossAtrMultiplier: args.stopLossAtrMultiplier,
                  minRiskRewardRatio: args.minRiskRewardRatio,
                  require4hAlignment: args.require4hAlignment,
                  tradeVolatileMarkets: args.tradeVolatileMarkets,
                  volatilitySizeReduction: args.volatilitySizeReduction,
                  tradingMode: args.tradingMode,
                  consecutiveLosses,
                  consecutiveLossLimit: args.consecutiveLossLimit,
                  enableRegimeFilter: args.enableRegimeFilter,
                  require1hAlignment: args.require1hAlignment,
                  redDayLongBlockPct: args.redDayLongBlockPct,
                  greenDayShortBlockPct: args.greenDayShortBlockPct,
                  managedExitEnabled: args.managedExitEnabled,
                },
              }
            );
          } else if (tradingPromptMode === "compact") {
            const coins = processAllCoins(historicalMarketData);
            const processedSignals = {
              timestamp: new Date(currentCandle.t).toISOString(),
              processingTimeMs: 0,
              coins,
              positions: evaluatePositions(backtestPositions, coins),
              overview: computeMarketOverview(coins),
            };
            aiCallsThisChunk += 1;
            aiInvocationCount += 1;
            aiDecision = await ctx.runAction(
              api.ai.agents.tradingAgent.makeCompactTradingDecision,
              {
                userId: args.userId,
                modelType: "openrouter",
                modelName: args.modelName,
                processedSignals,
                accountState,
                positions: backtestPositions,
                config: {
                  maxLeverage: args.maxLeverage,
                  maxPositionSize: normalizeMaxPositionSizePct(
                    args.maxPositionSize
                  ),
                  perTradeRiskPct: args.perTradeRiskPct,
                  maxTotalPositions: args.maxTotalPositions,
                  maxSameDirectionPositions: args.maxSameDirectionPositions,
                  minEntryConfidence: args.minEntryConfidence,
                  managedExitEnabled: args.managedExitEnabled,
                },
              }
            );
          } else {
            aiCallsThisChunk += 1;
            aiInvocationCount += 1;
            aiDecision = await ctx.runAction(
              api.ai.agents.tradingAgent.makeDetailedTradingDecision,
              {
                userId: args.userId,
                modelType: "openrouter",
                modelName: args.modelName,
                detailedMarketData: historicalMarketData,
                accountState,
                positions: backtestPositions,
                performanceMetrics,
                recentActionsOverride: [],
                config: {
                  maxLeverage: args.maxLeverage,
                  maxPositionSize: normalizeMaxPositionSizePct(
                    args.maxPositionSize
                  ),
                  maxDailyLoss: args.maxDailyLoss,
                  minAccountValue: args.minAccountValue,
                  perTradeRiskPct: args.perTradeRiskPct,
                  maxTotalPositions: args.maxTotalPositions,
                  maxSameDirectionPositions: args.maxSameDirectionPositions,
                  consecutiveLossLimit: args.consecutiveLossLimit,
                  tradingMode: args.tradingMode,
                  minEntryConfidence: args.minEntryConfidence,
                  minRiskRewardRatio: args.minRiskRewardRatio,
                  stopOutCooldownHours: args.stopOutCooldownHours,
                  minEntrySignals: args.minEntrySignals,
                  require4hAlignment: args.require4hAlignment,
                  tradeVolatileMarkets: args.tradeVolatileMarkets,
                  volatilitySizeReduction: args.volatilitySizeReduction,
                  stopLossAtrMultiplier: args.stopLossAtrMultiplier,
                  managedExitEnabled: args.managedExitEnabled,
                },
              }
            );
          }

          if (aiDecision && aiDecision.decision !== "HOLD") {
            const decisionSymbol =
              typeof aiDecision.symbol === "string" ? aiDecision.symbol : null;

            if (aiDecision.decision === "CLOSE") {
              if (!decisionSymbol) {
                candleIndex += args.stepSize;
                continue;
              }

              const positionToClose = currentPositions.find(
                (position) => position.symbol === decisionSymbol
              );
              if (!positionToClose) {
                candleIndex += args.stepSize;
                continue;
              }

              const positionView = backtestPositions.find(
                (position) => position.symbol === decisionSymbol
              );
              const hasTpSl = Boolean(
                positionToClose.stopLoss && positionToClose.takeProfit
              );
              const livePnlPct = positionView?.unrealizedPnlPct ?? 0;

              if (
                positionToClose.exitMode === MANAGED_EXIT_MODE ||
                (hasTpSl && livePnlPct < 0.5)
              ) {
                candleIndex += args.stepSize;
                continue;
              }

              const currentPrice =
                currentPrices[decisionSymbol] ?? positionToClose.entryPrice;
              const notional = positionToClose.size * positionToClose.leverage;
              const assetConfig = getAssetConfig(decisionSymbol);
              const exitSlippage = calculateSlippage(
                notional,
                assetConfig.liquidityTier
              );
              const exitPrice =
                positionToClose.side === "LONG"
                  ? currentPrice * (1 - exitSlippage)
                  : currentPrice * (1 + exitSlippage);

              await closePosition(
                positionToClose,
                exitPrice,
                currentCandle.t,
                "ai_close",
                aiDecision.confidence ?? positionToClose.confidence,
                aiDecision.reasoning ?? positionToClose.reasoning,
                { addFundingToExitTime: true }
              );

              candleIndex += args.stepSize;
              continue;
            }

            if (
              aiDecision.decision !== "OPEN_LONG" &&
              aiDecision.decision !== "OPEN_SHORT"
            ) {
              candleIndex += args.stepSize;
              continue;
            }

            if (!decisionSymbol || !historicalMarketData[decisionSymbol]) {
              candleIndex += args.stepSize;
              continue;
            }

            if (currentPositions.some((position) => position.symbol === decisionSymbol)) {
              candleIndex += args.stepSize;
              continue;
            }

            const requestedSide =
              aiDecision.decision === "OPEN_LONG" ? "LONG" : "SHORT";
            if (currentPositions.length >= args.maxTotalPositions) {
              candleIndex += args.stepSize;
              continue;
            }

            const sameDirectionCount = currentPositions.filter(
              (position) => position.side === requestedSide
            ).length;
            if (sameDirectionCount >= args.maxSameDirectionPositions) {
              candleIndex += args.stepSize;
              continue;
            }

            const lastTradeTimestamp = lastTradeTimestamps[decisionSymbol] ?? 0;
            if (
              lastTradeTimestamp > 0 &&
              currentCandle.t - lastTradeTimestamp <
                args.reentryCooldownMinutes * 60 * 1000
            ) {
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

            aiDecision.symbol = decisionSymbol;
            const trendValidation = await checkTrendGuard(
              aiDecision,
              args.userId,
              decisionContext
            );
            if (!trendValidation.allowed) {
              candleIndex += args.stepSize;
              continue;
            }

            const currentPrice = currentPrices[decisionSymbol];
            if (!currentPrice || currentPrice <= 0) {
              candleIndex += args.stepSize;
              continue;
            }

            const maxPositionSizePct = normalizeMaxPositionSizePct(
              args.maxPositionSize
            );
            const minPositionSizeUsd = Math.max(
              50,
              accountState.accountValue * 0.05
            );
            const maxPositionSizeUsd =
              accountState.accountValue * (maxPositionSizePct / 100);
            const positionSize = clamp(
              aiDecision.size_usd || maxPositionSizeUsd,
              minPositionSizeUsd,
              Math.max(minPositionSizeUsd, maxPositionSizeUsd)
            );

            const assetConfig = getAssetConfig(decisionSymbol);
            const effectiveLeverage = Math.min(
              Math.max(aiDecision.leverage || 5, 1),
              args.maxLeverage,
              assetConfig.maxLeverage
            );
            const side = requestedSide;
            const notional = positionSize * effectiveLeverage;
            const entrySlippage = calculateSlippage(
              notional,
              assetConfig.liquidityTier
            );
            const entryPrice =
              side === "LONG"
                ? currentPrice * (1 + entrySlippage)
                : currentPrice * (1 - entrySlippage);
            const entryFee = notional * TAKER_FEE_PCT;
            totalFees += entryFee;
            capital -= entryFee;
            updateDrawdown();

            let stopLoss = aiDecision.stop_loss;
            let takeProfit = aiDecision.take_profit;

            if (stopLoss && stopLoss < entryPrice * 0.1) {
              const pct = stopLoss <= 1 ? stopLoss : stopLoss / 100;
              stopLoss =
                side === "LONG"
                  ? entryPrice * (1 - pct)
                  : entryPrice * (1 + pct);
            }
            if (takeProfit && takeProfit < entryPrice * 0.1) {
              const pct = takeProfit <= 1 ? takeProfit : takeProfit / 100;
              takeProfit =
                side === "LONG"
                  ? entryPrice * (1 + pct)
                  : entryPrice * (1 - pct);
            }

            if (!stopLoss) {
              stopLoss =
                side === "LONG" ? entryPrice * 0.97 : entryPrice * 1.03;
            }
            if (
              (side === "LONG" && stopLoss >= entryPrice) ||
              (side === "SHORT" && stopLoss <= entryPrice)
            ) {
              stopLoss =
                side === "LONG" ? entryPrice * 0.97 : entryPrice * 1.03;
            }

            const managedExitRules = getManagedExitRules({
              managedExitEnabled: args.managedExitEnabled,
              managedExitHardStopLossPct: args.managedExitHardStopLossPct,
              managedExitBreakEvenTriggerPct:
                args.managedExitBreakEvenTriggerPct,
              managedExitBreakEvenLockProfitPct:
                args.managedExitBreakEvenLockProfitPct,
              managedExitTrailingTriggerPct: args.managedExitTrailingTriggerPct,
              managedExitTrailingDistancePct:
                args.managedExitTrailingDistancePct,
              managedExitTightenTriggerPct: args.managedExitTightenTriggerPct,
              managedExitTightenedDistancePct:
                args.managedExitTightenedDistancePct,
              managedExitStaleMinutes: args.managedExitStaleMinutes,
              managedExitStaleMinProfitPct: args.managedExitStaleMinProfitPct,
              managedExitMaxHoldMinutes: args.managedExitMaxHoldMinutes,
            });
            let exitMode: SimulatedPosition["exitMode"] = LEGACY_EXIT_MODE;
            let managedStopPrice: number | undefined;
            let managedPeakPrice: number | undefined;
            let managedStopReason: string | undefined;

            if (managedExitRules.managedExitEnabled) {
              const configuredHardStop = calculateHardStopPrice(
                entryPrice,
                side,
                managedExitRules.managedExitHardStopLossPct
              );
              stopLoss = clampManagedStop(side, stopLoss, configuredHardStop);
              takeProfit = undefined;
              exitMode = MANAGED_EXIT_MODE;
              managedStopPrice = stopLoss;
              managedPeakPrice = entryPrice;
              managedStopReason = "hard_stop";
            } else {
              if (!takeProfit) {
                takeProfit =
                  side === "LONG" ? entryPrice * 1.008 : entryPrice * 0.992;
              }
              if (
                (side === "LONG" && takeProfit <= entryPrice) ||
                (side === "SHORT" && takeProfit >= entryPrice)
              ) {
                takeProfit =
                  side === "LONG" ? entryPrice * 1.008 : entryPrice * 0.992;
              }
            }

            const currentPosition: SimulatedPosition = {
              symbol: decisionSymbol,
              side,
              entryPrice,
              size: positionSize,
              leverage: effectiveLeverage,
              stopLoss,
              takeProfit,
              liquidationPrice:
                entryPrice * (side === "LONG" ? 0.9 : 1.1),
              exitMode,
              managedPeakPrice,
              managedStopPrice,
              managedStopReason,
              entryTime: currentCandle.t,
              confidence: aiDecision.confidence || 0.5,
              reasoning: aiDecision.reasoning || "Backtest AI decision",
              lastFundingCheckTime: currentCandle.t,
              accumulatedFunding: 0,
            };
            currentPositions.push(currentPosition);
            lastTradeTimestamps[decisionSymbol] = currentCandle.t;

            await ctx.runMutation(
              internal.backtesting.backtestActions.saveBacktestTrade,
              {
                runId: args.runId,
                userId: args.userId,
                symbol: decisionSymbol,
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
            `[BACKTEST] AI call failed at ${new Date(
              currentCandle.t
            ).toISOString()}:`,
            aiError
          );
        }

        candleIndex += args.stepSize;
      }

      // If we exited the loop, we're done (all candles processed or capital depleted)
      // Close any remaining positions at end of period
      for (const position of [...currentPositions]) {
        const symbolCandles = periodCandlesBySymbol[position.symbol] ?? [];
        const lastCandle = capitalDepleted
          ? getLatestCandleAtOrBefore(symbolCandles, lastProcessedTime)
          : symbolCandles[symbolCandles.length - 1];
        if (!lastCandle) {
          continue;
        }

        const notional = position.size * position.leverage;
        const assetConfig = getAssetConfig(position.symbol);
        const exitSlippage = calculateSlippage(notional, assetConfig.liquidityTier);
        const exitPrice =
          position.side === "LONG"
            ? lastCandle.c * (1 - exitSlippage)
            : lastCandle.c * (1 + exitSlippage);

        await closePosition(
          position,
          exitPrice,
          lastCandle.t,
          "end_of_period",
          position.confidence,
          position.reasoning,
          { addFundingToExitTime: true }
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
      const diagnosticSummary =
        tradeCount === 0 && forcedHoldSteps > 0
          ? `No trades opened. Hybrid selection forced HOLD on ${forcedHoldSteps} evaluation step(s). Last reason: ${lastForcedHoldReason ?? "No valid hybrid candidates remained after deterministic filtering."}`
          : tradeCount === 0 && aiInvocationCount === 0
            ? "No trades opened and the model was never invoked during the evaluated window."
            : undefined;

      // Save results
      await ctx.runMutation(
        internal.backtesting.backtestActions.completeBacktestRun,
        {
          runId: args.runId,
          ...results,
          durationMs: Date.now() - args.startTime,
          aiInvocationCount,
          forcedHoldCount: forcedHoldSteps,
          diagnosticSummary,
        }
      );

      console.log(
        `[BACKTEST] Complete: ${tradeCount} trades, P&L: $${totalPnl.toFixed(2)} (${totalPnlPct.toFixed(1)}%), Win Rate: ${results.winRate.toFixed(1)}%, Fees: $${totalFees.toFixed(2)}, Funding: $${totalFunding.toFixed(2)}, Liquidations: ${liquidationCount}, AI calls: ${aiInvocationCount}, hybrid forced holds: ${forcedHoldSteps}`
      );
      if (diagnosticSummary) {
        console.log(`[BACKTEST] Diagnostic: ${diagnosticSummary}`);
      }
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
