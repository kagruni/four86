# Detailed Trading Decision Integration

## Overview

The detailed multi-timeframe prompt system has been successfully integrated with the trading agent and chain. This provides comprehensive market analysis with historical indicator series across multiple timeframes (3-minute and 4-hour).

## Implementation

### Files Updated

1. **`/convex/ai/chains/tradingChain.ts`**
   - Added `createDetailedTradingChain()` function
   - Formats market data using the detailed prompt system
   - Calculates total return percentage from account state
   - Handles empty positions gracefully

2. **`/convex/ai/agents/tradingAgent.ts`**
   - Added `makeDetailedTradingDecision()` action
   - Accepts `detailedMarketData` from `getDetailedMarketData` action
   - Passes `invocationCount` for session tracking

## Usage Example

### Step 1: Fetch Detailed Market Data

```typescript
import { api } from "../convex/_generated/api";

const detailedMarketData = await ctx.runAction(
  api.hyperliquid.detailedMarketData.getDetailedMarketData,
  {
    symbols: ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"],
    testnet: true,
  }
);
```

### Step 2: Make Detailed Trading Decision

```typescript
const decision = await ctx.runAction(
  api.ai.agents.tradingAgent.makeDetailedTradingDecision,
  {
    userId: "user_123",
    modelType: "openrouter",
    modelName: "anthropic/claude-3.5-sonnet",
    detailedMarketData, // From Step 1
    accountState: {
      accountValue: 10000,
      withdrawable: 8000,
      totalMarginUsed: 2000,
      initialAccountValue: 10000, // Optional: for return calculation
    },
    positions: [], // Or array of existing positions
    invocationCount: 1, // Optional: tracks session number
    config: {
      maxLeverage: 10,
      maxPositionSize: 20,
    },
  }
);
```

### Step 3: Process the Decision

The returned `TradeDecision` matches the existing schema:

```typescript
{
  reasoning: "Detailed analysis...",
  decision: "OPEN_LONG" | "OPEN_SHORT" | "CLOSE" | "HOLD",
  symbol?: "BTC" | "ETH" | "SOL" | "BNB" | "DOGE" | "XRP",
  confidence: 0.85,
  leverage?: 10,
  size_usd?: 1000,
  stop_loss?: 95000,
  take_profit?: 105000
}
```

## Data Format

### Detailed Market Data Structure

Each coin provides:

**Current Values:**
- `currentPrice`, `ema20`, `macd`, `rsi7`, `rsi14`

**Intraday Series (3-minute, last 10 candles):**
- `priceHistory`, `ema20History`, `macdHistory`, `rsi7History`, `rsi14History`

**4-Hour Context:**
- `ema20_4h`, `ema50_4h` (trend detection)
- `atr3_4h`, `atr14_4h` (volatility analysis)
- `currentVolume_4h`, `avgVolume_4h` (volume strength)
- `macdHistory_4h`, `rsi14History_4h` (longer-term indicators)

**Market Microstructure (optional):**
- `openInterest`, `avgOpenInterest`, `fundingRate`

### Positions Format

Positions include exit plans:

```typescript
{
  symbol: "BTC",
  side: "LONG" | "SHORT",
  size: 1000,
  leverage: 10,
  entryPrice: 100000,
  currentPrice: 101000,
  unrealizedPnl: 100,
  unrealizedPnlPct: 10,
  liquidationPrice: 90000,
  takeProfit: 105000,
  stopLoss: 98000,
  invalidationCondition: "Price breaks below EMA20 on 4h"
}
```

## Integration with Trading Loop

To use in the trading loop (`/convex/trading/tradingLoop.ts`), replace the existing `makeTradingDecision` call:

```typescript
// OLD: Basic trading decision
const decision = await ctx.runAction(api.ai.agents.tradingAgent.makeTradingDecision, {
  userId,
  modelType,
  modelName,
  marketData, // Basic market data
  accountState,
  positions,
  config,
});

// NEW: Detailed trading decision
const detailedMarketData = await ctx.runAction(
  api.hyperliquid.detailedMarketData.getDetailedMarketData,
  { symbols: config.symbols, testnet: config.testnet }
);

const decision = await ctx.runAction(api.ai.agents.tradingAgent.makeDetailedTradingDecision, {
  userId,
  modelType,
  modelName,
  detailedMarketData, // Comprehensive multi-timeframe data
  accountState,
  positions,
  invocationCount, // Track session number
  config,
});
```

## Benefits

1. **Multi-timeframe Analysis**: Combines 3-minute (intraday) and 4-hour (trend) timeframes
2. **Historical Context**: Provides last 10 candles of indicator history for pattern recognition
3. **Volatility Awareness**: ATR-based volatility detection for position sizing
4. **Volume Confirmation**: Volume analysis for trade validation
5. **Exit Plan Tracking**: Monitors invalidation conditions and exit criteria
6. **Session Tracking**: `invocationCount` helps AI understand trading session context

## Performance Considerations

- Fetching detailed market data is more intensive (60 candles per timeframe per symbol)
- Recommended to cache detailed market data if calling multiple times in succession
- Consider using the basic `makeTradingDecision` for quick decisions, detailed version for main trading loop

## Future Enhancements

- Add Open Interest and Funding Rate data when available from Hyperliquid
- Implement caching layer for detailed market data
- Add support for custom timeframe combinations
- Track AI decision quality over time using session invocation tracking
