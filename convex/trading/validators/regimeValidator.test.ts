import test from "node:test";
import assert from "node:assert/strict";

import { evaluateDirectionalRegime } from "./regimeValidator";

const defaultConfig = {
  enableRegimeFilter: true,
  require1hAlignment: true,
  redDayLongBlockPct: -1.5,
  greenDayShortBlockPct: 1.5,
};

function makeInput(overrides: Record<string, any> = {}) {
  return {
    priceVsEma20Pct: 0,
    momentum: "FLAT",
    hourlyEma20: 100,
    hourlyEma50: 100,
    dayChangePct: 0,
    fourHourEma20: 100,
    fourHourEma50: 100,
    ...overrides,
  };
}

test("allows long recovery through mildly bearish 1h structure when 4h is not bearish", () => {
  const result = evaluateDirectionalRegime(
    defaultConfig,
    "OPEN_LONG",
    makeInput({
      priceVsEma20Pct: 0.25,
      momentum: "RISING",
      hourlyEma20: 99.82,
      hourlyEma50: 100,
      fourHourEma20: 101,
      fourHourEma50: 100,
    })
  );

  assert.equal(result.allowed, true);
  assert.ok(result.checks.includes("hourly_long_recovery_exception"));
});

test("blocks long when bearish 1h structure has no intraday recovery", () => {
  const result = evaluateDirectionalRegime(
    defaultConfig,
    "OPEN_LONG",
    makeInput({
      priceVsEma20Pct: -0.12,
      momentum: "FALLING",
      hourlyEma20: 99.7,
      hourlyEma50: 100,
      fourHourEma20: 101,
      fourHourEma50: 100,
    })
  );

  assert.equal(result.allowed, false);
  assert.match(result.reason, /without intraday recovery/i);
});

test("mirrors the same recovery exception for shorts", () => {
  const result = evaluateDirectionalRegime(
    defaultConfig,
    "OPEN_SHORT",
    makeInput({
      priceVsEma20Pct: -0.22,
      momentum: "FALLING",
      hourlyEma20: 100.18,
      hourlyEma50: 100,
      fourHourEma20: 99.4,
      fourHourEma50: 100,
    })
  );

  assert.equal(result.allowed, true);
  assert.ok(result.checks.includes("hourly_short_recovery_exception"));
});

test("red-day long block still applies when recovery is absent", () => {
  const result = evaluateDirectionalRegime(
    defaultConfig,
    "OPEN_LONG",
    makeInput({
      priceVsEma20Pct: -0.05,
      momentum: "FALLING",
      dayChangePct: -2.1,
      hourlyEma20: 100,
      hourlyEma50: 100,
      fourHourEma20: 100,
      fourHourEma50: 100,
    })
  );

  assert.equal(result.allowed, false);
  assert.match(result.reason, /session is red/i);
});
