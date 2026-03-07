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
type AllowedActionLabel = "HOLD_ONLY" | "HOLD_OR_LONG" | "HOLD_OR_SHORT" | "BIDIRECTIONAL";

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

export interface AlphaArenaRegimePromptConfig {
  enableRegimeFilter?: boolean;
  require1hAlignment?: boolean;
  redDayLongBlockPct?: number;
  greenDayShortBlockPct?: number;
}

function describeTrendContext(trendDirection: TrendDirection, momentum: PriceMomentum): string {
  if (trendDirection === "BULLISH" && momentum === "RISING") return "Context: bullish trend with rising intraday momentum";
  if (trendDirection === "BULLISH" && momentum === "FLAT") return "Context: bullish trend but intraday momentum is flat";
  if (trendDirection === "BULLISH" && momentum === "FALLING") return "Context: bullish higher timeframe, but intraday momentum is fading";
  if (trendDirection === "BEARISH" && momentum === "FALLING") return "Context: bearish trend with falling intraday momentum";
  if (trendDirection === "BEARISH" && momentum === "FLAT") return "Context: bearish trend but intraday momentum is flat";
  if (trendDirection === "BEARISH" && momentum === "RISING") return "Context: bearish higher timeframe, but intraday momentum is rebounding";
  return "Context: mixed regime, no directional edge";
}

function buildRuntimeConstraints(
  data: DetailedCoinData,
  regimeConfig: AlphaArenaRegimePromptConfig = {}
): {
  longAllowed: boolean;
  shortAllowed: boolean;
  longReason: string;
  shortReason: string;
  allowedActions: AllowedActionLabel;
} {
  const enableRegimeFilter = regimeConfig.enableRegimeFilter ?? true;
  const require1hAlignment = regimeConfig.require1hAlignment ?? true;
  const redDayLongBlockPct = regimeConfig.redDayLongBlockPct ?? -1.5;
  const greenDayShortBlockPct = regimeConfig.greenDayShortBlockPct ?? 1.5;

  if (!enableRegimeFilter) {
    return {
      longAllowed: true,
      shortAllowed: true,
      longReason: "ALLOWED - regime filter disabled",
      shortReason: "ALLOWED - regime filter disabled",
      allowedActions: "BIDIRECTIONAL",
    };
  }

  const priceVsEma20Pct = ((data.currentPrice - data.ema20) / data.ema20) * 100;
  const priceMomentum = calculatePriceMomentum(data.priceHistory);

  let longAllowed = true;
  let shortAllowed = true;
  let longReason = "ALLOWED";
  let shortReason = "ALLOWED";

  if (priceVsEma20Pct < -0.3 && priceMomentum === "FALLING") {
    longAllowed = false;
    longReason = `FORBIDDEN - price is ${priceVsEma20Pct.toFixed(2)}% below EMA20 with falling momentum`;
  } else if (require1hAlignment && data.ema20_1h < data.ema50_1h) {
    longAllowed = false;
    longReason = "FORBIDDEN - 1h EMA20 is below EMA50";
  } else {
    const hasBullishRecovery = data.ema20_1h >= data.ema50_1h && priceMomentum !== "FALLING";
    if (data.dayChangePct <= redDayLongBlockPct && !hasBullishRecovery) {
      longAllowed = false;
      longReason = `FORBIDDEN - red session (${data.dayChangePct.toFixed(2)}%) without bullish 1h/intraday recovery`;
    }
  }

  if (priceVsEma20Pct > 0.3 && priceMomentum === "RISING") {
    shortAllowed = false;
    shortReason = `FORBIDDEN - price is ${priceVsEma20Pct.toFixed(2)}% above EMA20 with rising momentum`;
  } else if (require1hAlignment && data.ema20_1h > data.ema50_1h) {
    shortAllowed = false;
    shortReason = "FORBIDDEN - 1h EMA20 is above EMA50";
  } else {
    const hasBearishRecovery = data.ema20_1h <= data.ema50_1h && priceMomentum !== "RISING";
    if (data.dayChangePct >= greenDayShortBlockPct && !hasBearishRecovery) {
      shortAllowed = false;
      shortReason = `FORBIDDEN - green session (${data.dayChangePct.toFixed(2)}%) without bearish 1h/intraday rollover`;
    }
  }

  let allowedActions: AllowedActionLabel = "BIDIRECTIONAL";
  if (!longAllowed && !shortAllowed) allowedActions = "HOLD_ONLY";
  else if (longAllowed && !shortAllowed) allowedActions = "HOLD_OR_LONG";
  else if (!longAllowed && shortAllowed) allowedActions = "HOLD_OR_SHORT";

  return {
    longAllowed,
    shortAllowed,
    longReason,
    shortReason,
    allowedActions,
  };
}

