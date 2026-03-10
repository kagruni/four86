import test from "node:test";
import assert from "node:assert/strict";

import { calculateTrendDirection as calculateSnapshotTrendDirection } from "./decisionContext";
import { calculateTrendDirection as calculateSignalTrendDirection } from "../signals/trendAnalysis";

test("decisionContext trend direction recognizes strong higher-timeframe bias", () => {
  assert.equal(
    calculateSnapshotTrendDirection(-0.1, 0.38, 0.3),
    "BULLISH"
  );
  assert.equal(
    calculateSnapshotTrendDirection(0.1, -0.42, 0.3),
    "BEARISH"
  );
});

test("decisionContext trend direction recognizes weak agreement across both inputs", () => {
  assert.equal(
    calculateSnapshotTrendDirection(0.12, 0.11, 0.3),
    "BULLISH"
  );
  assert.equal(
    calculateSnapshotTrendDirection(-0.12, -0.11, 0.3),
    "BEARISH"
  );
});

test("signal trend direction follows the same OR-style confirmation pattern", () => {
  assert.equal(
    calculateSignalTrendDirection(0.2, 0.2),
    "BULLISH"
  );
  assert.equal(
    calculateSignalTrendDirection(-0.1, -0.6),
    "BEARISH"
  );
});
