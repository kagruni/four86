# AI Trading Agent Implementation Tasks

## Document Overview
This task list provides a detailed breakdown for implementing the AI trading agent system described in `spec.md`. Tasks are organized by functional area with specific file paths, dependencies, and acceptance criteria.

**Related Documents**:
- Architecture Spec: `/docs/spec.md`
- Schema Reference: `/convex/schema.ts`
- Current Implementation: `/convex/ai/`, `/convex/hyperliquid/`, `/convex/trading/`

---

## Task Organization

### Task Categories
1. **Technical Indicators** - Implement real RSI, MACD, EMA calculations
2. **Hyperliquid SDK Integration** - Complete order placement and signing
3. **LangChain Tools** - Create structured tools for agent workflows
4. **Testing** - Unit, integration, and E2E test coverage
5. **Configuration** - Environment setup and bot management
6. **Observability** - Logging, metrics, and monitoring

### Priority Levels
- **P0**: Critical for core functionality (blocks other work)
- **P1**: Important for production readiness
- **P2**: Nice-to-have enhancements

---

## Group 1: Technical Indicators Implementation

### Task 1.1: Create Technical Indicators Module
**Priority**: P0
**Estimated Effort**: 4 hours
**File**: `/convex/hyperliquid/indicators.ts` (new file)

**Description**: Create a dedicated module for calculating technical indicators from Hyperliquid candle data.

**Dependencies**:
- None (foundational task)

**Implementation Steps**:
1. Create new file `/convex/hyperliquid/indicators.ts`
2. Implement `calculateRSI(candles, period = 14)`
3. Implement `calculateEMA(data, period)`
4. Implement `calculateMACD(candles)` (using 12/26/9 periods)
5. Implement `calculatePriceChange(candles, periods)` for 15m, 4h, 24h changes
6. Export all functions with TypeScript types

**Code Example**:
```typescript
// /convex/hyperliquid/indicators.ts

export interface Candle {
  t: number; // timestamp
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

export interface TechnicalIndicators {
  rsi: number;
  macd: number;
  macd_signal: number;
  macd_histogram: number;
  ema_9: number;
  ema_21: number;
  ema_50: number;
  ema_200: number;
  price_change_short: number; // 15min
  price_change_medium: number; // 4h
  price_change_long: number; // 24h
}

export function calculateRSI(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) {
    throw new Error(`Need at least ${period + 1} candles for RSI calculation`);
  }

  const closes = candles.map(c => c.c);
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function calculateEMA(data: number[], period: number): number[] {
  if (data.length < period) {
    throw new Error(`Need at least ${period} data points for EMA`);
  }

  const k = 2 / (period + 1);
  const ema: number[] = [];

  // Start with SMA for first value
  const sma = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(sma);

  // Calculate EMA for remaining values
  for (let i = period; i < data.length; i++) {
    const currentEma = data[i] * k + ema[ema.length - 1] * (1 - k);
    ema.push(currentEma);
  }

  return ema;
}

export function calculateMACD(candles: Candle[]): {
  macd: number;
  signal: number;
  histogram: number;
} {
  const closes = candles.map(c => c.c);

  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);

  // MACD line = EMA12 - EMA26
  const macdLine: number[] = [];
  const offset = ema12.length - ema26.length;
  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + offset] - ema26[i]);
  }

  // Signal line = 9-period EMA of MACD
  const signalLine = calculateEMA(macdLine, 9);

  const latestMacd = macdLine[macdLine.length - 1];
  const latestSignal = signalLine[signalLine.length - 1];

  return {
    macd: latestMacd,
    signal: latestSignal,
    histogram: latestMacd - latestSignal,
  };
}

export function calculatePriceChange(
  candles: Candle[],
  periods: number
): number {
  if (candles.length < periods + 1) {
    return 0;
  }

  const currentPrice = candles[candles.length - 1].c;
  const pastPrice = candles[candles.length - 1 - periods].c;

  return ((currentPrice - pastPrice) / pastPrice) * 100;
}

export function calculateAllIndicators(candles: Candle[]): TechnicalIndicators {
  const closes = candles.map(c => c.c);

  // Calculate EMAs
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);

  // Calculate RSI
  const rsi = calculateRSI(candles, 14);

  // Calculate MACD
  const macd = calculateMACD(candles);

  // Calculate price changes
  // Assuming 15min candles: 1 period = 15min, 16 periods = 4h, 96 periods = 24h
  const price_change_short = calculatePriceChange(candles, 1); // 15min
  const price_change_medium = calculatePriceChange(candles, 16); // 4h
  const price_change_long = calculatePriceChange(candles, 96); // 24h

  return {
    rsi,
    macd: macd.macd,
    macd_signal: macd.signal,
    macd_histogram: macd.histogram,
    ema_9: ema9[ema9.length - 1],
    ema_21: ema21[ema21.length - 1],
    ema_50: ema50[ema50.length - 1],
    ema_200: ema200[ema200.length - 1],
    price_change_short,
    price_change_medium,
    price_change_long,
  };
}
```

**Testing Notes**:
- Unit test each function with known input/output pairs
- Cross-validate RSI with TradingView or other TA libraries
- Test edge cases (insufficient candles, zero values)

