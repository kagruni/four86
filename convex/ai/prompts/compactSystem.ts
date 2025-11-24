import {
  ChatPromptTemplate,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
} from "@langchain/core/prompts";
import type { CoinSignalSummary, PositionSignals } from "../../signals/types";

/**
 * Compact Trading Prompt System (~150 lines)
 *
 * Replaces the 680-line detailed prompt with a streamlined version that:
 * - Trusts pre-calculated signals (no raw data re-analysis)
 * - Focuses on decision-making, not technical analysis
 * - Clear priority order: limits -> positions -> new entries
 */

// =============================================================================
// SYSTEM PROMPT (~80 lines)
// =============================================================================

export const COMPACT_SYSTEM_PROMPT = SystemMessagePromptTemplate.fromTemplate(`
You are an autonomous crypto trading AI for Hyperliquid DEX perpetual futures.

ACCOUNT CONFIG:
- Max Leverage: {maxLeverage}x | Max Position Size: {maxPositionSize}% of account
- Per-Trade Risk: {perTradeRiskPct}% | Min Entry Confidence: {minEntryConfidence}
- Max Positions: {maxTotalPositions} total, {maxSameDirectionPositions} same direction

DECISION PRIORITY (follow in order):
1. CHECK LIMITS: Position count at max? Daily loss breached? Account below minimum? -> HOLD
2. MANAGE POSITIONS: For each open position, check invalidation -> CLOSE if triggered, else HOLD (confidence 0.99)
3. EVALUATE ENTRIES: Review pre-calculated signals -> OPEN if strong setup, else HOLD

SIGNAL INTERPRETATION:
- Trend: BULLISH/BEARISH/NEUTRAL with strength (1-10) and momentum (ACCELERATING/STEADY/DECELERATING)
- Regime: TRENDING (trade with trend) | RANGING (trade extremes) | VOLATILE (reduce size)
- Recommendation: STRONG_LONG/LONG/NEUTRAL/SHORT/STRONG_SHORT based on combined signals
- Risk Score: 1-10 (higher = more caution, reduce size if >7)

POSITION MANAGEMENT:
DEFAULT: HOLD existing positions (confidence 0.99) unless:
- Invalidation condition is explicitly triggered with current values as proof
- Major structural change (10%+ spike, flash crash)

DO NOT CLOSE because:
- Position slightly negative
- "Better opportunity" elsewhere
- Chart "looks less bullish/bearish"
- Want to "lock in profits"

Your stop loss and take profit orders are working on the exchange. Trust them.

ENTRY REQUIREMENTS:
- Recommendation: LONG/STRONG_LONG for longs, SHORT/STRONG_SHORT for shorts
- Trend strength >= 5/10 with ACCELERATING or STEADY momentum
- Risk score <= 7/10 (reduce size 50% if 6-7)
- Timeframe alignment: 2m-4h trends aligned (preferred)
- At least 2 entry signals detected

SIZE CALCULATION:
1. Risk Amount = Available Cash * {perTradeRiskPct}%
2. Stop Distance = Use pre-calculated support/resistance (max 3% from entry)
3. Position Size = Risk Amount / Stop Distance
4. Cap at {maxPositionSize}% of account
5. Leverage = max(1, min(ceiling(Size/Account), {maxLeverage}))

OUTPUT FORMAT:
Respond with ONLY valid JSON matching the schema. No other text.

VALID SYMBOLS: "BTC", "ETH", "SOL", "BNB", "DOGE", "XRP" or null
NEVER use "ALL", "NONE", or any other string. Use null for general decisions.

Required fields by decision:
- HOLD (general, no positions): {{"decision": "HOLD", "symbol": null, "confidence": 0.99, "reasoning": "..."}}
- HOLD (specific position): {{"decision": "HOLD", "symbol": "BTC", "confidence": 0.99, "reasoning": "..."}}
- OPEN_LONG/OPEN_SHORT: {{"decision": "OPEN_LONG", "symbol": "BTC", "confidence": 0.6-0.9, "leverage": N, "size_usd": N, "stop_loss": N, "take_profit": N, "invalidation_condition": "...", "risk_reward_ratio": N, "reasoning": "..."}}
- CLOSE: {{"decision": "CLOSE", "symbol": "BTC", "confidence": 0.85-0.95, "reasoning": "Invalidation triggered: [condition] is now [current value]"}}

Trust the pre-calculated signals. Your job is to DECIDE, not re-analyze raw data.
`);

// =============================================================================
// MARKET DATA PROMPT
// =============================================================================

