import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHybridCandidateSet,
  calculateCandidateScore,
  validateHybridCandidateContext,
} from "./hybridSelection";
import { DEFAULT_HYBRID_SELECTION_RULES } from "./hybridSelectionConfig";

function makeSnapshot(overrides: Record<string, any> = {}) {
  const base = {
    currentPrice: 100,
    dayChangePct: 0,
    intraday: {
      ema20: 100,
      priceVsEma20Pct: 0,
      momentum: "FLAT",
      trendDirection: "NEUTRAL",
      rsi7: 50,
      rsi14: 50,
    },
    hourly: {
      ema20: 100,
      ema50: 100,
      trendDirection: "NEUTRAL",
    },
    fourHour: {
      ema20: 100,
      ema50: 100,
      ema20VsEma50Pct: 0,
      atr14: 1.5,
      volumeRatio: 1,
      trendDirection: "NEUTRAL",
    },
  };

  return {
    ...base,
    ...overrides,
    intraday: {
      ...base.intraday,
      ...(overrides.intraday ?? {}),
    },
    hourly: {
      ...base.hourly,
      ...(overrides.hourly ?? {}),
    },
    fourHour: {
      ...base.fourHour,
      ...(overrides.fourHour ?? {}),
    },
  };
}

function makeDecisionContext(symbols: Record<string, any>) {
  return {
    marketSnapshot: { symbols },
    marketSnapshotSummary: { generatedAt: new Date().toISOString(), symbols: {} },
  } as any;
}

function makeBaseArgs(decisionContext: any, overrides: Record<string, any> = {}) {
  return {
    decisionContext,
    accountState: {
      accountValue: 1000,
      withdrawable: 1000,
    },
    positions: [],
    config: {
      maxLeverage: 5,
      maxPositionSize: 10,
      enableRegimeFilter: false,
      require1hAlignment: true,
    },
    allowedSymbols: Object.keys(decisionContext.marketSnapshot.symbols),
    testnet: false,
    now: 0,
    ...overrides,
  };
}

test("blocks bullish 4h short when 1h is not bearish", () => {
  const result = validateHybridCandidateContext(
    makeSnapshot({
      hourly: { ema20: 100.3, ema50: 100 },
      fourHour: { ema20VsEma50Pct: 1.1 },
    }) as any,
    "OPEN_SHORT",
    DEFAULT_HYBRID_SELECTION_RULES
  );

  assert.equal(result.allowed, false);
  assert.match(result.reason, /4h EMA gap/i);
});

test("blocks bearish 4h long when 1h is not bullish", () => {
  const result = validateHybridCandidateContext(
    makeSnapshot({
      hourly: { ema20: 99.7, ema50: 100 },
      fourHour: { ema20VsEma50Pct: -1.1 },
    }) as any,
    "OPEN_LONG",
    DEFAULT_HYBRID_SELECTION_RULES
  );

  assert.equal(result.allowed, false);
  assert.match(result.reason, /1h is not bullish/i);
});

test("blocks flat low-volume chop equally for both directions", () => {
  const snapshot = makeSnapshot({
    intraday: { priceVsEma20Pct: 0.08, momentum: "FLAT" },
    fourHour: { volumeRatio: 0.55 },
  }) as any;

  const longResult = validateHybridCandidateContext(snapshot, "OPEN_LONG", DEFAULT_HYBRID_SELECTION_RULES);
  const shortResult = validateHybridCandidateContext(snapshot, "OPEN_SHORT", DEFAULT_HYBRID_SELECTION_RULES);

  assert.equal(longResult.allowed, false);
  assert.equal(shortResult.allowed, false);
  assert.match(longResult.reason, /flat low-volume chop/i);
  assert.match(shortResult.reason, /flat low-volume chop/i);
});

test("strong session day bypasses the chop filter", () => {
  const result = validateHybridCandidateContext(
    makeSnapshot({
      dayChangePct: 2.2,
      intraday: { priceVsEma20Pct: 0.08, momentum: "FLAT" },
      fourHour: { volumeRatio: 0.34 },
    }) as any,
    "OPEN_LONG",
    DEFAULT_HYBRID_SELECTION_RULES
  );

  assert.equal(result.allowed, true);
});

test("continuation long with elevated RSI is allowed when 1h or 4h still supports direction", () => {
  const result = validateHybridCandidateContext(
    makeSnapshot({
      intraday: { rsi7: 80 },
      hourly: { ema20: 100.6, ema50: 100 },
      fourHour: { ema20VsEma50Pct: 0.2 },
    }) as any,
    "OPEN_LONG",
    DEFAULT_HYBRID_SELECTION_RULES
  );

  assert.equal(result.allowed, true);
});