**Acceptance Criteria**:
- [ ] All indicator functions implemented
- [ ] TypeScript types exported
- [ ] RSI matches TradingView calculations (±1%)
- [ ] MACD matches TradingView calculations (±1%)
- [ ] EMAs calculated correctly
- [ ] No runtime errors on valid inputs

---

### Task 1.2: Update Hyperliquid Client to Fetch Candles
**Priority**: P0
**Estimated Effort**: 3 hours
**File**: `/convex/hyperliquid/client.ts`

**Description**: Update `getMarketData` action to fetch real candle data from Hyperliquid and calculate indicators.

**Dependencies**:
- Task 1.1 (indicators module)

**Implementation Steps**:
1. Install `@nktkas/hyperliquid` package (if not already installed)
2. Update `getMarketData` action to fetch candles via `candleSnapshot`
3. Call `calculateAllIndicators` for each symbol
4. Replace mock indicator data with real calculations
5. Add error handling for API failures

**Code Example**:
```typescript
// /convex/hyperliquid/client.ts

import { action } from "../_generated/server";
import { v } from "convex/values";
import { calculateAllIndicators, type Candle } from "./indicators";

interface MarketData {
  symbol: string;
  price: number;
  volume_24h?: number;
  indicators: {
    rsi: number;
    macd: number;
    macd_signal: number;
    macd_histogram: number;
    ema_9: number;
    ema_21: number;
    ema_50: number;
    ema_200: number;
    price_change_short: number;
    price_change_medium: number;
    price_change_long: number;
  };
  candles: Candle[];
}

export const getMarketData = action({
  args: {
    symbols: v.array(v.string()),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    const baseUrl = args.testnet
      ? "https://api.hyperliquid-testnet.xyz"
      : "https://api.hyperliquid.xyz";

    const marketData: Record<string, MarketData> = {};

    try {
      // Get current prices
      const priceResponse = await fetch(`${baseUrl}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "allMids" }),
      });

      const prices = await priceResponse.json();

      // Fetch candles and calculate indicators for each symbol
      for (const symbol of args.symbols) {
        const price = parseFloat(prices[symbol] || "0");

        // Fetch 15-minute candles (need ~200 for EMA200)
        const endTime = Date.now();
        const startTime = endTime - 200 * 15 * 60 * 1000; // 200 candles * 15min

        const candleResponse = await fetch(`${baseUrl}/info`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "candleSnapshot",
            req: {
              coin: symbol,
              interval: "15m",
              startTime,
              endTime,
            },
          }),
        });

        const candleData = await candleResponse.json();

        // Parse candles
        const candles: Candle[] = candleData.map((c: any) => ({
          t: c.t,
          o: parseFloat(c.o),
          h: parseFloat(c.h),
          l: parseFloat(c.l),
          c: parseFloat(c.c),
          v: parseFloat(c.v || "0"),
        }));

        // Calculate indicators
        const indicators = calculateAllIndicators(candles);

        marketData[symbol] = {
          symbol,
          price,
          indicators,
          candles,
        };
      }

      return marketData;
    } catch (error) {
      console.error("Error fetching market data:", error);
      throw new Error(`Failed to fetch market data: ${error}`);
    }
  },
});
```

**Testing Notes**:
- Test with Hyperliquid testnet API
- Verify candle data format matches expected structure
- Ensure indicators are calculated without errors
- Test error handling for network failures

**Acceptance Criteria**:
- [ ] Fetches real candle data from Hyperliquid
- [ ] Calculates indicators for all symbols
- [ ] No mock data remaining
- [ ] Error handling for API failures
- [ ] Response matches `MarketData` type

---

### Task 1.3: Update Trading Chain to Use Real Indicators
**Priority**: P0
**Estimated Effort**: 2 hours
**File**: `/convex/ai/chains/tradingChain.ts`

**Description**: Update market data formatter to include all new indicators in the prompt.

**Dependencies**:
- Task 1.2 (market data fetch)

**Implementation Steps**:
1. Update `formatMarketData` function to include new indicators
2. Add EMA values to prompt
3. Add MACD histogram to prompt
4. Format price changes for readability

**Code Example**:
```typescript
// /convex/ai/chains/tradingChain.ts

function formatMarketData(marketData: Record<string, any>): string {
  let formatted = "";

  for (const [symbol, data] of Object.entries(marketData)) {
    const ind = data.indicators;

    formatted += `
### ${symbol}
- **Price**: $${data.price.toFixed(2)}
- **RSI (14)**: ${ind.rsi.toFixed(1)} ${getRSISignal(ind.rsi)}
- **MACD**: ${ind.macd.toFixed(2)} | Signal: ${ind.macd_signal.toFixed(2)} | Histogram: ${ind.macd_histogram.toFixed(2)} ${getMACDSignal(ind.macd_histogram)}
- **EMAs**: 9: $${ind.ema_9.toFixed(2)} | 21: $${ind.ema_21.toFixed(2)} | 50: $${ind.ema_50.toFixed(2)} | 200: $${ind.ema_200.toFixed(2)}
- **Price Changes**: 15min: ${formatChange(ind.price_change_short)}% | 4h: ${formatChange(ind.price_change_medium)}% | 24h: ${formatChange(ind.price_change_long)}%
- **Trend**: ${getTrendFromEMA(ind)}
`;
  }

  return formatted;
}

