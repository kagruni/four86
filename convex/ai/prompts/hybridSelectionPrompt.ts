import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
} from "@langchain/core/prompts";
import type {
  HybridCandidate,
  HybridCandidateSet,
  HybridCloseCandidate,
} from "../../trading/hybridSelection";

export const HYBRID_SELECTION_SYSTEM_PROMPT_TEXT = `
You are the final selector in a hybrid crypto trading system.

Deterministic code has already filtered invalid trades and ranked the strongest valid candidates.
You are NOT allowed to invent symbols, directions, or close targets outside the provided option set.

IMPORTANT PRIORITY:
- The ranked candidate set is the primary technical truth.
- Sentiment/news is secondary and may only be used as a weak tie-breaker.
- Broad sentiment labels like "risk_on", "risk_off", "bullish", or "bearish" are NOT enough by themselves to force a trade.
- A one-direction shortlist is NOT automatically a trade, but it is also NOT a reason to reject the top candidate by itself.
- Clean entries matter more than raw trend strength. Do not chase already-extended 2m moves.
- HOLD only when no candidate has a clear technical edge, the trigger looks exhausted or chased, the shortlist is weak or nearly tied, or an eligible CLOSE is more compelling.

SELECTION RULES:
- Choose exactly one action:
  1. HOLD
  2. SELECT_CANDIDATE using one provided candidate_id
  3. CLOSE using one provided close_symbol
- Treat sentiment/news only as a tie-breaker between already-valid candidates.
- SELECT_CANDIDATE when one candidate has a clear edge: coherent 15m/1h/4h direction, a non-exhausted 2m trigger, and materially better structure than the alternatives.
- HOLD when the top candidate is weak, nearly tied, mixed, flat/choppy, or looks like a chase rather than a clean pullback/bounce entry.
- For LONG entries, do not buy an already-extended 2m spike or overbought surge. Prefer dip-stabilize, reclaim, or fresh turn-up triggers.
- For SHORT entries, do not short an already-extended 2m flush or deeply oversold breakdown. Prefer bounce-stall, rollover, or fresh turn-down triggers.
- Scores are heuristic ranks, not probabilities; a mid-range score can still be tradable when the structure is clean.
- Never output a candidate_id or close_symbol that is not listed.

Respond with ONLY one valid JSON object:
{
  "action": "HOLD" | "SELECT_CANDIDATE" | "CLOSE",
  "candidate_id": "<provided candidate_id or null>",
  "close_symbol": "<provided close symbol or null>",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation grounded in the provided candidates and optional sentiment tie-break"
}
`;

export const HYBRID_SELECTION_SYSTEM_PROMPT = SystemMessagePromptTemplate.fromTemplate(
  HYBRID_SELECTION_SYSTEM_PROMPT_TEXT
    .split("{").join("{{")
    .split("}").join("}}")
);

export const HYBRID_SELECTION_USER_PROMPT = HumanMessagePromptTemplate.fromTemplate(`
###[HYBRID CANDIDATE SELECTION]
Timestamp: {timestamp}
Account Value: {accountValue} USD
Available Cash: {availableCash} USD
Open Positions: {positionCount}
Candidate Score Floor: {scoreFloor}
Shortlist Status: {shortlistStatus}
Direction Summary: {directionSummary}

###[TOP RANKED ENTRY CANDIDATES]
{candidateSection}

###[ELIGIBLE CLOSE OPTIONS]
{closeSection}

{sentimentContext}

REMINDERS:
- You may only choose HOLD, one listed candidate_id, or one listed close_symbol.
- The deterministic filters are authoritative.
- Sentiment may break ties, but sentiment alone must not force a trade.
- A one-direction shortlist can still be too weak or too thin, but do not reject it only because it is one-direction.
- Select the top candidate when it clearly has the best structure and the 2m trigger is not already exhausted or chased.
- HOLD when the trigger looks stretched, the shortlist is nearly tied, or the setup is unclear.
- Do not confuse an already-oversold bearish flush with a clean short entry, or an already-overbought bullish spike with a clean long entry.
- Prefer clean pullback longs and clean bounce shorts over stretched continuation entries when the higher-timeframe direction still supports the trade.
Respond with ONLY valid JSON.
`);

export const hybridSelectionPrompt = ChatPromptTemplate.fromMessages([
  HYBRID_SELECTION_SYSTEM_PROMPT,
  HYBRID_SELECTION_USER_PROMPT,
]);

