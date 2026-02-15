import {
  ChatPromptTemplate,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
} from "@langchain/core/prompts";
import type { DetailedCoinData } from "../../hyperliquid/detailedMarketData";

// =============================================================================
// TREND ANALYSIS HELPERS (for Alpha Arena prompt)
// =============================================================================

type TrendDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
type PriceMomentum = "RISING" | "FALLING" | "FLAT";

/**
 * Calculate price momentum from recent price history.
 * Looks at the last 5 candles to determine if price is rising or falling.
 */
function calculatePriceMomentum(priceHistory: number[]): PriceMomentum {
  if (!priceHistory || priceHistory.length < 3) {
    return "FLAT";
  }
  const recentPrices = priceHistory.slice(-5);
  let upMoves = 0;
  let downMoves = 0;
  for (let i = 1; i < recentPrices.length; i++) {
    if (recentPrices[i] > recentPrices[i - 1]) upMoves++;
    else if (recentPrices[i] < recentPrices[i - 1]) downMoves++;
  }
  if (upMoves >= 3) return "RISING";
  if (downMoves >= 3) return "FALLING";
  return "FLAT";
}

/**
 * Determine trend direction based on EMA alignment.
 */
function calculateTrendDirection(priceVsEma20Pct: number, ema20VsEma50Pct: number): TrendDirection {
  const threshold = 0.3;
  if (priceVsEma20Pct > threshold && ema20VsEma50Pct > threshold) return "BULLISH";
  if (priceVsEma20Pct < -threshold && ema20VsEma50Pct < -threshold) return "BEARISH";
  return "NEUTRAL";
}

/**
 * Get trading recommendation based on trend and momentum
 */
function getTradingBias(trendDirection: TrendDirection, momentum: PriceMomentum): string {
  if (trendDirection === "BULLISH" && momentum !== "FALLING") return "BIAS: Look for LONG entries";
  if (trendDirection === "BEARISH" && momentum !== "RISING") return "BIAS: Look for SHORT entries";
  if (trendDirection === "BULLISH" && momentum === "FALLING") return "CAUTION: Bullish trend but momentum fading";
  if (trendDirection === "BEARISH" && momentum === "RISING") return "CAUTION: Bearish trend but momentum reversing";
  return "BIAS: NEUTRAL - wait for clearer setup";
}

/**
 * Alpha Arena-Style Trading Prompt
 *
 * Replicates the exact format used by winning AI traders in Alpha Arena:
 * - DeepSeek R1: 130% return - used 5-10x leverage, held positions LONG
 * - Qwen 2.5 Max: 22% return - strict TP/SL discipline, let trades play out
 *
 * Key principles:
 * - Use LEVERAGE (5-10x) when confident
 * - ALWAYS set TP and SL on every trade
 * - HOLD positions until TP or SL is hit (don't close early!)
 * - Raw data, let AI analyze (no pre-processed recommendations)
 * - Per-coin chain-of-thought analysis
 */

// =============================================================================
// SYSTEM PROMPT - Alpha Arena Style
// =============================================================================

