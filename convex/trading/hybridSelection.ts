import type { DecisionContext } from "./decisionContext";
import { validateDecisionAgainstRegime } from "./validators/regimeValidator";
import { lastTradeBySymbol } from "./validators/positionValidator";
import {
  DEFAULT_HYBRID_SELECTION_RULES,
  resolveHybridSelectionRules,
  type HybridSelectionRules,
} from "./hybridSelectionConfig";

type HybridDirectionDecision = "OPEN_LONG" | "OPEN_SHORT";
type HybridSide = "LONG" | "SHORT";

export type HybridSelectionMode = "legacy_llm" | "hybrid_llm_ranked";

export interface HybridScoreBreakdown {
  intradayAlignment: number;
  hourlyAlignment: number;
  fourHourAlignment: number;
  sessionAlignment: number;
  volatilityQuality: number;
  rsiContext: number;
  volumeQuality: number;
  momentumPenalty: number;
  total: number;
}

export interface HybridExecutionPlan {
  sizeUsd: number;
  leverage: number;
  leverageBand: {
    min: number;
    max: number;
  };
  stopLoss: number;
  takeProfit: number;
  invalidationCondition: string;
  riskRewardRatio: number;
}

export interface HybridCandidateSnapshot {
  currentPrice: number;
  dayChangePct: number;
  intradayMomentum: string;
  intradayTrend: string;
  hourlyTrend: string;
  fourHourTrend: string;
  priceVsEma20Pct: number;
  ema20VsEma50Pct4h: number;
  rsi7: number;
  volumeRatio: number;
}

export interface HybridCandidate {
  id: string;
  symbol: string;
  decision: HybridDirectionDecision;
  score: number;
  allowed: boolean;
  blockReason?: string;
  scoreBreakdown: HybridScoreBreakdown;
  snapshot: HybridCandidateSnapshot;
  executionPlan: HybridExecutionPlan;
}

export interface HybridCloseCandidate {
  id: string;
  symbol: string;
  side: HybridSide;
  allowed: boolean;
  reason: string;
  unrealizedPnlPct: number;
  hasTpSl: boolean;
  intradayMomentum: string;
}

export interface HybridCandidateSet {
  selectionMode: "hybrid_llm_ranked";
  generatedAt: string;
  scoreFloor: number;
  forcedHold: boolean;
  holdReason?: string;
  candidates: HybridCandidate[];
  blockedCandidates: HybridCandidate[];
  topCandidates: HybridCandidate[];
  closeCandidates: HybridCloseCandidate[];
}

export interface HybridSelectionConfig {
  maxLeverage: number;
  maxPositionSize: number;
  perTradeRiskPct?: number;
  maxTotalPositions?: number;
  maxSameDirectionPositions?: number;
  minRiskRewardRatio?: number;
  stopLossAtrMultiplier?: number;
  reentryCooldownMinutes?: number;
  enableRegimeFilter?: boolean;
  require1hAlignment?: boolean;
  redDayLongBlockPct?: number;
  greenDayShortBlockPct?: number;
  hybridScoreFloor?: number;
  hybridFourHourTrendThresholdPct?: number;
  hybridExtremeRsi7Block?: number;
  hybridMinChopVolumeRatio?: number;
  hybridChopDistanceFromEmaPct?: number;
}

export interface BuildHybridCandidateSetArgs {
  decisionContext: DecisionContext;
  accountState: {
    accountValue: number;
    withdrawable: number;
  };
  positions: Array<{
    symbol: string;
    side: HybridSide;
    stopLoss?: number | null;
    takeProfit?: number | null;
    unrealizedPnlPct?: number | null;
    exitMode?: string | null;
  }>;
  openOrders?: Array<{ coin: string }>;
  recentTrades?: Array<{
    symbol: string;
    executedAt: number;
    action?: string;
  }>;
  config: HybridSelectionConfig;
  allowedSymbols?: string[];
  testnet?: boolean;
  now?: number;
  scoreFloor?: number;
}