function formatCandidate(candidate: HybridCandidate): string {
  return [
    `- candidate_id: ${candidate.id}`,
    `  symbol: ${candidate.symbol}`,
    `  action: ${candidate.decision}`,
    `  score: ${candidate.score.toFixed(1)}`,
    `  setup (15m): ${candidate.snapshot.fifteenMinuteTrend}, momentum ${candidate.snapshot.fifteenMinuteMomentum}, price vs EMA20 ${candidate.snapshot.priceVsEma20Pct15m.toFixed(2)}%, RSI7 ${candidate.snapshot.rsi7_15m.toFixed(1)}`,
    `  trigger (2m): ${candidate.snapshot.intradayTrend}, momentum ${candidate.snapshot.intradayMomentum}, price vs EMA20 ${candidate.snapshot.priceVsEma20Pct.toFixed(2)}%`,
    `  hourly: ${candidate.snapshot.hourlyTrend} | 4h: ${candidate.snapshot.fourHourTrend} (${candidate.snapshot.ema20VsEma50Pct4h.toFixed(2)}%)`,
    `  session: ${candidate.snapshot.dayChangePct >= 0 ? "+" : ""}${candidate.snapshot.dayChangePct.toFixed(2)}% | 2m RSI7 ${candidate.snapshot.rsi7.toFixed(1)} | volume ${candidate.snapshot.volumeRatio.toFixed(2)}x`,
    `  score_breakdown: trigger ${candidate.scoreBreakdown.intradayAlignment.toFixed(1)}, setup15m ${candidate.scoreBreakdown.fifteenMinuteAlignment.toFixed(1)}, 1h ${candidate.scoreBreakdown.hourlyAlignment.toFixed(1)}, 4h ${candidate.scoreBreakdown.fourHourAlignment.toFixed(1)}, session ${candidate.scoreBreakdown.sessionAlignment.toFixed(1)}, volatility ${candidate.scoreBreakdown.volatilityQuality.toFixed(1)}, rsi15m ${candidate.scoreBreakdown.rsiContext.toFixed(1)}, volume ${candidate.scoreBreakdown.volumeQuality.toFixed(1)}, penalty ${candidate.scoreBreakdown.momentumPenalty.toFixed(1)}`,
    `  execution_baseline: size ${candidate.executionPlan.sizeUsd.toFixed(2)} USD, leverage ${candidate.executionPlan.leverage}x (band ${candidate.executionPlan.leverageBand.min}-${candidate.executionPlan.leverageBand.max}x), stop ${candidate.executionPlan.stopLoss.toFixed(2)}, target ${candidate.executionPlan.takeProfit.toFixed(2)}`,
    `  invalidation: ${candidate.executionPlan.invalidationCondition}`,
  ].join("\n");
}

function formatCloseCandidate(candidate: HybridCloseCandidate): string {
  return [
    `- close_symbol: ${candidate.symbol}`,
    `  side: ${candidate.side}`,
    `  unrealized_pnl_pct: ${candidate.unrealizedPnlPct.toFixed(2)}%`,
    `  tp_sl_set: ${candidate.hasTpSl ? "yes" : "no"}`,
    `  intraday_momentum: ${candidate.intradayMomentum}`,
    `  reason: ${candidate.reason}`,
  ].join("\n");
}

export function formatHybridCandidateSection(candidateSet: HybridCandidateSet): string {
  if (candidateSet.topCandidates.length === 0) {
    return "No valid entry candidates.";
  }
  return candidateSet.topCandidates.map(formatCandidate).join("\n\n");
}

export function formatHybridCloseSection(closeCandidates: HybridCloseCandidate[]): string {
  if (closeCandidates.length === 0) {
    return "No eligible close options.";
  }
  return closeCandidates.map(formatCloseCandidate).join("\n\n");
}

export function formatHybridDirectionSummary(candidateSet: HybridCandidateSet): string {
  if (candidateSet.topCandidates.length === 0) {
    return "No ranked entry candidates.";
  }

  const uniqueDirections = Array.from(
    new Set(candidateSet.topCandidates.map((candidate) => candidate.decision))
  );

  if (uniqueDirections.length === 1) {
    const direction = uniqueDirections[0];
    const top = candidateSet.topCandidates[0];
    return `All ranked entry candidates point ${direction}. Top candidate is ${top.symbol} at score ${top.score.toFixed(1)}.`;
  }

  return `Ranked entry candidates are mixed across directions: ${candidateSet.topCandidates
    .map((candidate) => `${candidate.symbol} ${candidate.decision} (${candidate.score.toFixed(1)})`)
    .join(", ")}.`;
}

export function formatHybridShortlistStatus(candidateSet: HybridCandidateSet): string {
  if (candidateSet.topCandidates.length === 0) {
    return "No valid entry candidates remain after deterministic filtering.";
  }

  const top = candidateSet.topCandidates[0];
  if (candidateSet.belowScoreFloor) {
    return `Top candidate ${top.id} is ${candidateSet.scoreGapToFloor.toFixed(1)} points below the configured floor.`;
  }

  return `Top candidate ${top.id} is above the configured floor.`;
}

export function formatHybridSentimentContext(
  research: any | null,
  candidateSet: HybridCandidateSet
): string {
  if (!research) return "";

  const topSymbols = new Set(
    candidateSet.topCandidates.map((candidate) => candidate.symbol)
  );

  const perCoinBits: string[] = [];
  if (research.perCoinSentiment) {
    for (const [symbol, data] of Object.entries(research.perCoinSentiment as Record<string, any>)) {
      if (!topSymbols.has(symbol)) continue;
      perCoinBits.push(`${symbol}: ${data.sentiment}`);
    }
  }

  const lines = [
    "###[SENTIMENT TIE-BREAK CONTEXT]",
    `Overall Sentiment: ${research.overallSentiment}`,
    `Recommended Bias: ${research.recommendedBias}`,
  ];

  if (perCoinBits.length > 0) {
    lines.push(`Top-candidate sentiment: ${perCoinBits.join(", ")}`);
  }

  lines.push("Use this only as a weak tie-break. Do not override a clean one-direction technical shortlist on sentiment alone.");

  return lines.join("\n");
}