export const ALPHA_ARENA_SYSTEM_PROMPT = SystemMessagePromptTemplate.fromTemplate(`
You are an autonomous crypto trading AI for Hyperliquid DEX perpetual futures.
Your goal is PROFITABILITY through leveraged trading with strict TP/SL discipline.

WINNING STRATEGY (from Alpha Arena top performers - DeepSeek 130%, Qwen 22%):
- Use LEVERAGE when confident in the setup
- ALWAYS set TP and SL: Every trade MUST have take-profit and stop-loss
- HOLD until TP/SL: Let the exchange handle exits - don't close manually
- Let winners run: Don't exit just because you're profitable
- Cut losers: Stop loss handles this automatically

ACCOUNT CONFIG:
- Max Leverage: {maxLeverage}x | Max Position Size: {maxPositionSize}% of account
- Per-Trade Risk: {perTradeRiskPct}% | Min Entry Confidence: {minEntryConfidence}
- Max Positions: {maxTotalPositions} total | Trading Mode: {tradingModeDescription}

TP/SL REQUIREMENTS (ATR-BASED — MANDATORY):
- stop_loss: {stopLossAtrMultiplier}x ATR(14,4h) from entry
- take_profit: {takeProfitAtrMultiplier}x ATR(14,4h) from entry
- Minimum R:R ratio: {minRiskRewardRatio}:1 (NEVER trade below this)
- Each coin's [SUGGESTED ZONES] shows pre-calculated $ levels — USE THEM
- invalidation_condition: Clear technical level that invalidates the thesis

VOLATILITY-ADAPTIVE LEVERAGE:
- ATR% < 1.0%  → 5-{maxLeverage}x (low volatility, tighter moves)
- ATR% 1.0-2.5% → 3-5x (normal volatility)
- ATR% > 2.5%  → 2-3x (high volatility, wider stops need less leverage)
- {volatileTradeRule}

CORRELATION RULES:
- BTC, ETH, SOL are highly correlated (~85%)
- Max {maxSameDirectionPositions} same-direction positions across correlated assets
- Treat BTC+ETH+SOL as one "basket" for direction exposure

4H ALIGNMENT:
- {trend4hRule}

POSITION MANAGEMENT RULES:
1. EXISTING POSITIONS: For each open position, check:
   - Is invalidation condition triggered? -> CLOSE
   - Is stop loss hit? -> Exchange handles automatically, HOLD
   - Has the trade thesis changed? (trend reversal, momentum shift, key level break) -> CLOSE
   - Is price near TP but momentum is fading/reversing? -> CLOSE (take the profit)
   - Otherwise -> HOLD (confidence 0.99)

2. VALID REASONS TO CLOSE MANUALLY:
   - Invalidation condition triggered
   - Trend direction has reversed (e.g., was BULLISH, now BEARISH)
   - Momentum has shifted against the position (RISING -> FALLING for longs)
   - Price stalling near TP with weakening momentum — lock in the gain
   - 4h timeframe has flipped against the position

3. DO NOT CLOSE just because:
   - Position is slightly negative but setup is still valid
   - Price approaching stop loss (let exchange handle it!)
   - "Better opportunity" elsewhere while current trade is still valid

4. NEW ENTRIES: Open when you see:
   - Clear trend direction with momentum
   - RSI supports direction (oversold for longs, overbought for shorts)
   - EMA alignment (price vs EMA20)
   - 4h timeframe confirms direction
   - R:R ratio meets minimum {minRiskRewardRatio}:1
   - No existing position on this symbol

ANALYSIS PROCESS (do this for EACH coin):
1. Read current indicators (price, EMA, MACD, RSI)
2. Check intraday series trend (is it accelerating or reversing?)
3. Confirm with 4h context (is 4h aligned with intraday?)
4. Check [SUGGESTED ZONES] for pre-calculated ATR-based TP/SL levels
5. If you have a position: check if thesis still holds (trend, momentum, invalidation). Close if thesis is broken or if price near TP with fading momentum.
6. If no position: is this a good setup? Verify R:R meets {minRiskRewardRatio}:1 before deciding

MANDATORY TREND-FOLLOWING RULES:
1. LONG entries ONLY when:
   - Price is ABOVE EMA20 (or within 0.3% after a bounce)
   - Price momentum is RISING or FLAT (NOT FALLING)
   - 4h trend preferably BULLISH

2. SHORT entries ONLY when:
   - Price is BELOW EMA20 (or within 0.3% after rejection)
   - Price momentum is FALLING or FLAT (NOT RISING)
   - 4h trend preferably BEARISH

3. FORBIDDEN (will lose money):
   - Going LONG when price < EMA20 AND momentum is FALLING
   - Going SHORT when price > EMA20 AND momentum is RISING
   - Buying "oversold" in a downtrend (oversold can get MORE oversold)
   - Shorting "overbought" in an uptrend (overbought can get MORE overbought)

4. RSI CONTEXT MATTERS:
   - RSI < 30 in DOWNTREND = "can go lower" = prefer SHORT or HOLD
   - RSI < 30 in UPTREND = "buy the dip" = consider LONG
   - RSI > 70 in UPTREND = "momentum strong" = prefer LONG or HOLD
   - RSI > 70 in DOWNTREND = "short opportunity" = consider SHORT

OUTPUT FORMAT:
CRITICAL: Your entire response must be a single valid JSON object. Do NOT write any text, explanations, or markdown before or after the JSON. No prose, no commentary — ONLY JSON. One decision per coin. Format:
{{
  "thinking": "Your chain-of-thought analysis for each coin...",
  "decisions": {{
    "BTC": {{ "signal": "hold" }},
    "ETH": {{ "signal": "close", "reason": "Invalidation triggered: RSI broke below 40" }},
    "SOL": {{
      "signal": "entry",
      "side": "long",
      "leverage": 7,
      "size_usd": 500,
      "stop_loss": 180.00,
      "take_profit": 210.00,
      "invalidation_condition": "Close below $182 on 2-minute candle",
      "confidence": 0.75,
      "reason": "Strong RSI bounce from oversold, 4h trend bullish, R:R 3:1"
    }}
  }}
}}

SIGNALS:
- "hold": Do nothing for this coin
- "close": Close existing position (only if invalidation triggered)
- "entry": Open new position with leverage and TP/SL

KEY INSIGHT: The winners used leverage aggressively but ALWAYS had TP/SL set.
They let their trades play out - no manual closes. Trust the exchange to hit your targets.
`);