export const COMPACT_MARKET_DATA_PROMPT = HumanMessagePromptTemplate.fromTemplate(`
TRADING SESSION: {timestamp}

PRE-PROCESSED MARKET SIGNALS:
{preProcessedSignals}

ACCOUNT STATUS:
- Account Value: \${accountValue} | Available Cash: \${availableCash}
- Positions: {positionCount} / {maxPositions}

CURRENT POSITIONS:
{currentPositions}

Make your trading decision following the priority order: limits -> positions -> entries.
Respond with ONLY valid JSON.
`);

// =============================================================================
// COMBINED PROMPT
// =============================================================================

export const compactTradingPrompt = ChatPromptTemplate.fromMessages([
  COMPACT_SYSTEM_PROMPT,
  COMPACT_MARKET_DATA_PROMPT,
]);

// =============================================================================
// FORMATTING FUNCTIONS
// =============================================================================

/**
 * Format pre-processed signals into a concise, readable format
 */
export function formatPreProcessedSignals(
  signals: Record<string, CoinSignalSummary>
): string {
  const lines: string[] = [];

  for (const [symbol, coin] of Object.entries(signals)) {
    const trendAlign = coin.trend.timeframeAlignment ? "ALIGNED" : "DIVERGENT";
    const signalCount = coin.entrySignals.length;
    const signalList = coin.entrySignals
      .map((s) => `${s.type} (${s.strength.toLowerCase()})`)
      .join(", ");

    const support = coin.keyLevels.support[0]?.toFixed(2) || "N/A";
    const resistance = coin.keyLevels.resistance[0]?.toFixed(2) || "N/A";

    lines.push(`${symbol} ($${coin.currentPrice.toFixed(2)}):`);
    lines.push(
      `  Trend: ${coin.trend.direction} (${coin.trend.strength}/10), momentum ${coin.trend.momentum}, 2m-4h ${trendAlign}`
    );
    lines.push(
      `  Regime: ${coin.regime.type}, volatility ${coin.regime.volatility}`
    );
    lines.push(`  Levels: Support $${support} | Resistance $${resistance}`);

    if (signalCount > 0) {
      lines.push(`  Signals (${signalCount}): ${signalList}`);
    } else {
      lines.push(`  Signals: None detected`);
    }

    const riskFactors =
      coin.risk.factors.length > 0 ? coin.risk.factors.join(", ") : "None";
    lines.push(`  Risk: ${coin.risk.score}/10 - ${riskFactors}`);
    lines.push(`  >>> RECOMMENDATION: ${coin.recommendation}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format existing positions concisely
 */
export function formatPositions(positions: any[]): string {
  if (positions.length === 0) {
    return "No open positions.";
  }

  const lines: string[] = [];

  for (const pos of positions) {
    const pnlSign = pos.unrealizedPnl >= 0 ? "+" : "";
    const pnlPctSign = pos.unrealizedPnlPct >= 0 ? "+" : "";

    lines.push(`${pos.symbol} ${pos.side} (${pos.leverage}x):`);
    lines.push(
      `  Entry: $${pos.entryPrice.toFixed(2)} | Current: $${pos.currentPrice.toFixed(2)}`
    );
    lines.push(
      `  P&L: ${pnlSign}$${pos.unrealizedPnl.toFixed(2)} (${pnlPctSign}${pos.unrealizedPnlPct.toFixed(2)}%)`
    );
    lines.push(
      `  Stop: $${pos.stopLoss?.toFixed(2) || "N/A"} | TP: $${pos.takeProfit?.toFixed(2) || "N/A"}`
    );
    lines.push(`  Invalidation: ${pos.invalidationCondition || "Not defined"}`);
    lines.push(`  -> Check: Is invalidation triggered? If YES, CLOSE.`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format position signals (for existing position management)
 */
export function formatPositionSignals(signals: PositionSignals[]): string {
  if (signals.length === 0) {
    return "No position signals.";
  }

  const lines: string[] = [];

  for (const sig of signals) {
    lines.push(`${sig.symbol}:`);
    lines.push(`  P&L: ${sig.pnlPct >= 0 ? "+" : ""}${sig.pnlPct.toFixed(2)}%`);

    if (sig.invalidationTriggered) {
      lines.push(`  !!! INVALIDATION TRIGGERED: ${sig.invalidationReason}`);
    }

    if (sig.shouldClose) {
      lines.push(`  >>> SHOULD CLOSE: ${sig.closeReason}`);
    } else {
      lines.push(`  Status: OK - HOLD`);
    }

    lines.push("");
  }

  return lines.join("\n");
}
