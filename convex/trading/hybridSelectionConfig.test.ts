import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_HYBRID_SELECTION_RULES,
  needsHybridSelectionDefaultsMigration,
  normalizeHybridSelectionConfig,
  resolveHybridSelectionRules,
} from "./hybridSelectionConfig";

test("resolveHybridSelectionRules normalizes stale default-like values", () => {
  const rules = resolveHybridSelectionRules({
    hybridScoreFloor: 60,
    hybridMinChopVolumeRatio: 0.8,
  });

  assert.equal(rules.hybridScoreFloor, DEFAULT_HYBRID_SELECTION_RULES.hybridScoreFloor);
  assert.equal(
    rules.hybridMinChopVolumeRatio,
    DEFAULT_HYBRID_SELECTION_RULES.hybridMinChopVolumeRatio
  );
});

test("normalizeHybridSelectionConfig preserves explicit custom values", () => {
  const normalized = normalizeHybridSelectionConfig({
    hybridScoreFloor: 55,
    hybridMinChopVolumeRatio: 0.72,
  });

  assert.equal(normalized.hybridScoreFloor, 55);
  assert.equal(normalized.hybridMinChopVolumeRatio, 0.72);
});

test("needsHybridSelectionDefaultsMigration only flags stale hybrid configs", () => {
  assert.equal(
    needsHybridSelectionDefaultsMigration({
      useHybridSelection: true,
      hybridScoreFloor: 64,
      hybridMinChopVolumeRatio: 0.8,
    }),
    true
  );

  assert.equal(
    needsHybridSelectionDefaultsMigration({
      useHybridSelection: true,
      hybridScoreFloor: 55,
      hybridMinChopVolumeRatio: 0.7,
    }),
    false
  );

  assert.equal(
    needsHybridSelectionDefaultsMigration({
      useHybridSelection: false,
      hybridScoreFloor: 64,
      hybridMinChopVolumeRatio: 0.8,
    }),
    false
  );
});
