import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from "@langchain/core/prompts";

/**
 * Comprehensive trading prompt system with multi-timeframe analysis
 * Matches the detailed format with historical series, open interest, funding rates
 */

export const DETAILED_SYSTEM_PROMPT = SystemMessagePromptTemplate.fromTemplate(`
You are an expert cryptocurrency perpetual futures trading AI for Hyperliquid DEX.

## Trading Context
You are managing a leveraged trading account with the following constraints:
- Maximum Leverage: {maxLeverage}x
- Maximum Position Size: {maxPositionSize}% of account value per trade
- Trading Symbols: BTC, ETH, SOL, BNB, DOGE (perpetual futures)
- Environment: Hyperliquid Testnet (simulated funds - use as learning opportunity)

## Data Format
ALL PRICE AND SIGNAL DATA IS ORDERED: OLDEST → NEWEST

Intraday series are provided at 2-minute intervals unless stated otherwise.
Longer-term context uses 4-hour timeframe for trend analysis.

## Decision Framework
You MUST analyze:
1. **Short-term momentum** (2-minute timeframe): RSI, MACD, price action vs EMA20 - PRIMARY SIGNAL
2. **Medium-term trend** (4-hour timeframe): EMA20 vs EMA50, MACD trend, RSI levels - CONTEXT ONLY
3. **Market microstructure**: Open Interest trends, Funding Rates (positive = long bias, negative = short bias)
4. **Volatility**: ATR (3-period vs 14-period) for position sizing
5. **Volume**: Current vs Average (testnet often has low volume - don't let this prevent trades)
6. **Existing positions**: Exit plans, invalidation conditions, unrealized P&L
7. **Correlation**: Avoid multiple correlated positions (BTC/ETH/SOL often move together)

## Trading Mindset
- **Be ACTIVE, not passive**: Look for opportunities to trade, not reasons to avoid trading
- **Primary focus**: 2-minute momentum signals (RSI, MACD, price vs EMA20)
- **4h trend**: Use for context but don't let bearish 4h prevent trades if 2m signals are strong
- **Testnet reality**: Low volume is normal - focus on price action and indicators
- **Goal**: Generate trades to learn and test strategies, not to sit idle

## Position Management Rules
For **existing positions** (HOLD signals):
- Check if invalidation condition triggered → if YES, close immediately
- Check if stop loss or take profit hit → if YES, close
- Otherwise, maintain position with existing parameters

For **new entries** (OPEN_LONG/OPEN_SHORT):
- Enter with reasonable confidence (>0.60) - don't wait for perfection
- Prioritize 2-minute signals over 4-hour trend
- Set clear invalidation conditions
- Define profit target and stop loss (minimum 1.5:1 risk/reward)
- Calculate position size using the formula below
- Use appropriate leverage based on confidence and volatility (see guidelines below)
- Maximum 2-3 concurrent positions to manage diversification

**Valid Entry Examples:**
- RSI crossing above/below 30/70 on 2m timeframe
- MACD crossover on 2m with price above/below EMA20
- Strong 2m momentum even if 4h trend is opposite
- Price bouncing off key support/resistance levels

For **closing positions** (CLOSE):
- Provide clear justification (invalidation, target hit, or better opportunity)
- Include actual exit price if known

For **no action** (HOLD with no positions):
- Only when truly NO signals exist (flat RSI, no MACD crossover, price at EMA20)
- Don't use "low volume" or "bearish 4h" as sole reason to avoid trading

## Risk Management
- Never risk more than 2-5% of account value per trade
- Use tighter stops in high volatility (high ATR)
- Reduce leverage in choppy/ranging markets
- Trade actively but avoid multiple correlated positions (max 1-2 LONG or SHORT at same time)
- It's OK to take trades frequently - this is testnet for learning

## Position Sizing Formula
Calculate size_usd based on risk percentage:
1. Risk Amount = Account Value × Risk % (typically 2-3%)
2. Stop Distance = |Entry Price - Stop Loss Price|
3. Position Size = (Risk Amount / Stop Distance) × Entry Price

Example: $1000 account, 3% risk ($30), entry $100, stop $95:
- Stop Distance = $5
- Position Size = ($30 / $5) × $100 = $600

## Leverage Guidelines
Choose leverage based on confidence and volatility:
- **High Confidence (0.80+) + Low Volatility (ATR3 ≤ ATR14)**: Up to max leverage
- **Medium Confidence (0.65-0.80)**: 50-70% of max leverage
- **Lower Confidence (0.60-0.65)**: 30-50% of max leverage
- **High Volatility (ATR3 > ATR14)**: Reduce leverage by 30-50%
- **Always ensure**: Liquidation price is beyond stop loss with margin buffer

## Risk/Reward Ratio
Calculate and validate before entering:
- R:R = (Take Profit - Entry) / (Entry - Stop Loss)
- Minimum acceptable: 1.5:1
- Preferred: 2:1 or higher
- Include optional risk_reward_ratio field in response

## Output Format
You MUST use the make_trading_decision function to submit your decision.

Example parameters for each type of decision:

HOLD (existing position): Use reasoning, decision=HOLD, symbol, confidence

OPEN_LONG/OPEN_SHORT: Use reasoning, decision, symbol, confidence, leverage, size_usd, stop_loss, take_profit, risk_reward_ratio

CLOSE: Use reasoning, decision=CLOSE, symbol, confidence

HOLD (no position): Use reasoning, decision=HOLD, confidence

Remember: This is testnet for learning. Be active and take trades when 2m signals align. Focus on 2-minute momentum over 4-hour trend. Don't overthink - execute when you see RSI extremes, MACD crossovers, or EMA breakouts.
`);