function getRSISignal(rsi: number): string {
  if (rsi < 30) return "(OVERSOLD - Potential BUY)";
  if (rsi > 70) return "(OVERBOUGHT - Potential SELL)";
  return "(NEUTRAL)";
}

function getMACDSignal(histogram: number): string {
  if (histogram > 0) return "(BULLISH)";
  if (histogram < 0) return "(BEARISH)";
  return "(NEUTRAL)";
}

function formatChange(change: number): string {
  return change >= 0 ? `+${change.toFixed(2)}` : change.toFixed(2);
}

function getTrendFromEMA(ind: any): string {
  const price = ind.ema_9; // Use shortest EMA as proxy for current price
  if (price > ind.ema_21 && ind.ema_21 > ind.ema_50 && ind.ema_50 > ind.ema_200) {
    return "STRONG UPTREND";
  } else if (price < ind.ema_21 && ind.ema_21 < ind.ema_50 && ind.ema_50 < ind.ema_200) {
    return "STRONG DOWNTREND";
  } else if (price > ind.ema_50) {
    return "UPTREND";
  } else if (price < ind.ema_50) {
    return "DOWNTREND";
  }
  return "CONSOLIDATION";
}
```

**Testing Notes**:
- Verify prompt formatting with real market data
- Ensure signals (OVERSOLD, BULLISH, etc.) display correctly
- Test with different market conditions

**Acceptance Criteria**:
- [ ] All indicators included in prompt
- [ ] Formatting is clear and readable
- [ ] Signals (RSI, MACD, trend) calculated correctly
- [ ] No errors in prompt generation

---

## Group 2: Hyperliquid SDK Integration

### Task 2.1: Install and Configure Hyperliquid SDK
**Priority**: P0
**Estimated Effort**: 1 hour
**File**: `package.json`, `/convex/hyperliquid/sdk.ts` (new file)

**Description**: Install `@nktkas/hyperliquid` package and create SDK wrapper for Convex actions.

**Dependencies**:
- None

**Implementation Steps**:
1. Install package: `npm install @nktkas/hyperliquid`
2. Create SDK wrapper file `/convex/hyperliquid/sdk.ts`
3. Initialize InfoClient and ExchangeClient
4. Export factory functions for use in actions

**Code Example**:
```typescript
// /convex/hyperliquid/sdk.ts

import { Hyperliquid } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

export function createInfoClient(testnet: boolean) {
  return new Hyperliquid.InfoAPI({
    url: testnet
      ? "https://api.hyperliquid-testnet.xyz"
      : "https://api.hyperliquid.xyz",
  });
}

export function createExchangeClient(privateKey: string, testnet: boolean) {
  // Ensure private key has 0x prefix
  const formattedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;

  const wallet = privateKeyToAccount(formattedKey as `0x${string}`);

  return new Hyperliquid.ExchangeAPI({
    url: testnet
      ? "https://api.hyperliquid-testnet.xyz"
      : "https://api.hyperliquid.xyz",
    wallet,
  });
}
```

**Testing Notes**:
- Test with valid testnet private key
- Verify wallet creation from private key
- Test InfoClient connection

**Acceptance Criteria**:
- [ ] Package installed successfully
- [ ] InfoClient initializes without errors
- [ ] ExchangeClient initializes with valid private key
- [ ] Testnet URL used in development

---

### Task 2.2: Implement Order Placement
**Priority**: P0
**Estimated Effort**: 4 hours
**File**: `/convex/hyperliquid/client.ts`

**Description**: Replace mock `placeOrder` action with real Hyperliquid SDK order placement.

**Dependencies**:
- Task 2.1 (SDK setup)

**Implementation Steps**:
1. Import `createExchangeClient` from SDK wrapper
2. Update `placeOrder` action to use SDK
3. Handle market orders (order_type: market)
4. Update leverage before placing order
5. Parse response and extract transaction hash
6. Add error handling for order rejections

**Code Example**:
```typescript
// /convex/hyperliquid/client.ts

import { action } from "../_generated/server";
import { v } from "convex/values";
import { createExchangeClient } from "./sdk";