// =============================================================================
// MARKET DATA PROMPT - Alpha Arena Style
// =============================================================================

export const ALPHA_ARENA_MARKET_PROMPT = HumanMessagePromptTemplate.fromTemplate(`
###[MARKET DATA - {timestamp}]

{marketDataSection}

###[ACCOUNT STATUS]
Account Value: {accountValue} USD
Available Cash: {availableCash} USD
Open Positions: {positionCount} / {maxPositions}

###[CURRENT OPEN POSITIONS - FROM EXCHANGE]
⚠️ IMPORTANT: These are REAL positions currently open on Hyperliquid. Do NOT open new positions on symbols you already have!

{positionsSection}

###[SYMBOLS WITH OPEN POSITIONS]
{openPositionSymbols}

{sentimentContext}
---
CRITICAL RULES:
1. If you have an open position on a symbol, you can ONLY output "hold" or "close" for that symbol
2. You can ONLY output "entry" for symbols where you have NO position
3. Check the [CURRENT OPEN POSITIONS] section above before making any decision

Analyze each coin. For existing positions, check invalidation ONLY.
For potential entries, calculate TP/SL and R:R ratio before deciding.
Respond with ONLY valid JSON.
`);

// =============================================================================
// COMBINED PROMPT
// =============================================================================

export const alphaArenaTradingPrompt = ChatPromptTemplate.fromMessages([
  ALPHA_ARENA_SYSTEM_PROMPT,
  ALPHA_ARENA_MARKET_PROMPT,
]);

// =============================================================================
// FORMATTING FUNCTIONS - Match Alpha Arena exact format
// =============================================================================

/**
 * Format market data in Alpha Arena style
 */