function isSymbolSupported(symbol: string, testnet: boolean): boolean {
  if (!testnet) return true;
  return symbol !== "XRP";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toCandidateId(symbol: string, decision: HybridDirectionDecision): string {
  return `${symbol}_${decision}`.toLowerCase();
}

function toCloseId(symbol: string): string {
  return `close_${symbol}`.toLowerCase();
}

function buildSnapshotSummary(snapshot: DecisionContext["marketSnapshot"]["symbols"][string]): HybridCandidateSnapshot {
  return {
    currentPrice: snapshot.currentPrice,
    dayChangePct: snapshot.dayChangePct,
    intradayMomentum: snapshot.intraday.momentum,
    intradayTrend: snapshot.intraday.trendDirection,
    hourlyTrend: snapshot.hourly.trendDirection,
    fourHourTrend: snapshot.fourHour.trendDirection,
    priceVsEma20Pct: snapshot.intraday.priceVsEma20Pct,
    ema20VsEma50Pct4h: snapshot.fourHour.ema20VsEma50Pct,
    rsi7: snapshot.intraday.rsi7,
    volumeRatio: snapshot.fourHour.volumeRatio,
  };
}

function getHourlyEmaGapPct(snapshot: DecisionContext["marketSnapshot"]["symbols"][string]): number {
  const hourlyEma50 = snapshot.hourly.ema50;
  if (!hourlyEma50) return 0;
  return ((snapshot.hourly.ema20 - hourlyEma50) / hourlyEma50) * 100;
}

export function validateHybridCandidateContext(
  snapshot: DecisionContext["marketSnapshot"]["symbols"][string],
  decision: HybridDirectionDecision,
  rules: HybridSelectionRules
): { allowed: boolean; reason: string } {
  const isLong = decision === "OPEN_LONG";
  const hourlyEmaGapPct = getHourlyEmaGapPct(snapshot);
  const fourHourTrendPct = snapshot.fourHour.ema20VsEma50Pct;
  const priceVsEma20Pct = snapshot.intraday.priceVsEma20Pct;
  const volumeRatio = snapshot.fourHour.volumeRatio;
  const momentum = snapshot.intraday.momentum;
  const rsi7 = snapshot.intraday.rsi7;
  const notDirectionallyAligned = isLong ? hourlyEmaGapPct <= 0 : hourlyEmaGapPct >= 0;
  const fourHourCounterTrend = isLong
    ? fourHourTrendPct <= -rules.hybridFourHourTrendThresholdPct
    : fourHourTrendPct >= rules.hybridFourHourTrendThresholdPct;

  if (fourHourCounterTrend && notDirectionallyAligned) {
    return {
      allowed: false,
      reason: isLong
        ? `Hybrid long blocked: 4h EMA gap is ${fourHourTrendPct.toFixed(2)}% bearish and 1h is not bullish.`
        : `Hybrid short blocked: 4h EMA gap is ${fourHourTrendPct.toFixed(2)}% bullish and 1h is not bearish.`,
    };
  }

  if (momentum === "FLAT" &&
    Math.abs(priceVsEma20Pct) < rules.hybridChopDistanceFromEmaPct &&
    volumeRatio < rules.hybridMinChopVolumeRatio) {
    return {
      allowed: false,
      reason: `Hybrid ${isLong ? "long" : "short"} blocked: flat low-volume chop (${volumeRatio.toFixed(2)}x volume, ${priceVsEma20Pct.toFixed(2)}% from EMA20).`,
    };
  }

  if (isLong && rsi7 >= 100 - rules.hybridExtremeRsi7Block) {
    return {
      allowed: false,
      reason: `Hybrid long blocked: RSI7 ${rsi7.toFixed(1)} is too overbought.`,
    };
  }

  if (!isLong && rsi7 <= rules.hybridExtremeRsi7Block) {
    return {
      allowed: false,
      reason: `Hybrid short blocked: RSI7 ${rsi7.toFixed(1)} is too oversold.`,
    };
  }

  return {
    allowed: true,
    reason: "Hybrid context checks passed.",
  };
}

function calculateLeverageBand(atrPct: number, maxLeverage: number): { min: number; max: number } {
  if (atrPct < 1) {
    return {
      min: Math.min(5, maxLeverage),
      max: Math.min(Math.max(5, maxLeverage), maxLeverage),
    };
  }
  if (atrPct < 2.5) {
    return {
      min: Math.min(3, maxLeverage),
      max: Math.min(5, maxLeverage),
    };
  }
  return {
    min: Math.min(2, maxLeverage),
    max: Math.min(3, maxLeverage),
  };
}

function buildExecutionPlan(
  snapshot: DecisionContext["marketSnapshot"]["symbols"][string],
  decision: HybridDirectionDecision,
  accountState: BuildHybridCandidateSetArgs["accountState"],
  config: HybridSelectionConfig
): HybridExecutionPlan {
  const riskPct = config.perTradeRiskPct ?? 2;
  const rrRatio = config.minRiskRewardRatio ?? 2;
  const slAtrMultiplier = config.stopLossAtrMultiplier ?? 1.5;
  const atr = snapshot.fourHour.atr14;
  const currentPrice = snapshot.currentPrice;
  const isLong = decision === "OPEN_LONG";
  const stopLoss = isLong
    ? currentPrice - atr * slAtrMultiplier
    : currentPrice + atr * slAtrMultiplier;
  const takeProfit = isLong
    ? currentPrice + atr * slAtrMultiplier * rrRatio
    : currentPrice - atr * slAtrMultiplier * rrRatio;
  const stopDistancePct = currentPrice > 0 ? Math.abs(currentPrice - stopLoss) / currentPrice : 0.015;
  const rawSizeUsd = stopDistancePct > 0
    ? (accountState.withdrawable * (riskPct / 100)) / stopDistancePct
    : accountState.withdrawable * 0.1;
  const minimumPositionSize = Math.max(50, accountState.accountValue * 0.05);
  const maxPositionSizeUsd = accountState.accountValue * ((config.maxPositionSize <= 1 ? config.maxPositionSize * 100 : config.maxPositionSize) / 100);
  const atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
  const leverageBand = calculateLeverageBand(atrPct, config.maxLeverage);
  const leverage = clamp(
    Math.round((leverageBand.min + leverageBand.max) / 2),
    1,
    config.maxLeverage
  );

  return {
    sizeUsd: clamp(rawSizeUsd, minimumPositionSize, Math.max(minimumPositionSize, maxPositionSizeUsd)),
    leverage,
    leverageBand,
    stopLoss,
    takeProfit,
    invalidationCondition: isLong
      ? "Thesis invalid if price loses EMA20 support and 1h alignment remains bearish."
      : "Thesis invalid if price reclaims EMA20 and 1h alignment remains bullish.",
    riskRewardRatio: rrRatio,
  };
}

export function calculateCandidateScore(
  snapshot: DecisionContext["marketSnapshot"]["symbols"][string],
  decision: HybridDirectionDecision
): HybridScoreBreakdown {
  const isLong = decision === "OPEN_LONG";
  const priceVsEma20Pct = snapshot.intraday.priceVsEma20Pct;
  const ema20VsEma50Pct4h = snapshot.fourHour.ema20VsEma50Pct;
  const momentum = snapshot.intraday.momentum;
  const hourlyEmaGapPct = getHourlyEmaGapPct(snapshot);
  const dayChangePct = snapshot.dayChangePct;
  const atrPct = snapshot.currentPrice > 0 ? (snapshot.fourHour.atr14 / snapshot.currentPrice) * 100 : 0;
  const rsi7 = snapshot.intraday.rsi7;
  const volumeRatio = snapshot.fourHour.volumeRatio;
  const directionalPriceVsEma = (isLong ? 1 : -1) * priceVsEma20Pct;
  const directionalHourlyGapPct = (isLong ? 1 : -1) * hourlyEmaGapPct;
  const directionalFourHourGapPct = (isLong ? 1 : -1) * ema20VsEma50Pct4h;
  const directionalSessionPct = (isLong ? 1 : -1) * dayChangePct;

  const intradayAlignment = clamp(directionalPriceVsEma * 18, -12, 12);

  const hourlyAlignment = clamp(directionalHourlyGapPct * 20, -10, 20);

  const fourHourAlignment = clamp(directionalFourHourGapPct * 12, -12, 18);

  const sessionAlignment = clamp(directionalSessionPct * 4, -6, 6);

  const volatilityQuality = atrPct < 1
    ? 6
    : atrPct < 2.5
      ? 10
      : 7;

  const rsiContext = rsi7 >= 40 && rsi7 <= 60
    ? 5
    : (rsi7 >= 35 && rsi7 < 40) || (rsi7 > 60 && rsi7 <= 65)
      ? 2
      : (rsi7 >= 25 && rsi7 < 35) || (rsi7 > 65 && rsi7 <= 75)
        ? -2
        : -8;

  const volumeQuality = clamp((volumeRatio - 0.9) * 10, -6, 6);

  const momentumPenalty = isLong
    ? momentum === "RISING" ? 0 : momentum === "FLAT" ? -4 : -12
    : momentum === "FALLING" ? 0 : momentum === "FLAT" ? -4 : -12;

  const total = clamp(
    intradayAlignment +
      hourlyAlignment +
      fourHourAlignment +
      sessionAlignment +
      volatilityQuality +
      rsiContext +
      volumeQuality +
      momentumPenalty,
    0,
    100
  );

  return {
    intradayAlignment,
    hourlyAlignment,
    fourHourAlignment,
    sessionAlignment,
    volatilityQuality,
    rsiContext,
    volumeQuality,
    momentumPenalty,
    total,
  };
}

function buildBlockedCandidate(
  symbol: string,
  decision: HybridDirectionDecision,
  snapshot: DecisionContext["marketSnapshot"]["symbols"][string],
  executionPlan: HybridExecutionPlan,
  blockReason: string
): HybridCandidate {
  return {
    id: toCandidateId(symbol, decision),
    symbol,
    decision,
    score: 0,
    allowed: false,
    blockReason,
    scoreBreakdown: {
      intradayAlignment: 0,
      hourlyAlignment: 0,
      fourHourAlignment: 0,
      sessionAlignment: 0,
      volatilityQuality: 0,
      rsiContext: 0,
      volumeQuality: 0,
      momentumPenalty: 0,
      total: 0,
    },
    snapshot: buildSnapshotSummary(snapshot),
    executionPlan,
  };
}

function isCloseCandidateEligible(
  position: BuildHybridCandidateSetArgs["positions"][number],
  snapshot: DecisionContext["marketSnapshot"]["symbols"][string]
): { allowed: boolean; reason: string } {
  if (position.exitMode === "managed_scalp_v2") {
    return {
      allowed: false,
      reason: "Managed exit position is controlled by system rules.",
    };
  }

  const hasTpSl = Boolean(position.stopLoss && position.takeProfit);
  if (!hasTpSl) {
    return {
      allowed: true,
      reason: "TP/SL missing on live position.",
    };
  }

  const pnlPct = position.unrealizedPnlPct ?? 0;
  const momentum = snapshot.intraday.momentum;
  const reversal =
    (position.side === "LONG" && momentum === "FALLING") ||
    (position.side === "SHORT" && momentum === "RISING");

  if (pnlPct >= 1 && reversal) {
    return {
      allowed: true,
      reason: `Position is profitable (${pnlPct.toFixed(2)}%) and intraday momentum is reversing.`,
    };
  }

  return {
    allowed: false,
    reason: "No close signal: position is not sufficiently profitable or momentum is not reversing.",
  };
}

export function buildHybridCandidateSet(args: BuildHybridCandidateSetArgs): HybridCandidateSet {
  const generatedAt = new Date().toISOString();
  const now = args.now ?? Date.now();
  const hybridRules = resolveHybridSelectionRules(args.config);
  const scoreFloor = args.scoreFloor ?? hybridRules.hybridScoreFloor ?? DEFAULT_HYBRID_SELECTION_RULES.hybridScoreFloor;
  const recentTrades = args.recentTrades ?? [];
  const openOrderSymbols = new Set((args.openOrders ?? []).map((order) => order.coin));
  const positionsBySymbol = new Map(args.positions.map((position) => [position.symbol, position]));
  const allowedSymbols = new Set(args.allowedSymbols ?? Object.keys(args.decisionContext.marketSnapshot.symbols));
  const cooldownMs = (args.config.reentryCooldownMinutes ?? 15) * 60 * 1000;

  const validCandidates: HybridCandidate[] = [];
  const blockedCandidates: HybridCandidate[] = [];

  for (const [symbol, snapshot] of Object.entries(args.decisionContext.marketSnapshot.symbols)) {
    if (!allowedSymbols.has(symbol)) continue;

    for (const decision of ["OPEN_LONG", "OPEN_SHORT"] as const) {
      const requestedSide: HybridSide = decision === "OPEN_LONG" ? "LONG" : "SHORT";
      const executionPlan = buildExecutionPlan(snapshot, decision, args.accountState, args.config);

      if (!isSymbolSupported(symbol, args.testnet ?? false)) {
        blockedCandidates.push(
          buildBlockedCandidate(symbol, decision, snapshot, executionPlan, "Unsupported symbol in current environment.")
        );
        continue;
      }

      if (positionsBySymbol.has(symbol)) {
        blockedCandidates.push(
          buildBlockedCandidate(symbol, decision, snapshot, executionPlan, "Existing open position on this symbol.")
        );
        continue;
      }

      if (openOrderSymbols.has(symbol)) {
        blockedCandidates.push(
          buildBlockedCandidate(symbol, decision, snapshot, executionPlan, "Pending open order already exists on this symbol.")
        );
        continue;
      }

      const maxTotalPositions = args.config.maxTotalPositions ?? 3;
      if (args.positions.length >= maxTotalPositions) {
        blockedCandidates.push(
          buildBlockedCandidate(symbol, decision, snapshot, executionPlan, `Max total positions reached (${args.positions.length}/${maxTotalPositions}).`)
        );
        continue;
      }

      const maxSameDirectionPositions = args.config.maxSameDirectionPositions ?? 2;
      const sameDirectionCount = args.positions.filter((position) => position.side === requestedSide).length;
      if (sameDirectionCount >= maxSameDirectionPositions) {
        blockedCandidates.push(
          buildBlockedCandidate(symbol, decision, snapshot, executionPlan, `Same-direction exposure limit reached (${sameDirectionCount}/${maxSameDirectionPositions} ${requestedSide}).`)
        );
        continue;
      }

      const symbolKey = `${symbol}-${requestedSide}`;
      const inMemoryTrade = lastTradeBySymbol[symbolKey];
      if (inMemoryTrade && now - inMemoryTrade.time < 60_000) {
        const secondsAgo = Math.floor((now - inMemoryTrade.time) / 1000);
        blockedCandidates.push(
          buildBlockedCandidate(symbol, decision, snapshot, executionPlan, `Duplicate guard active (${secondsAgo}s since same-side open).`)
        );
        continue;
      }

      const cooldownTrade = recentTrades.find((trade) =>
        trade.symbol === symbol && trade.executedAt > now - cooldownMs
      );
      if (cooldownTrade) {
        const minutesAgo = Math.max(1, Math.floor((now - cooldownTrade.executedAt) / 60_000));
        blockedCandidates.push(
          buildBlockedCandidate(symbol, decision, snapshot, executionPlan, `Re-entry cooldown active (${minutesAgo}m ago).`)
        );
        continue;
      }

      const regimeDecision = {
        decision,
        symbol,
      };
      const regimeValidation = validateDecisionAgainstRegime(args.config, regimeDecision, args.decisionContext);
      if (!regimeValidation.allowed) {
        blockedCandidates.push(
          buildBlockedCandidate(symbol, decision, snapshot, executionPlan, regimeValidation.reason)
        );
        continue;
      }

      const hybridValidation = validateHybridCandidateContext(snapshot, decision, hybridRules);
      if (!hybridValidation.allowed) {
        blockedCandidates.push(
          buildBlockedCandidate(symbol, decision, snapshot, executionPlan, hybridValidation.reason)
        );
        continue;
      }

      const scoreBreakdown = calculateCandidateScore(snapshot, decision);
      validCandidates.push({
        id: toCandidateId(symbol, decision),
        symbol,
        decision,
        score: scoreBreakdown.total,
        allowed: true,
        scoreBreakdown,
        snapshot: buildSnapshotSummary(snapshot),
        executionPlan,
      });
    }
  }

  validCandidates.sort((a, b) => b.score - a.score);
  const topCandidates = validCandidates.slice(0, 3);

  const closeCandidates: HybridCloseCandidate[] = args.positions
    .map((position) => {
      const snapshot = args.decisionContext.marketSnapshot.symbols[position.symbol];
      if (!snapshot) {
        return {
          id: toCloseId(position.symbol),
          symbol: position.symbol,
          side: position.side,
          allowed: false,
          reason: "No market snapshot available for open position.",
          unrealizedPnlPct: position.unrealizedPnlPct ?? 0,
          hasTpSl: Boolean(position.stopLoss && position.takeProfit),
          intradayMomentum: "UNKNOWN",
        };
      }

      const eligibility = isCloseCandidateEligible(position, snapshot);
      return {
        id: toCloseId(position.symbol),
        symbol: position.symbol,
        side: position.side,
        allowed: eligibility.allowed,
        reason: eligibility.reason,
        unrealizedPnlPct: position.unrealizedPnlPct ?? 0,
        hasTpSl: Boolean(position.stopLoss && position.takeProfit),
        intradayMomentum: snapshot.intraday.momentum,
      };
    })
    .filter((candidate) => candidate.allowed);

  const forcedHold = topCandidates.length === 0 || (topCandidates[0].score < scoreFloor && closeCandidates.length === 0);
  const holdReason = topCandidates.length === 0
    ? "No valid open candidates remain after deterministic filtering."
    : topCandidates[0].score < scoreFloor
      ? `Best deterministic setup scored ${topCandidates[0].score.toFixed(1)} below the ${scoreFloor} floor.`
      : undefined;

  return {
    selectionMode: "hybrid_llm_ranked",
    generatedAt,
    scoreFloor,
    forcedHold,
    holdReason,
    candidates: validCandidates,
    blockedCandidates,
    topCandidates,
    closeCandidates,
  };
}

export function buildHybridHoldDecision(reasoning: string) {
  return {
    decision: "HOLD" as const,
    symbol: null,
    confidence: 0.9,
    reasoning,
  };
}