export const placeOrder = action({
  args: {
    privateKey: v.string(),
    address: v.string(),
    symbol: v.string(),
    isBuy: v.boolean(),
    sizeUsd: v.number(),
    leverage: v.number(),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      const exchange = createExchangeClient(args.privateKey, args.testnet);

      // Step 1: Update leverage
      console.log(`Setting leverage to ${args.leverage}x for ${args.symbol}`);
      await exchange.updateLeverage({
        coin: args.symbol,
        leverage: args.leverage,
        is_cross: false, // Use isolated margin
      });

      // Step 2: Get current price to calculate size in coins
      const info = createInfoClient(args.testnet);
      const prices = await info.allMids();
      const currentPrice = parseFloat(prices[args.symbol]);

      // Calculate size in coins (Hyperliquid uses coin amount, not USD)
      const sizeInCoins = args.sizeUsd / currentPrice;

      // Step 3: Place market order
      console.log(`Placing ${args.isBuy ? "BUY" : "SELL"} order for ${sizeInCoins} ${args.symbol}`);
      const orderResult = await exchange.order({
        coin: args.symbol,
        is_buy: args.isBuy,
        sz: sizeInCoins,
        limit_px: null, // Market order
        order_type: { market: {} },
        reduce_only: false,
      });

      // Parse response
      const status = orderResult.response?.data?.statuses?.[0];
      if (status?.error) {
        throw new Error(`Order rejected: ${status.error}`);
      }

      console.log(`Order placed successfully:`, status);

      return {
        success: true,
        price: currentPrice,
        txHash: status?.filled?.oid || "unknown",
        sizeInCoins,
      };
    } catch (error) {
      console.error("Error placing order:", error);
      throw new Error(`Failed to place order: ${error}`);
    }
  },
});
```

**Testing Notes**:
- Test with small amounts on testnet
- Verify leverage updates correctly
- Ensure size calculation is accurate
- Test error handling for insufficient margin

**Acceptance Criteria**:
- [ ] Orders execute successfully on testnet
- [ ] Leverage updates before order placement
- [ ] Size calculated correctly (USD to coins)
- [ ] Transaction hash captured
- [ ] Error handling for rejections

---

### Task 2.3: Implement Position Closing
**Priority**: P0
**Estimated Effort**: 2 hours
**File**: `/convex/hyperliquid/client.ts`

**Description**: Replace mock `closePosition` action with real position closing via SDK.

**Dependencies**:
- Task 2.2 (order placement)

**Implementation Steps**:
1. Query current position from Hyperliquid
2. Place reduce-only order in opposite direction
3. Handle partial closes (if needed)
4. Return transaction details

**Code Example**:
```typescript
// /convex/hyperliquid/client.ts

export const closePosition = action({
  args: {
    privateKey: v.string(),
    address: v.string(),
    symbol: v.string(),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      const exchange = createExchangeClient(args.privateKey, args.testnet);
      const info = createInfoClient(args.testnet);

      // Step 1: Get current position
      const accountState = await info.clearinghouseState(args.address);
      const position = accountState.assetPositions.find(
        (p: any) => p.position.coin === args.symbol
      );

      if (!position) {
        throw new Error(`No open position found for ${args.symbol}`);
      }

      const sizeInCoins = Math.abs(parseFloat(position.position.szi));
      const isLong = parseFloat(position.position.szi) > 0;

      // Step 2: Place reduce-only order in opposite direction
      console.log(`Closing ${isLong ? "LONG" : "SHORT"} position: ${sizeInCoins} ${args.symbol}`);
      const orderResult = await exchange.order({
        coin: args.symbol,
        is_buy: !isLong, // Opposite direction
        sz: sizeInCoins,
        limit_px: null, // Market order
        order_type: { market: {} },
        reduce_only: true, // Only close, don't reverse
      });

      const status = orderResult.response?.data?.statuses?.[0];
      if (status?.error) {
        throw new Error(`Close order rejected: ${status.error}`);
      }

      console.log(`Position closed successfully:`, status);

      return {
        success: true,
        txHash: status?.filled?.oid || "unknown",
        closedSize: sizeInCoins,
      };
    } catch (error) {
      console.error("Error closing position:", error);
      throw new Error(`Failed to close position: ${error}`);
    }
  },
});
```

**Testing Notes**:
- Test closing long and short positions
- Verify reduce-only flag works correctly
- Ensure full position is closed

**Acceptance Criteria**:
- [ ] Positions close successfully on testnet
- [ ] Reduce-only flag prevents reversing position
- [ ] Full position size closed
- [ ] Transaction hash captured

---

### Task 2.4: Update Account State Retrieval
**Priority**: P1
**Estimated Effort**: 2 hours
**File**: `/convex/hyperliquid/client.ts`

**Description**: Enhance `getAccountState` to parse Hyperliquid positions and calculate accurate margin data.

**Dependencies**:
- Task 2.1 (SDK setup)

**Implementation Steps**:
1. Use SDK InfoClient instead of fetch
2. Parse `assetPositions` into standardized format
3. Calculate total notional value
4. Extract liquidation prices

**Code Example**:
```typescript
// /convex/hyperliquid/client.ts