export function formatMarketDataAlphaArena(
  marketData: Record<string, DetailedCoinData>,
  slAtrMultiplier: number = 1.5,
  rrRatio: number = 2.0
): string {
  const lines: string[] = [];
  const tpAtrMultiplier = slAtrMultiplier * rrRatio;

  for (const [symbol, data] of Object.entries(marketData)) {
    // Calculate trend signals
    const priceVsEma20Pct = ((data.currentPrice - data.ema20) / data.ema20) * 100;
    const ema20VsEma50Pct = ((data.ema20_4h - data.ema50_4h) / data.ema50_4h) * 100;
    const priceMomentum = calculatePriceMomentum(data.priceHistory);
    const trendDirection = calculateTrendDirection(priceVsEma20Pct, ema20VsEma50Pct);
    const tradingBias = getTradingBias(trendDirection, priceMomentum);

    // ATR-based volatility classification
    const atrPct = (data.atr14_4h / data.currentPrice) * 100;
    const volatilityClass = atrPct < 1.0 ? "LOW" : atrPct < 2.5 ? "NORMAL" : "HIGH";

    // Pre-calculate SL/TP distances using user settings
    const slDistance = data.atr14_4h * slAtrMultiplier;
    const tpDistance = data.atr14_4h * tpAtrMultiplier;

    lines.push(`$${symbol}:`);
    lines.push(`[TREND ANALYSIS - READ FIRST]`);
    lines.push(`Trend: ${trendDirection} | Momentum: ${priceMomentum}`);
    lines.push(`Price vs EMA20: ${priceVsEma20Pct > 0 ? "ABOVE" : "BELOW"} (${priceVsEma20Pct.toFixed(2)}%)`);
    lines.push(`${tradingBias}`);
    lines.push(``);
    lines.push(`Current Price: $${data.currentPrice.toFixed(2)}`);
    lines.push(`EMA20: $${data.ema20.toFixed(2)} (last: [${data.ema20History.slice(-5).map(v => v.toFixed(2)).join(", ")}])`);
    lines.push(`MACD: ${data.macd.toFixed(4)} (last: [${data.macdHistory.slice(-5).map(v => v.toFixed(4)).join(", ")}])`);
    lines.push(`RSI_7: ${data.rsi7.toFixed(1)} (last: [${data.rsi7History.slice(-5).map(v => v.toFixed(1)).join(", ")}])`);
    lines.push(`RSI_14: ${data.rsi14.toFixed(1)} (last: [${data.rsi14History.slice(-5).map(v => v.toFixed(1)).join(", ")}])`);
    lines.push(``);
    lines.push(`[4h Context]`);
    lines.push(`EMA20 vs EMA50: ${data.ema20_4h > data.ema50_4h ? "BULLISH" : "BEARISH"} (EMA20: $${data.ema20_4h.toFixed(2)}, EMA50: $${data.ema50_4h.toFixed(2)})`);
    lines.push(`ATR(3): ${data.atr3_4h.toFixed(2)} | ATR(14): ${data.atr14_4h.toFixed(2)}`);
    lines.push(`Volume: ${data.currentVolume_4h.toFixed(0)} (avg: ${data.avgVolume_4h.toFixed(0)}, ratio: ${data.volumeRatio.toFixed(2)}x)`);
    lines.push(`24h Range: $${data.low24h.toFixed(2)} - $${data.high24h.toFixed(2)}`);

    if (data.fundingRate !== undefined) {
      lines.push(`Funding Rate: ${(data.fundingRate * 100).toFixed(4)}%`);
    }
    if (data.openInterest !== undefined) {
      lines.push(`Open Interest: ${data.openInterest.toFixed(0)} (avg: ${data.avgOpenInterest?.toFixed(0) || "N/A"})`);
    }

    lines.push(``);
    lines.push(`[SUGGESTED ZONES]`);
    lines.push(`Volatility: ${volatilityClass} (ATR: ${atrPct.toFixed(2)}%)`);
    lines.push(`LONG → SL: $${(data.currentPrice - slDistance).toFixed(2)} | TP: $${(data.currentPrice + tpDistance).toFixed(2)}`);
    lines.push(`SHORT → SL: $${(data.currentPrice + slDistance).toFixed(2)} | TP: $${(data.currentPrice - tpDistance).toFixed(2)}`);
    lines.push(`Suggested Leverage: ${volatilityClass === "LOW" ? "5-7x" : volatilityClass === "NORMAL" ? "3-5x" : "2-3x"}`);
    lines.push(``);
    lines.push(`[Intraday Price Series - last 10]`);
    lines.push(`Prices: [${data.priceHistory.map(p => p.toFixed(2)).join(", ")}]`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  return lines.join("\n");
}

/**
 * Format positions in Alpha Arena style
 */
export function formatPositionsAlphaArena(positions: any[]): string {
  if (positions.length === 0) {
    return "No open positions. You can open new positions on any symbol.";
  }

  const lines: string[] = [];
  lines.push(`⚠️ YOU HAVE ${positions.length} OPEN POSITION(S):`);
  lines.push(``);

  for (const pos of positions) {
    const pnlSign = pos.unrealizedPnl >= 0 ? "+" : "";
    const pnlPctSign = pos.unrealizedPnlPct >= 0 ? "+" : "";

    lines.push(`═══ ${pos.symbol} - ${pos.side} POSITION (DO NOT OPEN NEW ${pos.symbol} POSITION) ═══`);
    lines.push(`Position Size: $${pos.size?.toFixed(2) || "N/A"} USD`);
    lines.push(`Leverage: ${pos.leverage}x`);
    lines.push(`Entry Price: $${pos.entryPrice?.toFixed(2) || "N/A"}`);
    lines.push(`Current Price: $${pos.currentPrice?.toFixed(2) || "N/A"}`);
    lines.push(`Unrealized PnL: ${pnlSign}$${pos.unrealizedPnl?.toFixed(2) || "0.00"} (${pnlPctSign}${pos.unrealizedPnlPct?.toFixed(2) || "0.00"}%)`);
    lines.push(`Liquidation Price: $${pos.liquidationPrice?.toFixed(2) || "N/A"}`);
    lines.push(`Exit Plan:`);
    lines.push(`  take_profit: $${pos.takeProfit?.toFixed(2) || "Not set"}`);
    lines.push(`  stop_loss: $${pos.stopLoss?.toFixed(2) || "Not set"}`);
    lines.push(`  invalidation_condition: ${pos.invalidationCondition || "Not defined"}`);
    if (pos.entryReasoning) {
      lines.push(`Entry Reasoning: ${pos.entryReasoning.slice(0, 100)}...`);
    }
    lines.push(``);
  }

  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(`REMEMBER: For the symbols above, you can ONLY "hold" or "close".`);

  return lines.join("\n");
}

// =============================================================================
// SENTIMENT CONTEXT FORMATTER
// =============================================================================

/**
 * Format market research/sentiment data for injection into the trading prompt.
 * Returns empty string if no research data is available.
 */
export function formatSentimentContext(research: any | null): string {
  if (!research) return "";

  let context = "\n###[MARKET SENTIMENT CONTEXT]\n";
  context += `Fear & Greed Index: ${research.fearGreedIndex}/100 (${research.fearGreedLabel})\n`;
  context += `Overall Sentiment: ${research.overallSentiment}\n`;
  context += `Market Narrative: "${research.marketNarrative}"\n`;

  if (research.perCoinSentiment) {
    context += "Per-Coin: ";
    const coins = Object.entries(
      research.perCoinSentiment as Record<string, any>
    );
    context += coins
      .map(
        ([coin, data]: [string, any]) =>
          `${coin} ${data.sentiment} (${data.news_count} headlines)`
      )
      .join(", ");
    context += "\n";
  }

  context += `Recommended Bias: ${research.recommendedBias}\n`;
  context +=
    "\nNOTE: Sentiment informs position sizing and risk appetite. Technical signals remain primary trade triggers.\n";

  return context;
}

// =============================================================================
// ALPHA ARENA OUTPUT PARSER
// =============================================================================

import { ParserWarning, createWarning } from "../parsers/parserWarnings";

export interface AlphaArenaDecision {
  signal: "hold" | "close" | "entry";
  side?: "long" | "short";
  leverage?: number;
  size_usd?: number;
  stop_loss?: number;
  take_profit?: number;
  invalidation_condition?: string;
  confidence?: number;
  reason?: string;
}

export interface AlphaArenaOutput {
  thinking: string;
  decisions: Record<string, AlphaArenaDecision>;
}

export interface AlphaArenaLegacyDecision {
  decision: "HOLD" | "CLOSE" | "OPEN_LONG" | "OPEN_SHORT";
  symbol: string | null;
  confidence: number;
  reasoning: string;
  leverage?: number;
  size_usd?: number;
  stop_loss?: number;
  take_profit?: number;
  invalidation_condition?: string;
}

/**
 * Convert a single Alpha Arena decision entry to legacy format
 */
function toLegacyDecision(
  symbol: string,
  dec: AlphaArenaDecision,
  thinking: string
): AlphaArenaLegacyDecision {
  // Use reason if it's substantive (not a placeholder like "...")
  const reason = dec.reason && dec.reason.length > 10 && !/^\.{2,}$/.test(dec.reason.trim())
    ? dec.reason : undefined;
  const validReasoning = reason || (thinking && thinking.length > 10 ? thinking : undefined)
    || `${dec.signal} ${symbol}`;

  if (dec.signal === "entry") {
    return {
      decision: dec.side === "long" ? "OPEN_LONG" : "OPEN_SHORT",
      symbol,
      confidence: dec.confidence || 0.7,
      reasoning: validReasoning,
      leverage: dec.leverage,
      size_usd: dec.size_usd,
      stop_loss: dec.stop_loss,
      take_profit: dec.take_profit,
      invalidation_condition: dec.invalidation_condition,
    };
  }
  // close
  return {
    decision: "CLOSE",
    symbol,
    confidence: dec.confidence || 0.9,
    reasoning: validReasoning,
  };
}

/**
 * Parse Alpha Arena style output and convert to legacy format for execution.
 * Backward-compatible: returns only the primary decision.
 */
export function parseAlphaArenaOutput(output: AlphaArenaOutput): AlphaArenaLegacyDecision {
  const { decision } = parseAlphaArenaOutputWithWarnings(output);
  return decision;
}

/**
 * Parse Alpha Arena style output, selecting the highest-confidence actionable
 * decision and tracking any dropped decisions as warnings.
 */
export function parseAlphaArenaOutputWithWarnings(output: AlphaArenaOutput): {
  decision: AlphaArenaLegacyDecision;
  warnings: ParserWarning[];
} {
  const warnings: ParserWarning[] = [];

  // Helper: check if thinking is a real reasoning string, not a placeholder like "..."
  const validThinking = (s: string | undefined): string | undefined =>
    s && s.length > 10 && !/^\.{2,}$/.test(s.trim()) && !/^…+$/.test(s.trim()) ? s : undefined;

  // Collect ALL actionable decisions (entries and closes)
  const actionable: { symbol: string; dec: AlphaArenaDecision }[] = [];

  if (!output.decisions || typeof output.decisions !== "object") {
    // Try to recover: some models put coin keys at the top level (e.g. { thinking, BTC: {...}, ETH: {...} })
    const VALID_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];
    const recovered: Record<string, AlphaArenaDecision> = {};
    for (const key of Object.keys(output)) {
      if (VALID_SYMBOLS.includes(key) && typeof (output as any)[key] === "object") {
        recovered[key] = (output as any)[key] as AlphaArenaDecision;
      }
    }

    if (Object.keys(recovered).length > 0) {
      console.log(`[AlphaArena Parser] Recovered ${Object.keys(recovered).length} decisions from top-level keys`);
      warnings.push(
        createWarning(
          "JSON_EXTRACTION_FALLBACK",
          `Decisions found at top-level instead of under 'decisions' key (${Object.keys(recovered).join(", ")})`
        )
      );
      output.decisions = recovered;
    } else if ((output as any).decision && typeof (output as any).decision === "string") {
      // Legacy single-decision format: { decision: "HOLD"|"OPEN_LONG"|..., confidence, symbol, ... }
      const legacy = output as any;
      const legacyDecision = String(legacy.decision).toUpperCase();
      console.log(`[AlphaArena Parser] Recovered legacy single-decision format: ${legacyDecision}`);
      warnings.push(
        createWarning(
          "LEGACY_FORMAT_RECOVERED",
          `Model returned legacy single-decision format (${legacyDecision}) instead of Alpha Arena multi-decision format`
        )
      );
      return {
        decision: {
          decision: legacyDecision as AlphaArenaLegacyDecision["decision"],
          symbol: legacy.symbol || null,
          confidence: typeof legacy.confidence === "number" ? legacy.confidence : 0.7,
          reasoning: legacy.reasoning || legacy.reason || validThinking(output.thinking) || `Legacy format: ${legacyDecision}`,
          leverage: legacy.leverage,
          size_usd: legacy.size_usd,
          stop_loss: legacy.stop_loss,
          take_profit: legacy.take_profit,
          invalidation_condition: legacy.invalidation_condition,
        },
        warnings,
      };
    } else {
      return {
        decision: {
          decision: "HOLD",
          symbol: null,
          confidence: 0.99,
          reasoning: validThinking(output.thinking) || "No decisions object in AI response — defaulting to HOLD",
        },
        warnings,
      };
    }
  }

  for (const [symbol, dec] of Object.entries(output.decisions)) {
    if (dec.signal === "entry" || dec.signal === "close") {
      actionable.push({ symbol, dec });
    }
  }

  // No actionable decisions — all hold
  if (actionable.length === 0) {
    return {
      decision: {
        decision: "HOLD",
        symbol: null,
        confidence: 0.99,
        reasoning: validThinking(output.thinking) || "All positions stable, no high-conviction entries",
      },
      warnings,
    };
  }

  // Sort by confidence descending, pick the highest
  actionable.sort((a, b) => (b.dec.confidence || 0) - (a.dec.confidence || 0));

  const primary = actionable[0];
  const dropped = actionable.slice(1);

  if (dropped.length > 0) {
    warnings.push(
      createWarning(
        "MULTIPLE_DECISIONS_DROPPED",
        `${dropped.length} additional actionable decision(s) dropped in favor of highest-confidence ${primary.symbol}`,
        dropped.map(d => ({ symbol: d.symbol, signal: d.dec.signal, confidence: d.dec.confidence })),
        { symbol: primary.symbol, signal: primary.dec.signal, confidence: primary.dec.confidence }
      )
    );
    console.log(
      `[AlphaArena Parser] Picked ${primary.symbol} (confidence ${primary.dec.confidence}), dropped ${dropped.length} other decision(s)`
    );
  }

  return {
    decision: toLegacyDecision(primary.symbol, primary.dec, output.thinking),
    warnings,
  };
}