test("unsupported elevated RSI still blocks continuation longs", () => {
  const result = validateHybridCandidateContext(
    makeSnapshot({
      intraday: { rsi7: 80 },
      hourly: { ema20: 99.9, ema50: 100 },
      fourHour: { ema20VsEma50Pct: -0.1 },
    }) as any,
    "OPEN_LONG",
    DEFAULT_HYBRID_SELECTION_RULES
  );

  assert.equal(result.allowed, false);
  assert.match(result.reason, /without bullish 1h or 4h support/i);
});

test("absolute RSI extremes still block even with directional support", () => {
  const result = validateHybridCandidateContext(
    makeSnapshot({
      intraday: { rsi7: 93 },
      hourly: { ema20: 100.7, ema50: 100 },
      fourHour: { ema20VsEma50Pct: 0.8 },
    }) as any,
    "OPEN_LONG",
    DEFAULT_HYBRID_SELECTION_RULES
  );

  assert.equal(result.allowed, false);
  assert.match(result.reason, /unsustainably extreme/i);
});

test("mirrored long and short snapshots receive mirrored scores", () => {
  const longScore = calculateCandidateScore(
    makeSnapshot({
      dayChangePct: -0.6,
      intraday: { priceVsEma20Pct: -0.35, momentum: "FLAT", rsi7: 42 },
      hourly: { ema20: 101, ema50: 100 },
      fourHour: { ema20VsEma50Pct: 1.1, volumeRatio: 1.3 },
    }) as any,
    "OPEN_LONG"
  );
  const shortScore = calculateCandidateScore(
    makeSnapshot({
      dayChangePct: 0.6,
      intraday: { priceVsEma20Pct: 0.35, momentum: "FLAT", rsi7: 58 },
      hourly: { ema20: 99, ema50: 100 },
      fourHour: { ema20VsEma50Pct: -1.1, volumeRatio: 1.3 },
    }) as any,
    "OPEN_SHORT"
  );

  assert.equal(longScore.intradayAlignment, shortScore.intradayAlignment);
  assert.equal(longScore.hourlyAlignment, shortScore.hourlyAlignment);
  assert.equal(longScore.fourHourAlignment, shortScore.fourHourAlignment);
  assert.equal(longScore.sessionAlignment, shortScore.sessionAlignment);
  assert.equal(longScore.rsiContext, shortScore.rsiContext);
  assert.equal(longScore.volumeQuality, shortScore.volumeQuality);
  assert.equal(longScore.momentumPenalty, shortScore.momentumPenalty);
  assert.equal(longScore.total, shortScore.total);
});

test("flat momentum scores worse than aligned momentum", () => {
  const falling = calculateCandidateScore(
    makeSnapshot({
      intraday: { priceVsEma20Pct: 0.4, momentum: "FALLING", rsi7: 58 },
      hourly: { ema20: 99, ema50: 100 },
      fourHour: { ema20VsEma50Pct: -0.8, volumeRatio: 1.1 },
    }) as any,
    "OPEN_SHORT"
  );
  const flat = calculateCandidateScore(
    makeSnapshot({
      intraday: { priceVsEma20Pct: 0.4, momentum: "FLAT", rsi7: 58 },
      hourly: { ema20: 99, ema50: 100 },
      fourHour: { ema20VsEma50Pct: -0.8, volumeRatio: 1.1 },
    }) as any,
    "OPEN_SHORT"
  );

  assert.ok(flat.total < falling.total);
  assert.equal(flat.momentumPenalty, -1);
  assert.equal(falling.momentumPenalty, 0);
});

test("counter-momentum penalty is reduced to -3", () => {
  const score = calculateCandidateScore(
    makeSnapshot({
      intraday: { priceVsEma20Pct: 0.4, momentum: "RISING", rsi7: 58 },
      hourly: { ema20: 99, ema50: 100 },
      fourHour: { ema20VsEma50Pct: -0.8, volumeRatio: 1.1 },
    }) as any,
    "OPEN_SHORT"
  );

  assert.equal(score.momentumPenalty, -3);
});

test("directional pullbacks score better than stretched continuation entries", () => {
  const pullbackLong = calculateCandidateScore(
    makeSnapshot({
      dayChangePct: -0.4,
      intraday: { priceVsEma20Pct: -0.25, momentum: "FLAT", rsi7: 41 },
      hourly: { ema20: 101, ema50: 100 },
      fourHour: { ema20VsEma50Pct: 0.9, volumeRatio: 1.2 },
    }) as any,
    "OPEN_LONG"
  );
  const chaseLong = calculateCandidateScore(
    makeSnapshot({
      dayChangePct: 2.4,
      intraday: { priceVsEma20Pct: 0.95, momentum: "RISING", rsi7: 72 },
      hourly: { ema20: 101, ema50: 100 },
      fourHour: { ema20VsEma50Pct: 0.9, volumeRatio: 1.2 },
    }) as any,
    "OPEN_LONG"
  );

  assert.ok(pullbackLong.total > chaseLong.total);
  assert.ok(pullbackLong.intradayAlignment > chaseLong.intradayAlignment);
  assert.ok(pullbackLong.rsiContext > chaseLong.rsiContext);
});