export const getAccountState = action({
  args: {
    address: v.string(),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      const info = createInfoClient(args.testnet);

      const state = await info.clearinghouseState(args.address);

      const positions = state.assetPositions.map((pos: any) => {
        const szi = parseFloat(pos.position.szi);
        return {
          symbol: pos.position.coin,
          side: szi > 0 ? "LONG" : "SHORT",
          size: Math.abs(szi),
          entryPrice: parseFloat(pos.position.entryPx),
          markPrice: parseFloat(pos.position.markPx || pos.position.entryPx),
          leverage: parseFloat(pos.position.leverage?.value || "1"),
          unrealizedPnl: parseFloat(pos.position.unrealizedPnl),
          liquidationPrice: parseFloat(pos.position.liquidationPx || "0"),
        };
      });

      return {
        accountValue: parseFloat(state.marginSummary.accountValue),
        totalMarginUsed: parseFloat(state.marginSummary.totalMarginUsed),
        withdrawable: parseFloat(state.withdrawable),
        totalNotionalValue: parseFloat(state.marginSummary.totalNtlPos || "0"),
        positions,
      };
    } catch (error) {
      console.error("Error fetching account state:", error);
      throw new Error(`Failed to fetch account state: ${error}`);
    }
  },
});
```

**Testing Notes**:
- Test with account that has open positions
- Verify position parsing is accurate
- Compare with Hyperliquid UI values

**Acceptance Criteria**:
- [ ] Uses SDK instead of fetch
- [ ] Positions parsed correctly (side, size, leverage)
- [ ] Liquidation prices extracted
- [ ] Matches Hyperliquid UI data

---

## Group 3: LangChain Tools (Future Phase)

### Task 3.1: Create Market Data Tool
**Priority**: P2
**Estimated Effort**: 3 hours
**File**: `/convex/ai/tools/marketDataTool.ts` (new file)

**Description**: Create a LangChain tool that the agent can invoke to fetch market data on demand.

**Dependencies**:
- Task 1.2 (market data fetch)

**Implementation Notes**:
- This is a Phase 2 enhancement (not required for initial release)
- Allows agent to request specific symbols or timeframes
- Useful for multi-step reasoning workflows

**Deferred**: Implement in Phase 2 after core functionality is stable.

---

### Task 3.2: Create Risk Analysis Tool
**Priority**: P2
**Estimated Effort**: 4 hours
**File**: `/convex/ai/tools/riskAnalysisTool.ts` (new file)

**Description**: Create a tool that calculates risk/reward, position sizing, and optimal stop loss levels.

**Dependencies**:
- Task 1.2 (market data)

**Implementation Notes**:
- This is a Phase 2 enhancement
- Enables agent to reason about risk before making decisions
- Calculates Kelly criterion, Sharpe ratio, etc.

**Deferred**: Implement in Phase 2.

---

## Group 4: Testing

### Task 4.1: Unit Tests for Technical Indicators
**Priority**: P1
**Estimated Effort**: 3 hours
**File**: `/tests/unit/indicators.test.ts` (new file)

**Description**: Create comprehensive unit tests for all indicator calculation functions.

**Dependencies**:
- Task 1.1 (indicators module)

**Implementation Steps**:
1. Create test file `/tests/unit/indicators.test.ts`
2. Test RSI with known input/output pairs
3. Test EMA calculation accuracy
4. Test MACD calculation
5. Test edge cases (insufficient data, zero values)

**Code Example**:
```typescript
// /tests/unit/indicators.test.ts

import { describe, it, expect } from "vitest";
import { calculateRSI, calculateEMA, calculateMACD, type Candle } from "../../convex/hyperliquid/indicators";

describe("Technical Indicators", () => {
  describe("calculateRSI", () => {
    it("should calculate RSI correctly with known data", () => {
      // Example data (closes): [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28]
      const candles: Candle[] = [
        { t: 1, o: 44, h: 44, l: 44, c: 44, v: 100 },
        { t: 2, o: 44.34, h: 44.34, l: 44.34, c: 44.34, v: 100 },
        { t: 3, o: 44.09, h: 44.09, l: 44.09, c: 44.09, v: 100 },
        { t: 4, o: 43.61, h: 43.61, l: 43.61, c: 43.61, v: 100 },
        { t: 5, o: 44.33, h: 44.33, l: 44.33, c: 44.33, v: 100 },
        { t: 6, o: 44.83, h: 44.83, l: 44.83, c: 44.83, v: 100 },
        { t: 7, o: 45.10, h: 45.10, l: 45.10, c: 45.10, v: 100 },
        { t: 8, o: 45.42, h: 45.42, l: 45.42, c: 45.42, v: 100 },
        { t: 9, o: 45.84, h: 45.84, l: 45.84, c: 45.84, v: 100 },
        { t: 10, o: 46.08, h: 46.08, l: 46.08, c: 46.08, v: 100 },
        { t: 11, o: 45.89, h: 45.89, l: 45.89, c: 45.89, v: 100 },
        { t: 12, o: 46.03, h: 46.03, l: 46.03, c: 46.03, v: 100 },
        { t: 13, o: 45.61, h: 45.61, l: 45.61, c: 45.61, v: 100 },
        { t: 14, o: 46.28, h: 46.28, l: 46.28, c: 46.28, v: 100 },
        { t: 15, o: 46.28, h: 46.28, l: 46.28, c: 46.28, v: 100 },
      ];

      const rsi = calculateRSI(candles, 14);

      // Expected RSI ~70.46 (based on standard RSI calculation)
      expect(rsi).toBeGreaterThan(69);
      expect(rsi).toBeLessThan(72);
    });

    it("should throw error with insufficient candles", () => {
      const candles: Candle[] = [
        { t: 1, o: 100, h: 100, l: 100, c: 100, v: 100 },
      ];

      expect(() => calculateRSI(candles, 14)).toThrow();
    });
  });

  describe("calculateEMA", () => {
    it("should calculate EMA correctly", () => {
      const data = [22, 23, 24, 25, 26, 27, 28, 29, 30];
      const ema = calculateEMA(data, 5);

      // EMA should smooth the data
      expect(ema.length).toBe(data.length - 5 + 1);
      expect(ema[ema.length - 1]).toBeGreaterThan(26);
      expect(ema[ema.length - 1]).toBeLessThan(30);
    });
  });

  describe("calculateMACD", () => {
    it("should calculate MACD correctly", () => {
      // Generate sample candles with uptrend
      const candles: Candle[] = Array.from({ length: 50 }, (_, i) => ({
        t: i,
        o: 100 + i,
        h: 100 + i + 1,
        l: 100 + i - 1,
        c: 100 + i,
        v: 1000,
      }));

      const macd = calculateMACD(candles);

      expect(macd.macd).toBeDefined();
      expect(macd.signal).toBeDefined();
      expect(macd.histogram).toBeDefined();
      expect(macd.histogram).toBe(macd.macd - macd.signal);
    });
  });
});
```

**Testing Notes**:
- Use known RSI values from financial datasets
- Compare EMA with Excel calculations
- Test MACD crossovers

**Acceptance Criteria**:
- [ ] All indicator functions tested
- [ ] Known input/output pairs validate correctly
- [ ] Edge cases handled (errors thrown)
- [ ] >90% code coverage for indicators module

---

### Task 4.2: Integration Tests for Hyperliquid SDK
**Priority**: P1
**Estimated Effort**: 4 hours
**File**: `/tests/integration/hyperliquid.test.ts` (new file)

**Description**: Test Hyperliquid SDK integration on testnet with real API calls.

**Dependencies**:
- Task 2.1, 2.2, 2.3 (SDK integration)

**Implementation Steps**:
1. Create test file with testnet credentials
2. Test market data fetching
3. Test order placement (small amounts)
4. Test position closing
5. Test error handling

**Code Example**:
```typescript
// /tests/integration/hyperliquid.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { createInfoClient, createExchangeClient } from "../../convex/hyperliquid/sdk";