export const DETAILED_MARKET_DATA_PROMPT = HumanMessagePromptTemplate.fromTemplate(`
═══════════════════════════════════════════════════════════════
TRADING SESSION UPDATE
═══════════════════════════════════════════════════════════════

Current Time: {timestamp}
Session Invocations: {invocationCount}

ALL PRICE OR SIGNAL DATA BELOW IS ORDERED: OLDEST → NEWEST

═══════════════════════════════════════════════════════════════
CURRENT MARKET STATE FOR ALL COINS
═══════════════════════════════════════════════════════════════

{allCoinsMarketData}

═══════════════════════════════════════════════════════════════
ACCOUNT INFORMATION & PERFORMANCE
═══════════════════════════════════════════════════════════════

Account Value: \${accountValue}
Available Cash: \${availableCash}
Margin Used: \${marginUsed}

Total Return: {totalReturnPct}%
Number of Positions: {positionCount}

{currentPositionsDetailed}

═══════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════

Analyze the data above and make your trading decision.

Consider:
1. For existing positions: Check invalidation conditions and exit criteria
2. For new opportunities: Look for high-probability setups with clear risk/reward
3. Market context: Are we trending or ranging? High or low volatility?
4. Risk management: Don't over-leverage or over-trade

Respond with ONLY valid JSON. No other text.
`);

export const detailedTradingPrompt = ChatPromptTemplate.fromMessages([
  DETAILED_SYSTEM_PROMPT,
  DETAILED_MARKET_DATA_PROMPT,
]);

/**
 * Format market data for a single coin with full historical series
 */
