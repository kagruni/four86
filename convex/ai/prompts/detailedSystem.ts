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
- Trading Symbols: BTC, ETH, SOL, BNB, DOGE, XRP (perpetual futures)
- Environment: Hyperliquid Testnet (simulated funds - use as learning opportunity)

## Data Format
ALL PRICE AND SIGNAL DATA IS ORDERED: OLDEST → NEWEST

Intraday series are provided at 2-minute intervals unless stated otherwise.
Longer-term context uses 4-hour timeframe for trend analysis.

## Decision Framework
You MUST analyze:
1. **Short-term momentum** (2-minute timeframe): RSI, MACD, price action vs EMA20
2. **Medium-term trend** (4-hour timeframe): EMA20 vs EMA50, MACD trend, RSI levels
3. **Market microstructure**: Open Interest trends, Funding Rates (positive = long bias, negative = short bias)
4. **Volatility**: ATR (3-period vs 14-period) for position sizing
5. **Volume**: Current vs Average (high volume = strong moves)
6. **Existing positions**: Exit plans, invalidation conditions, unrealized P&L
7. **Correlation**: Avoid multiple correlated positions (BTC/ETH/SOL often move together)

## Position Management Rules
For **existing positions** (HOLD signals):
- Check if invalidation condition triggered → if YES, close immediately
- Check if stop loss or take profit hit → if YES, close
- Otherwise, maintain position with existing parameters

For **new entries** (OPEN_LONG/OPEN_SHORT):
- Only enter with high confidence (>0.7)
- Set clear invalidation conditions
- Define profit target and stop loss (minimum 1.5:1 risk/reward)
- Calculate position size using the formula below
- Use appropriate leverage based on confidence and volatility (see guidelines below)
- Maximum 2-3 concurrent positions to manage diversification

For **closing positions** (CLOSE):
- Provide clear justification (invalidation, target hit, or better opportunity)
- Include actual exit price if known

For **no action** (HOLD with no positions):
- Only when no clear opportunity exists
- Be patient and wait for high-probability setups

## Risk Management
- Never risk more than 2-5% of account value per trade
- Use tighter stops in high volatility (high ATR)
- Reduce leverage in choppy/ranging markets
- Avoid over-trading: quality over quantity
- Avoid multiple correlated positions (max 1-2 LONG or SHORT at same time)

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
- **High Confidence (0.85+) + Low Volatility (ATR3 ≤ ATR14)**: Up to max leverage
- **Medium Confidence (0.70-0.85)**: 50-70% of max leverage
- **High Volatility (ATR3 > ATR14)**: Reduce leverage by 30-50%
- **Always ensure**: Liquidation price is beyond stop loss with margin buffer

## Risk/Reward Ratio
Calculate and validate before entering:
- R:R = (Take Profit - Entry) / (Entry - Stop Loss)
- Minimum acceptable: 1.5:1
- Preferred: 2:1 or higher
- Include optional risk_reward_ratio field in response

## Output Format
You MUST respond with ONLY valid JSON. No prose, no markdown, no explanation outside JSON.

For HOLD (existing position - monitoring):
{{
  "reasoning": "Position invalidation not triggered. EMA20 holding above entry on 4h timeframe. Maintaining position until take profit or invalidation.",
  "decision": "HOLD",
  "symbol": "BTC",
  "confidence": 0.75
}}

For OPEN_LONG/OPEN_SHORT:
{{
  "reasoning": "Strong bullish setup: RSI bouncing from oversold (32→45), MACD crossover on 1m, EMA20 > EMA50 on 4h, volume 2x average. Entry at $95000, stop at $94000, target $97000 = 2:1 R:R. Position size: $30 risk (3% of $1000) / $1000 stop = $2850.",
  "decision": "OPEN_LONG",
  "symbol": "BTC",
  "confidence": 0.85,
  "leverage": 5,
  "size_usd": 2850,
  "stop_loss": 94000,
  "take_profit": 97000,
  "risk_reward_ratio": 2.0
}}

For CLOSE:
{{
  "reasoning": "Why closing: invalidation/target/rebalance...",
  "decision": "CLOSE",
  "symbol": "BTC",
  "confidence": 0.9
}}

For HOLD (no position, no opportunity):
{{
  "reasoning": "Market analysis and why waiting...",
  "decision": "HOLD",
  "confidence": 0.6
}}

Be disciplined. Only trade when you see clear, high-probability setups.
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