describe("Hyperliquid SDK Integration", () => {
  const testPrivateKey = process.env.HYPERLIQUID_TEST_PRIVATE_KEY!;
  const testAddress = process.env.HYPERLIQUID_TEST_ADDRESS!;

  beforeAll(() => {
    if (!testPrivateKey || !testAddress) {
      throw new Error("Test credentials not configured");
    }
  });

  it("should fetch current prices", async () => {
    const info = createInfoClient(true);
    const prices = await info.allMids();

    expect(prices).toBeDefined();
    expect(prices.BTC).toBeDefined();
    expect(parseFloat(prices.BTC)).toBeGreaterThan(0);
  });

  it("should fetch account state", async () => {
    const info = createInfoClient(true);
    const state = await info.clearinghouseState(testAddress);

    expect(state).toBeDefined();
    expect(state.marginSummary).toBeDefined();
    expect(parseFloat(state.marginSummary.accountValue)).toBeGreaterThanOrEqual(0);
  });

  it("should fetch candle data", async () => {
    const info = createInfoClient(true);
    const endTime = Date.now();
    const startTime = endTime - 24 * 60 * 60 * 1000; // 24 hours

    const candles = await info.candleSnapshot({
      coin: "BTC",
      interval: "15m",
      startTime,
      endTime,
    });

    expect(candles).toBeDefined();
    expect(candles.length).toBeGreaterThan(0);
    expect(candles[0]).toHaveProperty("t");
    expect(candles[0]).toHaveProperty("c");
  });

  // NOTE: Commented out to avoid accidental testnet trades
  // Uncomment for manual testing only
  /*
  it("should place and close order", async () => {
    const exchange = createExchangeClient(testPrivateKey, true);

    // Update leverage
    await exchange.updateLeverage({
      coin: "BTC",
      leverage: 2,
      is_cross: false,
    });

    // Place small order
    const orderResult = await exchange.order({
      coin: "BTC",
      is_buy: true,
      sz: 0.001, // Very small size
      limit_px: null,
      order_type: { market: {} },
      reduce_only: false,
    });

    expect(orderResult.response?.data?.statuses?.[0]).toBeDefined();

    // Close position
    const closeResult = await exchange.order({
      coin: "BTC",
      is_buy: false,
      sz: 0.001,
      limit_px: null,
      order_type: { market: {} },
      reduce_only: true,
    });

    expect(closeResult.response?.data?.statuses?.[0]).toBeDefined();
  });
  */
});
```

**Testing Notes**:
- Use dedicated testnet account with small balance
- Run integration tests manually (not in CI)
- Document testnet setup in README

**Acceptance Criteria**:
- [ ] All SDK methods tested on testnet
- [ ] Market data fetches successfully
- [ ] Account state retrieval works
- [ ] Candle data fetches correctly
- [ ] Order placement tests pass (manual)

---

### Task 4.3: E2E Test for Trading Loop
**Priority**: P1
**Estimated Effort**: 5 hours
**File**: `/tests/e2e/tradingLoop.test.ts` (new file)

**Description**: End-to-end test of complete trading cycle from market data to trade execution.

**Dependencies**:
- All previous tasks

**Implementation Steps**:
1. Create mock Convex environment
2. Simulate full trading cycle
3. Verify AI decision pipeline
4. Test trade execution logic
5. Validate database updates

**Code Example**:
```typescript
// /tests/e2e/tradingLoop.test.ts