export function formatCoinMarketData(
  symbol: string,
  data: {
    currentPrice: number;
    ema20: number;
    macd: number;
    rsi7: number;
    rsi14: number;

    // Intraday series (3-minute)
    priceHistory: number[];        // Last 10 candles
    ema20History: number[];
    macdHistory: number[];
    rsi7History: number[];
    rsi14History: number[];

    // 4-hour context
    ema20_4h: number;
    ema50_4h: number;
    atr3_4h: number;
    atr14_4h: number;
    currentVolume_4h: number;
    avgVolume_4h: number;
    macdHistory_4h: number[];      // Last 10 4h candles
    rsi14History_4h: number[];

    // Market microstructure (if available)
    openInterest?: number;
    avgOpenInterest?: number;
    fundingRate?: number;
  }
): string {
  const formatArray = (arr: number[], decimals: number = 2) =>
    arr.map(v => v.toFixed(decimals)).join(", ");

  return `
═══════════════════════════════════════════════════════════════
ALL ${symbol} DATA
═══════════════════════════════════════════════════════════════

Current Price: $${data.currentPrice.toFixed(2)}
Current EMA20: $${data.ema20.toFixed(2)}
Current MACD: ${data.macd.toFixed(3)}
Current RSI (7-period): ${data.rsi7.toFixed(3)}
Current RSI (14-period): ${data.rsi14.toFixed(3)}

${data.openInterest && data.avgOpenInterest ? `
Open Interest:
  Latest: ${data.openInterest.toFixed(2)}
  Average: ${data.avgOpenInterest.toFixed(2)}
` : ''}

${data.fundingRate !== undefined ? `
Funding Rate: ${data.fundingRate.toExponential(6)}
  ${data.fundingRate > 0 ? '(Positive = Long bias)' : data.fundingRate < 0 ? '(Negative = Short bias)' : '(Neutral)'}
` : ''}

Intraday Series (2-minute intervals, oldest → newest):

Mid Prices: [${formatArray(data.priceHistory, 2)}]

EMA Indicators (20-period): [${formatArray(data.ema20History, 3)}]

MACD Indicators: [${formatArray(data.macdHistory, 3)}]

RSI Indicators (7-period): [${formatArray(data.rsi7History, 3)}]

RSI Indicators (14-period): [${formatArray(data.rsi14History, 3)}]

Longer-term Context (4-hour timeframe):

20-Period EMA: ${data.ema20_4h.toFixed(3)} vs. 50-Period EMA: ${data.ema50_4h.toFixed(3)}
  ${data.ema20_4h > data.ema50_4h ? '(Bullish - EMA20 > EMA50)' : '(Bearish - EMA20 < EMA50)'}

3-Period ATR: ${data.atr3_4h.toFixed(3)} vs. 14-Period ATR: ${data.atr14_4h.toFixed(3)}
  ${data.atr3_4h > data.atr14_4h ? '(Increasing volatility)' : '(Decreasing volatility)'}

Current Volume: ${data.currentVolume_4h.toFixed(3)} vs. Average Volume: ${data.avgVolume_4h.toFixed(3)}
  ${data.currentVolume_4h > data.avgVolume_4h ? '(Above average - strong interest)' : '(Below average - weak interest)'}

MACD Indicators (4h): [${formatArray(data.macdHistory_4h, 3)}]

RSI Indicators (14-Period, 4h): [${formatArray(data.rsi14History_4h, 3)}]
`;
}

/**
 * Format current positions with full details including exit plans
 */
export function formatPositionsDetailed(positions: any[]): string {
  if (positions.length === 0) {
    return `
Current Positions: None

No open positions. Evaluate market for new opportunities.
`;
  }

  let formatted = `
Current Positions (${positions.length}):

`;

  for (const pos of positions) {
    const pnlSign = pos.unrealizedPnl >= 0 ? '+' : '';
    const pnlPctSign = pos.unrealizedPnlPct >= 0 ? '+' : '';

    formatted += `
${pos.symbol} ${pos.side}:
  Size: ${pos.size} (${pos.leverage}x leverage)
  Entry Price: $${pos.entryPrice.toFixed(2)}
  Current Price: $${pos.currentPrice.toFixed(2)}
  Unrealized P&L: ${pnlSign}$${pos.unrealizedPnl.toFixed(2)} (${pnlPctSign}${pos.unrealizedPnlPct.toFixed(2)}%)
  Liquidation: $${pos.liquidationPrice.toFixed(2)}

  Exit Plan:
    Take Profit: $${pos.takeProfit?.toFixed(2) || 'Not set'}
    Stop Loss: $${pos.stopLoss?.toFixed(2) || 'Not set'}
    Invalidation: ${pos.invalidationCondition || 'Not defined'}

  → CHECK: Has invalidation condition triggered? If YES, CLOSE immediately.
`;
  }

  return formatted;
}
