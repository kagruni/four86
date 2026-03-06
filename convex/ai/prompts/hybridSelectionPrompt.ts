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

export const HYBRID_SELECTION_SYSTEM_PROMPT = SystemMessagePromptTemplate.fromTemplate(`
You are the final selector in a hybrid crypto trading system.

Deterministic code has already filtered invalid trades and ranked the strongest valid candidates.
You are NOT allowed to invent symbols, directions, or close targets outside the provided option set.

SELECTION RULES:
- Choose exactly one action:
  1. HOLD
  2. SELECT_CANDIDATE using one provided candidate_id
  3. CLOSE using one provided close_symbol
- Treat sentiment/news only as a tie-breaker between already-valid candidates
- If the candidate list is weak, mixed, or unclear, choose HOLD
- Never output a candidate_id or close_symbol that is not listed
- Prefer HOLD over forcing a marginal trade

Respond with ONLY one valid JSON object:
{{
  "action": "HOLD" | "SELECT_CANDIDATE" | "CLOSE",
  "candidate_id": "<provided candidate_id or null>",
  "close_symbol": "<provided close symbol or null>",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation grounded in the provided candidates and optional sentiment tie-break"
}}
`);

export const HYBRID_SELECTION_USER_PROMPT = HumanMessagePromptTemplate.fromTemplate(`
###[HYBRID CANDIDATE SELECTION]
Timestamp: {timestamp}
Account Value: {accountValue} USD
Available Cash: {availableCash} USD
Open Positions: {positionCount}
Candidate Score Floor: {scoreFloor}

###[TOP RANKED ENTRY CANDIDATES]
{candidateSection}

###[ELIGIBLE CLOSE OPTIONS]
{closeSection}

{sentimentContext}

REMINDERS:
- You may only choose HOLD, one listed candidate_id, or one listed close_symbol.
- The deterministic filters are authoritative.
- If sentiment conflicts with the technical ranking and no candidate is clearly superior, choose HOLD.
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
    `  intraday: ${candidate.snapshot.intradayTrend}, momentum ${candidate.snapshot.intradayMomentum}, price vs EMA20 ${candidate.snapshot.priceVsEma20Pct.toFixed(2)}%`,
    `  hourly: ${candidate.snapshot.hourlyTrend} | 4h: ${candidate.snapshot.fourHourTrend} (${candidate.snapshot.ema20VsEma50Pct4h.toFixed(2)}%)`,
    `  session: ${candidate.snapshot.dayChangePct >= 0 ? "+" : ""}${candidate.snapshot.dayChangePct.toFixed(2)}% | RSI7 ${candidate.snapshot.rsi7.toFixed(1)} | volume ${candidate.snapshot.volumeRatio.toFixed(2)}x`,
    `  score_breakdown: intraday ${candidate.scoreBreakdown.intradayAlignment.toFixed(1)}, 1h ${candidate.scoreBreakdown.hourlyAlignment.toFixed(1)}, 4h ${candidate.scoreBreakdown.fourHourAlignment.toFixed(1)}, session ${candidate.scoreBreakdown.sessionAlignment.toFixed(1)}, volatility ${candidate.scoreBreakdown.volatilityQuality.toFixed(1)}, rsi ${candidate.scoreBreakdown.rsiContext.toFixed(1)}, volume ${candidate.scoreBreakdown.volumeQuality.toFixed(1)}, penalty ${candidate.scoreBreakdown.momentumPenalty.toFixed(1)}`,
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