import { describe, it, expect } from "vitest";
// Import Convex test harness
// Note: Exact implementation depends on Convex testing setup

describe("Trading Loop E2E", () => {
  it("should complete full trading cycle", async () => {
    // 1. Setup test bot in database
    // 2. Trigger trading cycle
    // 3. Verify market data fetched
    // 4. Verify AI decision made
    // 5. Verify trade executed (if not HOLD)
    // 6. Verify database updated (positions, trades, logs)

    // Implementation depends on Convex test framework
    expect(true).toBe(true); // Placeholder
  });
});
```

**Testing Notes**:
- Use Convex test environment
- Mock external API calls for CI
- Test with real testnet for manual validation

**Acceptance Criteria**:
- [ ] Full cycle tested end-to-end
- [ ] Market data → AI → Execution flow works
- [ ] Database updates correctly
- [ ] Error handling tested

---

## Group 5: Configuration and Environment

### Task 5.1: Update Environment Variables
**Priority**: P0
**Estimated Effort**: 1 hour
**File**: `.env.local`, Convex dashboard

**Description**: Configure all required API keys and environment variables.

**Dependencies**:
- None

**Implementation Steps**:
1. Add `ZHIPUAI_API_KEY` to Convex environment
2. Add `OPENROUTER_API_KEY` to Convex environment
3. Set `HYPERLIQUID_TESTNET=true` for development
4. Document environment setup in README

**Environment Variables**:
```bash
# .env.local (for Next.js frontend)
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Convex Environment (set in Convex dashboard)
ZHIPUAI_API_KEY=your_zhipuai_key
OPENROUTER_API_KEY=your_openrouter_key
HYPERLIQUID_TESTNET=true
```

**Testing Notes**:
- Verify all keys are valid
- Test with both ZhipuAI and OpenRouter
- Ensure testnet flag works correctly

**Acceptance Criteria**:
- [ ] All API keys configured
- [ ] Environment variables documented
- [ ] Testnet mode enabled by default
- [ ] No secrets committed to git

---

### Task 5.2: Add Bot Configuration UI (Frontend)
**Priority**: P2
**Estimated Effort**: 6 hours
**File**: `/app/settings/page.tsx` (new or existing)

**Description**: Create UI for users to configure bot settings (model, leverage, symbols, etc.).

**Dependencies**:
- Frontend framework (Next.js + Shadcn UI)

**Implementation Notes**:
- This is a frontend task (separate from core backend)
- Use Shadcn UI components (forms, sliders, switches)
- Integrate with Convex mutations to save settings

**Deferred**: Implement as part of frontend development track (currently 10% complete).

---

## Group 6: Observability and Monitoring

### Task 6.1: Enhance AI Logging
**Priority**: P1
**Estimated Effort**: 2 hours
**File**: `/convex/trading/tradingLoop.ts`

**Description**: Improve AI log entries to capture full prompts, processing time, and decision context.

**Dependencies**:
- Task 1.3 (trading chain updates)

**Implementation Steps**:
1. Capture full system and user prompts
2. Log LLM processing time
3. Store market data snapshot
4. Add confidence threshold logging

**Code Example**:
```typescript
// /convex/trading/tradingLoop.ts

// After AI decision
const processingStartTime = Date.now();
const decision = await makeTradingDecision(ctx, { ... });
const processingTimeMs = Date.now() - processingStartTime;

