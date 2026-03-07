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

test("mirrored long and short snapshots receive mirrored scores", () => {
  const longScore = calculateCandidateScore(
    makeSnapshot({
      dayChangePct: 1.2,
      intraday: { priceVsEma20Pct: 0.8, momentum: "RISING", rsi7: 50 },
      hourly: { ema20: 101, ema50: 100 },
      fourHour: { ema20VsEma50Pct: 1.1, volumeRatio: 1.3 },
    }) as any,
    "OPEN_LONG"
  );
  const shortScore = calculateCandidateScore(
    makeSnapshot({
      dayChangePct: -1.2,
      intraday: { priceVsEma20Pct: -0.8, momentum: "FALLING", rsi7: 50 },
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
      intraday: { priceVsEma20Pct: -0.6, momentum: "FALLING", rsi7: 48 },
      hourly: { ema20: 99, ema50: 100 },
      fourHour: { ema20VsEma50Pct: -0.8, volumeRatio: 1.1 },
    }) as any,
    "OPEN_SHORT"
  );
  const flat = calculateCandidateScore(
    makeSnapshot({
      intraday: { priceVsEma20Pct: -0.6, momentum: "FLAT", rsi7: 48 },
      hourly: { ema20: 99, ema50: 100 },
      fourHour: { ema20VsEma50Pct: -0.8, volumeRatio: 1.1 },
    }) as any,
    "OPEN_SHORT"
  );

  assert.ok(flat.total < falling.total);
});

test("default hybrid rules and explicit rule config produce the same candidate set", () => {
  const decisionContext = {
    marketSnapshot: {
      symbols: {
        BTC: makeSnapshot({
          dayChangePct: -0.2,
          intraday: { priceVsEma20Pct: -0.45, momentum: "FALLING", rsi7: 48 },
          hourly: { ema20: 99.2, ema50: 100 },
          fourHour: { ema20VsEma50Pct: -0.9, volumeRatio: 1.25 },
        }),
      },
    },
    marketSnapshotSummary: { generatedAt: new Date().toISOString(), symbols: {} },
  } as any;

  const baseArgs = {
    decisionContext,
    accountState: {
      accountValue: 1000,
      withdrawable: 1000,
    },
    positions: [],
    config: {
      maxLeverage: 5,
      maxPositionSize: 10,
      enableRegimeFilter: true,
      require1hAlignment: true,
    },
    allowedSymbols: ["BTC"],
    testnet: false,
    now: 0,
  };

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
      topCandidates: implicit.topCandidates.map((candidate) => ({
        id: candidate.id,
        score: candidate.score,
      })),
      blockedCount: implicit.blockedCandidates.length,
    },
    {
      forcedHold: explicit.forcedHold,
      holdReason: explicit.holdReason,
      topCandidates: explicit.topCandidates.map((candidate) => ({
        id: candidate.id,
        score: candidate.score,
      })),
      blockedCount: explicit.blockedCandidates.length,
    }
  );
});