test("short bounces score better than already-extended downside entries", () => {
  const bounceShort = calculateCandidateScore(
    makeSnapshot({
      dayChangePct: 0.4,
      intraday: { priceVsEma20Pct: 0.25, momentum: "FLAT", rsi7: 59 },
      hourly: { ema20: 99, ema50: 100 },
      fourHour: { ema20VsEma50Pct: -0.9, volumeRatio: 1.2 },
    }) as any,
    "OPEN_SHORT"
  );
  const chaseShort = calculateCandidateScore(
    makeSnapshot({
      dayChangePct: -2.4,
      intraday: { priceVsEma20Pct: -0.95, momentum: "FALLING", rsi7: 28 },
      hourly: { ema20: 99, ema50: 100 },
      fourHour: { ema20VsEma50Pct: -0.9, volumeRatio: 1.2 },
    }) as any,
    "OPEN_SHORT"
  );

  assert.ok(bounceShort.total > chaseShort.total);
  assert.ok(bounceShort.intradayAlignment > chaseShort.intradayAlignment);
  assert.ok(bounceShort.rsiContext > chaseShort.rsiContext);
});

test("non-empty shortlists below the score floor no longer force hold", () => {
  const decisionContext = makeDecisionContext({
    BTC: makeSnapshot({
      dayChangePct: 4.3,
      intraday: { priceVsEma20Pct: 0.54, momentum: "FLAT", rsi7: 63.3 },
      hourly: { ema20: 101, ema50: 100 },
      fourHour: { ema20VsEma50Pct: 0.3, volumeRatio: 1.7, atr14: 2.6 },
    }),
  });

  const candidateSet = buildHybridCandidateSet(
    makeBaseArgs(decisionContext, {
      scoreFloor: 55,
    }) as any
  );

  assert.equal(candidateSet.topCandidates.length > 0, true);
  assert.equal(candidateSet.forcedHold, false);
  assert.equal(candidateSet.belowScoreFloor, true);
  assert.equal(candidateSet.scoreGapToFloor > 0, true);
});

test("empty shortlists still force hold", () => {
  const decisionContext = makeDecisionContext({
    XRP: makeSnapshot({
      dayChangePct: 2.5,
      intraday: { priceVsEma20Pct: 0.6, momentum: "RISING", rsi7: 52 },
      hourly: { ema20: 101, ema50: 100 },
      fourHour: { ema20VsEma50Pct: 0.8, volumeRatio: 1.2 },
    }),
  });

  const candidateSet = buildHybridCandidateSet(
    makeBaseArgs(decisionContext, {
      allowedSymbols: ["XRP"],
      testnet: true,
    }) as any
  );

  assert.equal(candidateSet.forcedHold, true);
  assert.equal(candidateSet.holdReason, "No valid open candidates remain after deterministic filtering.");
  assert.equal(candidateSet.topCandidates.length, 0);
});

test("default hybrid rules and explicit rule config produce the same candidate set", () => {
  const decisionContext = makeDecisionContext({
    BTC: makeSnapshot({
      dayChangePct: -0.2,
      intraday: { priceVsEma20Pct: -0.45, momentum: "FALLING", rsi7: 48 },
      hourly: { ema20: 99.2, ema50: 100 },
      fourHour: { ema20VsEma50Pct: -0.9, volumeRatio: 1.25 },
    }),
  });

  const baseArgs = makeBaseArgs(decisionContext, {
    config: {
      maxLeverage: 5,
      maxPositionSize: 10,
      enableRegimeFilter: true,
      require1hAlignment: true,
    },
  });

  const implicit = buildHybridCandidateSet(baseArgs as any);
  const explicit = buildHybridCandidateSet({
    ...baseArgs,
    config: {
      ...baseArgs.config,
      ...DEFAULT_HYBRID_SELECTION_RULES,
    },
  } as any);

  assert.deepEqual(
    {
      forcedHold: implicit.forcedHold,
      holdReason: implicit.holdReason,
      belowScoreFloor: implicit.belowScoreFloor,
      scoreGapToFloor: implicit.scoreGapToFloor,
      topCandidates: implicit.topCandidates.map((candidate) => ({
        id: candidate.id,
        score: candidate.score,
      })),
      blockedCount: implicit.blockedCandidates.length,
    },
    {
      forcedHold: explicit.forcedHold,
      holdReason: explicit.holdReason,
      belowScoreFloor: explicit.belowScoreFloor,
      scoreGapToFloor: explicit.scoreGapToFloor,
      topCandidates: explicit.topCandidates.map((candidate) => ({
        id: candidate.id,
        score: candidate.score,
      })),
      blockedCount: explicit.blockedCandidates.length,
    }
  );
});