await ctx.runMutation(internal.mutations.saveAILog, {
  userId: bot.userId,
  modelName: bot.modelName,
  systemPrompt: tradingPrompt.SYSTEM_PROMPT.template,
  userPrompt: JSON.stringify({ marketData, accountState, positions }),
  rawResponse: JSON.stringify(decision),
  parsedResponse: decision,
  decision: decision.decision,
  reasoning: decision.reasoning,
  confidence: decision.confidence,
  accountValue: accountState.accountValue,
  marketData,
  processingTimeMs,
});
```

**Acceptance Criteria**:
- [ ] Full prompts logged
- [ ] Processing time captured
- [ ] Market data snapshot saved
- [ ] Logs queryable by user and time

---

### Task 6.2: Add System Health Monitoring
**Priority**: P2
**Estimated Effort**: 3 hours
**File**: `/convex/monitoring/health.ts` (new file)

**Description**: Create scheduled function to monitor system health and log metrics.

**Dependencies**:
- None

**Implementation Notes**:
- Create cron job to check trading cycle success rate
- Log API error rates
- Track LLM latency over time
- Alert on consecutive failures

**Deferred**: Implement in Phase 2 after core functionality is stable.

---

## Group 7: Documentation

### Task 7.1: Update README with Setup Instructions
**Priority**: P1
**Estimated Effort**: 2 hours
**File**: `README.md`

**Description**: Document complete setup process for new developers.

**Dependencies**:
- All implementation tasks

**Sections to Add**:
1. Prerequisites (Node.js, Convex CLI, API keys)
2. Environment setup
3. Hyperliquid testnet account creation
4. Running the development server
5. Testing guide
6. Deployment process

**Acceptance Criteria**:
- [ ] Setup steps documented
- [ ] API key configuration explained
- [ ] Testing instructions included
- [ ] Troubleshooting section added

---

### Task 7.2: Create API Documentation
**Priority**: P2
**Estimated Effort**: 3 hours
**File**: `/docs/api.md` (new file)

**Description**: Document all Convex actions, mutations, and queries.

**Deferred**: Implement after core functionality is complete.

---

## Task Summary

### Critical Path (P0)
1. Task 1.1: Create Technical Indicators Module
2. Task 1.2: Update Hyperliquid Client to Fetch Candles
3. Task 1.3: Update Trading Chain to Use Real Indicators
4. Task 2.1: Install and Configure Hyperliquid SDK
5. Task 2.2: Implement Order Placement
6. Task 2.3: Implement Position Closing
7. Task 5.1: Update Environment Variables

**Total P0 Effort**: ~19 hours

### Important (P1)
8. Task 2.4: Update Account State Retrieval
9. Task 4.1: Unit Tests for Technical Indicators
10. Task 4.2: Integration Tests for Hyperliquid SDK
11. Task 4.3: E2E Test for Trading Loop
12. Task 6.1: Enhance AI Logging
13. Task 7.1: Update README

**Total P1 Effort**: ~18 hours

### Nice-to-Have (P2)
14. Task 3.1: Create Market Data Tool (Phase 2)
15. Task 3.2: Create Risk Analysis Tool (Phase 2)
16. Task 5.2: Add Bot Configuration UI (Frontend)
17. Task 6.2: Add System Health Monitoring (Phase 2)
18. Task 7.2: Create API Documentation

**Total P2 Effort**: ~19 hours (deferred)

---

## Testing Approach

### Unit Testing
- Test all pure functions (indicators, formatters)
- Mock external dependencies (API calls)
- Aim for >80% coverage on core logic
- Use Vitest as test runner

### Integration Testing
- Test Hyperliquid SDK on testnet
- Test LangChain agent with real LLM calls
- Test Convex actions with mock database
- Run manually (not in CI due to API costs)

### End-to-End Testing
- Test full trading loop from start to finish
- Use Convex test environment
- Validate database state after operations
- Run on testnet for final validation

### Manual Testing
- Verify indicator calculations against TradingView
- Monitor bot behavior on testnet for 24 hours
- Test error scenarios (API failures, invalid keys)
- Validate UI (when frontend is implemented)

---

## Acceptance Criteria (Overall)

### Functional
- [ ] Real technical indicators calculated from Hyperliquid candles
- [ ] Orders execute successfully on Hyperliquid testnet
- [ ] LangChain agent makes valid trading decisions
- [ ] Risk limits enforced (leverage, position size, stop loss)
- [ ] All trades logged to database with full context
- [ ] Error handling prevents system crashes

### Performance
- [ ] Trading cycle completes in <30 seconds (95th percentile)
- [ ] LLM decision latency <5 seconds (median)
- [ ] Indicator calculation <1 second per symbol
- [ ] Cron success rate >99%

### Quality
- [ ] >80% unit test coverage on core functions
- [ ] >70% integration test coverage
- [ ] Zero secrets exposed in logs or commits
- [ ] All Zod schemas validate correctly

### Documentation
- [ ] Setup guide complete and tested
- [ ] API reference available
- [ ] Testing guide documented
- [ ] Known issues and limitations listed

---

## Risk Mitigation

### Technical Risks
- **Indicator calculation errors**: Cross-validate with TradingView, add unit tests
- **SDK compatibility issues**: Use fetch API fallback if SDK fails in Convex
- **API rate limits**: Implement exponential backoff and retry logic
- **Private key security**: Encrypt in database, never log, use env vars

### Timeline Risks
- **Dependency delays**: Start with P0 tasks, parallelize where possible
- **Testing complexity**: Allocate 30% of time to testing and debugging
- **API instability**: Use testnet extensively before mainnet

### Scope Risks
- **Feature creep**: Defer P2 tasks to Phase 2
- **Over-engineering**: Keep solutions simple and maintainable
- **Documentation debt**: Document as you build, not at the end

---

## Next Steps

1. **Immediate**: Start with Task 1.1 (Technical Indicators Module)
2. **Week 1**: Complete all P0 tasks (indicators + SDK integration)
3. **Week 2**: Complete P1 tasks (testing + documentation)
4. **Week 3**: Run bot on testnet for 7 days, monitor performance
5. **Week 4**: Address bugs, optimize prompts, prepare for mainnet
6. **Phase 2**: Implement P2 enhancements (tools, monitoring, UI)

---

## Document Control

**Last Updated**: 2025-11-16
**Owner**: Development Team
**Review Cycle**: Daily during implementation
**Status**: Ready for Implementation