/**
 * Alpha Arena-style trading prompt with a single-decision contract.
 *
 * Key principles:
 * - Use leverage only when regime and momentum align
 * - Always set TP and SL on every new trade
 * - HOLD on mixed or low-conviction conditions
 * - Treat long and short setups symmetrically
 */

// =============================================================================
// SYSTEM PROMPT - Alpha Arena Style
// =============================================================================

export const ALPHA_ARENA_SYSTEM_PROMPT = SystemMessagePromptTemplate.fromTemplate(`
You are an autonomous crypto trading AI for Hyperliquid DEX perpetual futures.
Your goal is PROFITABILITY through leveraged trading with strict TP/SL discipline.

TRADING DISCIPLINE:
- Use LEVERAGE only when the setup is aligned across regime and momentum
- ALWAYS set TP and SL: Every trade MUST have take-profit and stop-loss
- Default is HOLD when signals are mixed
- Protect winners: If profitable (>=+1%) and momentum reverses, close to lock in gains
- Let stop loss handle losers — do not invent discretionary exits at breakeven

ACCOUNT CONFIG:
- Max Leverage: {maxLeverage}x | Max Position Size: {maxPositionSize}% of account
- Per-Trade Risk: {perTradeRiskPct}% | Min Entry Confidence: {minEntryConfidence}
- Max Positions: {maxTotalPositions} total | Trading Mode: {tradingModeDescription}
- {managedExitGuidance}

TP/SL REQUIREMENTS (ATR-BASED — MANDATORY):
- stop_loss: {stopLossAtrMultiplier}x ATR(14,4h) from entry
- take_profit: {takeProfitAtrMultiplier}x ATR(14,4h) from entry when managed exits are disabled
- Minimum R:R ratio: {minRiskRewardRatio}:1 (NEVER trade below this)
- Each coin's [SUGGESTED ZONES] shows pre-calculated $ levels — USE THEM
- invalidation_condition: Clear technical level that invalidates the thesis

POSITION SIZING (MANDATORY FORMULA):
- size_usd = (Available Cash × {perTradeRiskPct}%) / stopDistancePct
- Stop Distance % = |entry - stop_loss| / entry
- Minimum size: {minimumPositionSize} USD (floor — NEVER go below this)
- Typical range: {typicalPositionSize} – {maxPositionSizeUsd} USD
- Example: Cash risk {riskAmountExample} USD at 1.5% stop → size_usd = {sizingExample} USD
- If formula gives < minimum, USE the minimum
- If formula gives > max, CAP at max

LOSS CONTEXT:
- Consecutive losses: {consecutiveLosses} / {consecutiveLossLimit}
- {lossStreakStatus}
- After hitting loss limit: reduce risk to {perTradeRiskPct}% × 0.75 until 1 win

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
⚠️ CRITICAL: Closing at breakeven or small loss DESTROYS profitability.
The winning strategies let TP/SL handle most exits. Only close manually to PROTECT PROFITS.

1. EXISTING POSITIONS — DEFAULT IS ALWAYS "hold":
   - TP and SL are already placed on the exchange as trigger orders
   - If a position shows MANAGED_EXIT, the system controls the stop mechanically and you must never close it manually
   - The exchange will automatically close the position when TP or SL is hit
   - Your default action is "hold" unless rule 2 applies.
   - Intraday momentum shifts (RISING/FALLING) are NOISE at breakeven — they flip every few minutes.

2. VALID REASONS TO CLOSE MANUALLY (ALL conditions must be true):
   a) The position is PROFITABLE with unrealized P&L >= +1.0%
   b) Price has moved significantly toward TP (at least 50% of the way)
   c) Momentum is now clearly reversing against the position (e.g., RISING -> FALLING for longs)
   → In this case, closing to LOCK IN GAINS is smart. Don't let a winner turn into a loser.

   OR: The LEGACY position has NO stop-loss or take-profit orders (shown as "Not set" in position data)
   → Close to protect capital.

3. DO NOT CLOSE for any of these reasons:
   - Position is at BREAKEVEN or small loss (P&L near 0%) — let TP/SL play out
   - Position is slightly negative — this is normal, SL will handle it
   - Momentum shifted but position is NOT profitable — this is noise, not a signal
   - Price approaching stop loss — let the exchange handle it
   - "Better opportunity" elsewhere — current trade is still valid
   - You feel uncertain — uncertainty is not a reason to close
   - NEVER close at $0 P&L. Either let it hit TP (profit) or SL (small loss).

4. NEW ENTRIES: Open when you see:
   - Clear trend direction with momentum
   - 1h context supports the trade direction
   - Session regime is not fighting the trade direction
   - RSI supports direction (oversold for longs, overbought for shorts)
   - EMA alignment (price vs EMA20)
   - 4h timeframe confirms direction
   - R:R ratio meets minimum {minRiskRewardRatio}:1
   - No existing position on this symbol

ANALYSIS PROCESS (do this for EACH coin):
1. Read current indicators (price, EMA, MACD, RSI)
2. Read [RUNTIME CONSTRAINTS] and obey them exactly
3. Check intraday series trend (is it accelerating or reversing?)
4. Check 1h context and current session direction (green/red day)
5. Confirm with 4h context
6. Check [SUGGESTED ZONES] for pre-calculated ATR-based TP/SL levels
7. If you have a position: check P&L. If profitable (>=+1%) and momentum reversing, consider closing to lock gains. If at breakeven or negative, output "hold" — let TP/SL handle it.
8. If no position: is this a good setup? Verify R:R meets {minRiskRewardRatio}:1 before deciding

MANDATORY TREND-FOLLOWING RULES:
1. LONG entries ONLY when:
   - Price is ABOVE EMA20 (or within 0.3% after a bounce)
   - Price momentum is RISING or FLAT (NOT FALLING)
   - 1h trend is not bearish
   - 4h trend preferably BULLISH

2. SHORT entries ONLY when:
   - Price is BELOW EMA20 (or within 0.3% after rejection)
   - Price momentum is FALLING or FLAT (NOT RISING)
   - 1h trend is not bullish
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
CRITICAL: Your entire response must be a single valid JSON object. Do NOT write any text, explanations, or markdown before or after the JSON. No prose, no commentary — ONLY JSON. Return exactly ONE portfolio-level decision for the account. Format:
{{
  "decision": "HOLD" | "CLOSE" | "OPEN_LONG" | "OPEN_SHORT",
  "symbol": "BTC" | "ETH" | "SOL" | "BNB" | "DOGE" | "XRP" | null,
  "confidence": 0.0-1.0,
  "leverage": 1-{{maxLeverage}},
  "size_usd": 50-{{maxPositionSizeUsd}},
  "stop_loss": 0,
  "take_profit": 0,
  "invalidation_condition": "Reason the setup is invalid",
  "reasoning": "Brief but concrete explanation grounded in intraday, 1h, session, and 4h context"
}}

RULES:
- HOLD: Use when signals are mixed, regime is hostile, or no high-conviction setup exists
- CLOSE: Only for an existing profitable position with reversal, or when TP/SL are missing
- OPEN_LONG / OPEN_SHORT: Use only for one best setup in the entire account
- The [RUNTIME CONSTRAINTS] section is authoritative. If LONG is marked FORBIDDEN for a symbol, NEVER return OPEN_LONG for that symbol. Same for shorts.
- If a symbol says ONLY HOLD OR SHORT, then OPEN_LONG is invalid. If it says ONLY HOLD OR LONG, then OPEN_SHORT is invalid.
- If all candidate entries are forbidden by runtime constraints, return HOLD.
- symbol must be null for HOLD when no specific position is targeted
- When managed exits are enabled, OPEN decisions may omit take_profit or set it to null
- For HOLD or CLOSE, omit leverage/size_usd/stop_loss/take_profit unless needed

If regime is mixed or you are choosing between a weak long and a weak short, return HOLD.
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

###[POSITION SIZING GUIDE]
Minimum Position Size: {minimumPositionSize} USD
Typical Position Range: {typicalPositionSize} – {maxPositionSizeUsd} USD
Risk Amount ({perTradeRiskPct}% of cash): {riskAmountExample} USD
Example: At 1.5% stop distance → size_usd = {sizingExample} USD
Consecutive Losses: {consecutiveLosses} / {consecutiveLossLimit}
Loss Streak Status: {lossStreakStatus}
⚠️ NEVER set size_usd below {minimumPositionSize}. Use the formula above.

###[CURRENT OPEN POSITIONS - FROM EXCHANGE]
⚠️ IMPORTANT: These are REAL positions currently open on Hyperliquid. Do NOT open new positions on symbols you already have!

{positionsSection}

###[SYMBOLS WITH OPEN POSITIONS]
{openPositionSymbols}

{sentimentContext}
---
CRITICAL RULES:
1. If position is at BREAKEVEN or NEGATIVE P&L: output "hold" — let TP/SL handle exit
2. If position is PROFITABLE (>=+1%) and momentum reversing: you MAY output "close" to lock gains
3. If position has NO TP/SL set: you MAY output "close" to protect capital
4. You can ONLY output "entry" for symbols where you have NO position
5. Check the [CURRENT OPEN POSITIONS] section above before making any decision
6. NEVER close a position at $0 P&L — this destroys returns

For existing positions: default is "hold". Only close if profitable with reversal, or TP/SL missing.
For potential entries: calculate TP/SL and R:R ratio before deciding.
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
  rrRatio: number = 2.0,
  regimeConfig: AlphaArenaRegimePromptConfig = {}
): string {
  const lines: string[] = [];
  const tpAtrMultiplier = slAtrMultiplier * rrRatio;

  for (const [symbol, data] of Object.entries(marketData)) {
    // Calculate trend signals
    const priceVsEma20Pct = ((data.currentPrice - data.ema20) / data.ema20) * 100;
    const ema20VsEma50Pct = ((data.ema20_4h - data.ema50_4h) / data.ema50_4h) * 100;
    const priceMomentum = calculatePriceMomentum(data.priceHistory);
    const trendDirection = calculateTrendDirection(priceVsEma20Pct, ema20VsEma50Pct);
    const trendContext = describeTrendContext(trendDirection, priceMomentum);
    const runtimeConstraints = buildRuntimeConstraints(data, regimeConfig);

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
    lines.push(`${trendContext}`);
    lines.push(`[RUNTIME CONSTRAINTS - AUTHORITATIVE]`);
    lines.push(`Allowed Actions: ${runtimeConstraints.allowedActions === "HOLD_ONLY"
      ? "ONLY HOLD"
      : runtimeConstraints.allowedActions === "HOLD_OR_LONG"
      ? "ONLY HOLD OR OPEN_LONG"
      : runtimeConstraints.allowedActions === "HOLD_OR_SHORT"
      ? "ONLY HOLD OR OPEN_SHORT"
      : "OPEN_LONG or OPEN_SHORT allowed if the rest of the setup is strong"}`);
    lines.push(`LONG: ${runtimeConstraints.longReason}`);
    lines.push(`SHORT: ${runtimeConstraints.shortReason}`);
    lines.push(``);
    lines.push(`Current Price: $${data.currentPrice.toFixed(2)}`);
    lines.push(`EMA20: $${data.ema20.toFixed(2)} (last: [${data.ema20History.slice(-5).map(v => v.toFixed(2)).join(", ")}])`);
    lines.push(`MACD: ${data.macd.toFixed(4)} (last: [${data.macdHistory.slice(-5).map(v => v.toFixed(4)).join(", ")}])`);
    lines.push(`RSI_7: ${data.rsi7.toFixed(1)} (last: [${data.rsi7History.slice(-5).map(v => v.toFixed(1)).join(", ")}])`);
    lines.push(`RSI_14: ${data.rsi14.toFixed(1)} (last: [${data.rsi14History.slice(-5).map(v => v.toFixed(1)).join(", ")}])`);
    lines.push(``);
    lines.push(`[1h Context]`);
    lines.push(`EMA20 vs EMA50: ${data.ema20_1h > data.ema50_1h ? "BULLISH" : "BEARISH"} (EMA20: $${data.ema20_1h.toFixed(2)}, EMA50: $${data.ema50_1h.toFixed(2)})`);
    lines.push(`1h Closes: [${data.priceHistory_1h.slice(-5).map(v => v.toFixed(2)).join(", ")}]`);
    lines.push(``);
    lines.push(`[4h Context]`);
    lines.push(`EMA20 vs EMA50: ${data.ema20_4h > data.ema50_4h ? "BULLISH" : "BEARISH"} (EMA20: $${data.ema20_4h.toFixed(2)}, EMA50: $${data.ema50_4h.toFixed(2)})`);
    lines.push(`ATR(3): ${data.atr3_4h.toFixed(2)} | ATR(14): ${data.atr14_4h.toFixed(2)}`);
    lines.push(`Volume: ${data.currentVolume_4h.toFixed(0)} (avg: ${data.avgVolume_4h.toFixed(0)}, ratio: ${data.volumeRatio.toFixed(2)}x)`);
    lines.push(`24h Range: $${data.low24h.toFixed(2)} - $${data.high24h.toFixed(2)}`);
    lines.push(`Session Open: $${data.dayOpen.toFixed(2)} | Session Change: ${data.dayChangePct >= 0 ? "+" : ""}${data.dayChangePct.toFixed(2)}%`);

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
    const isManagedExit = pos.exitMode === "managed_scalp_v2";
    const displayedStop = pos.managedStopPrice ?? pos.stopLoss;

    // Calculate hold duration
    let holdDurationStr = "Unknown";
    if (pos.openedAt) {
      const holdMs = Date.now() - pos.openedAt;
      const holdHours = Math.floor(holdMs / (1000 * 60 * 60));
      const holdMinutes = Math.floor((holdMs % (1000 * 60 * 60)) / (1000 * 60));
      holdDurationStr = holdHours > 0 ? `${holdHours}h ${holdMinutes}m` : `${holdMinutes}m`;
    }

    // Check if TP/SL are set
    const hasTpSl = pos.takeProfit && pos.stopLoss;
    const tpSlStatus = isManagedExit
      ? "MANAGED_EXIT ACTIVE → output 'hold'"
      : hasTpSl
        ? "TP/SL SET ON EXCHANGE → output 'hold'"
        : "⚠️ TP/SL MISSING — consider closing to protect capital";

    lines.push(`═══ ${pos.symbol} - ${pos.side} POSITION ═══`);
    lines.push(`⚡ Action Required: ${tpSlStatus}`);
    lines.push(`Hold Duration: ${holdDurationStr}`);
    lines.push(`Position Size: $${pos.size?.toFixed(2) || "N/A"} USD`);
    lines.push(`Leverage: ${pos.leverage}x`);
    lines.push(`Entry Price: $${pos.entryPrice?.toFixed(2) || "N/A"}`);
    lines.push(`Current Price: $${pos.currentPrice?.toFixed(2) || "N/A"}`);
    lines.push(`Unrealized PnL: ${pnlSign}$${pos.unrealizedPnl?.toFixed(2) || "0.00"} (${pnlPctSign}${pos.unrealizedPnlPct?.toFixed(2) || "0.00"}%)`);
    lines.push(`Liquidation Price: $${pos.liquidationPrice?.toFixed(2) || "N/A"}`);
    // Calculate distance to TP/SL as percentage from current price
    let tpLine = isManagedExit
      ? `  take_profit: System-managed exit (no fixed TP)`
      : `  take_profit: ${pos.takeProfit ? `$${pos.takeProfit.toFixed(2)}` : "Not set"}`;
    let slLine = `  stop_loss: ${displayedStop ? `$${displayedStop.toFixed(2)}` : "Not set"}`;

    if (!isManagedExit && pos.takeProfit && pos.currentPrice) {
      const tpDistPct = ((pos.takeProfit - pos.currentPrice) / pos.currentPrice * 100);
      const tpProgressPct = pos.entryPrice
        ? Math.abs((pos.currentPrice - pos.entryPrice) / (pos.takeProfit - pos.entryPrice)) * 100
        : 0;
      tpLine += ` (${tpDistPct >= 0 ? "+" : ""}${tpDistPct.toFixed(2)}% away, ${tpProgressPct.toFixed(0)}% of the way to TP)`;
    }
    if (displayedStop && pos.currentPrice) {
      const slDistPct = ((displayedStop - pos.currentPrice) / pos.currentPrice * 100);
      slLine += ` (${slDistPct >= 0 ? "+" : ""}${slDistPct.toFixed(2)}% away)`;
    }

    lines.push(`Exit Plan:`);
    if (isManagedExit) {
      lines.push(`  exit_mode: MANAGED_EXIT`);
    }
    lines.push(tpLine);
    lines.push(slLine);
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
      // Canonical single-decision format: { decision: "HOLD"|"OPEN_LONG"|..., confidence, symbol, ... }
      const legacy = output as any;
      const legacyDecision = String(legacy.decision).toUpperCase();
      console.log(`[AlphaArena Parser] Parsed single-decision format: ${legacyDecision}`);
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
