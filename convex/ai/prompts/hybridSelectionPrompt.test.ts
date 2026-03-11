import test from "node:test";
import assert from "node:assert/strict";

import { HYBRID_SELECTION_SYSTEM_PROMPT_TEXT } from "./hybridSelectionPrompt";

test("hybrid selector prompt prefers explicit selection criteria over generic hold bias", () => {
  assert.match(
    HYBRID_SELECTION_SYSTEM_PROMPT_TEXT,
    /SELECT_CANDIDATE when one candidate has a clear edge/i
  );
  assert.match(
    HYBRID_SELECTION_SYSTEM_PROMPT_TEXT,
    /HOLD only when no candidate has a clear technical edge/i
  );
});

test("hybrid selector prompt includes anti-chase guidance for long and short triggers", () => {
  assert.match(
    HYBRID_SELECTION_SYSTEM_PROMPT_TEXT,
    /do not buy an already-extended 2m spike or overbought surge/i
  );
  assert.match(
    HYBRID_SELECTION_SYSTEM_PROMPT_TEXT,
    /do not short an already-extended 2m flush or deeply oversold breakdown/i
  );
});

test("hybrid selector prompt no longer uses the old generic hold-over-force wording", () => {
  assert.doesNotMatch(
    HYBRID_SELECTION_SYSTEM_PROMPT_TEXT,
    /Prefer HOLD over forcing a marginal trade/i
  );
});
