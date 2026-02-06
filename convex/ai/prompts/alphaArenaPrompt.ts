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
- Use LEVERAGE: 5-10x when confident in the setup
- ALWAYS set TP and SL: Every trade MUST have take-profit and stop-loss
- HOLD until TP/SL: Let the exchange handle exits - don't close manually
- Let winners run: Don't exit just because you're profitable
- Cut losers: Stop loss handles this automatically

ACCOUNT CONFIG:
- Max Leverage: {maxLeverage}x | Max Position Size: {maxPositionSize}% of account
- Per-Trade Risk: {perTradeRiskPct}% | Min Entry Confidence: {minEntryConfidence}
- Max Positions: {maxTotalPositions} total

LEVERAGE GUIDELINES:
- High confidence (0.8+): Use 7-10x leverage
- Medium confidence (0.65-0.8): Use 5-7x leverage
- Lower confidence (0.6-0.65): Use 3-5x leverage
- Below 0.6 confidence: Don't trade, HOLD

TP/SL REQUIREMENTS (MANDATORY):
- stop_loss: 2-3% from entry (tighter with higher leverage)
- take_profit: 0.65-0.8% ABOVE entry price (tight scalping - captures consistent small moves)
- invalidation_condition: Clear technical level that invalidates the thesis

IMPORTANT: We use tight take-profits because data shows price consistently moves 0.5-0.7% in our favor
shortly after entry. Capture these small wins consistently rather than waiting for bigger moves that may not come.

POSITION MANAGEMENT RULES:
1. EXISTING POSITIONS: For each open position, check:
   - Is invalidation condition triggered? -> CLOSE
   - Is stop loss hit? -> Exchange handles automatically, HOLD
   - Otherwise -> HOLD (confidence 0.99)

2. NEVER CLOSE manually just because:
   - Position is slightly negative
   - "Better opportunity" elsewhere
   - Price approaching stop loss (let exchange handle it!)
   - Want to "lock in profits" too early

3. NEW ENTRIES: Open when you see:
   - Clear trend direction with momentum
   - RSI supports direction (oversold for longs, overbought for shorts)
   - EMA alignment (price vs EMA20)
   - 4h timeframe confirms direction
   - High win rate setup (we use tight TP for consistent small wins)
   - No existing position on this symbol

ANALYSIS PROCESS (do this for EACH coin):
1. Read current indicators (price, EMA, MACD, RSI)
2. Check intraday series trend (is it accelerating or reversing?)
3. Confirm with 4h context (is 4h aligned with intraday?)
4. If you have a position: check invalidation ONLY
5. If no position: is this a good setup? Calculate TP/SL before deciding

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
Respond with ONLY valid JSON. One decision per coin. Format:
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

KEY INSIGHT: The winners used leverage aggressively (5-10x) but ALWAYS had TP/SL set.
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
  marketData: Record<string, DetailedCoinData>
): string {
  const lines: string[] = [];

  for (const [symbol, data] of Object.entries(marketData)) {
    // Calculate trend signals
    const priceVsEma20Pct = ((data.currentPrice - data.ema20) / data.ema20) * 100;
    const ema20VsEma50Pct = ((data.ema20_4h - data.ema50_4h) / data.ema50_4h) * 100;
    const priceMomentum = calculatePriceMomentum(data.priceHistory);
    const trendDirection = calculateTrendDirection(priceVsEma20Pct, ema20VsEma50Pct);
    const tradingBias = getTradingBias(trendDirection, priceMomentum);

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
// ALPHA ARENA OUTPUT PARSER
// =============================================================================

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

/**
 * Parse Alpha Arena style output and convert to legacy format for execution
 */
export function parseAlphaArenaOutput(output: AlphaArenaOutput): {
  decision: "HOLD" | "CLOSE" | "OPEN_LONG" | "OPEN_SHORT";
  symbol: string | null;
  confidence: number;
  reasoning: string;
  leverage?: number;
  size_usd?: number;
  stop_loss?: number;
  take_profit?: number;
  invalidation_condition?: string;
} {
  // Find the first actionable decision (not hold)
  for (const [symbol, dec] of Object.entries(output.decisions)) {
    if (dec.signal === "entry") {
      return {
        decision: dec.side === "long" ? "OPEN_LONG" : "OPEN_SHORT",
        symbol,
        confidence: dec.confidence || 0.7,
        reasoning: dec.reason || output.thinking,
        leverage: dec.leverage,
        size_usd: dec.size_usd,
        stop_loss: dec.stop_loss,
        take_profit: dec.take_profit,
        invalidation_condition: dec.invalidation_condition,
      };
    }
    if (dec.signal === "close") {
      return {
        decision: "CLOSE",
        symbol,
        confidence: 0.9,
        reasoning: dec.reason || output.thinking,
      };
    }
  }

  // All hold - return generic HOLD
  return {
    decision: "HOLD",
    symbol: null,
    confidence: 0.99,
    reasoning: output.thinking || "All positions stable, no high-conviction entries",
  };
}
