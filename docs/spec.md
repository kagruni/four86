# AI Trading Agent Architecture Specification

## Document Version
- **Version**: 1.0
- **Date**: 2025-11-16
- **Status**: Final Architecture Design

---

## 1. Executive Summary

### 1.1 Problem Statement
Four86 currently operates with a basic LangChain integration that makes trading decisions using either ZhipuAI (GLM-4-plus) or OpenRouter models. The current implementation has the following limitations:

1. **Limited Market Analysis Tools**: No dedicated LangChain tools for structured market data retrieval
2. **Basic Decision Making**: Simple prompt-based decisions without multi-step reasoning
3. **Mock Indicators**: Technical indicators (RSI, MACD) are randomly generated, not calculated from real data
4. **Incomplete Hyperliquid Integration**: Order signing and submission are mocked placeholders
5. **No Real-time Data Streams**: Missing WebSocket subscriptions for live price updates
6. **Single-Agent Architecture**: No specialized agents for different trading tasks (research, execution, risk management)

### 1.2 Scope
This specification covers the enhancement of the AI trading agent system to include:

- **LangChain Tools Architecture**: Structured tools for market analysis, trade execution, and risk management
- **Real Technical Indicators**: Calculate RSI, MACD, EMAs from actual Hyperliquid candle data
- **Complete Hyperliquid SDK Integration**: Full order signing, submission, and position management
- **Multi-Model Support**: Maintain compatibility with both OpenRouter and ZhipuAI providers
- **Type-Safe Schemas**: Zod validation for all AI outputs and tool inputs
- **Real-time Market Monitoring**: WebSocket streams for price updates (optional enhancement)

### 1.3 Non-Goals (Explicit Deferrals)
- **Multi-Agent Orchestration**: Advanced agent coordination (defer to Phase 2)
- **Backtesting Engine**: Historical strategy testing (separate project)
- **Frontend Dashboard**: UI development (10% complete, separate track)
- **Advanced Order Types**: Limit orders, OCO, trailing stops (Phase 2)
- **Machine Learning Models**: Custom ML-based predictions (future enhancement)
- **Cross-Exchange Arbitrage**: Multi-DEX trading (out of scope)

### 1.4 Key Constraints
- **Convex-First Architecture**: All backend logic must run in Convex actions/mutations (no separate API server)
- **Type Safety Requirement**: Zod schemas required for all AI outputs
- **Hyperliquid Testnet**: Development and testing must use testnet environment
- **3-Minute Trading Loop**: Maintain current cron schedule (every 3 minutes)
- **Single-User Account**: Each bot operates on one Hyperliquid account
- **Trading Symbols**: BTC, ETH, SOL, BNB, DOGE, XRP only

---

## 2. System Architecture

### 2.1 High-Level Architecture Diagram (Text-Based)

```
┌─────────────────────────────────────────────────────────────────┐
│                     NEXT.JS FRONTEND                            │
│  (Dashboard, Settings, Trade History, Position Monitoring)      │
└────────────────────────┬────────────────────────────────────────┘
                         │ tRPC / Convex Client
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     CONVEX BACKEND                              │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           TRADING LOOP (Cron: Every 3 min)               │  │
│  │  1. Fetch Market Data (Hyperliquid Info API)             │  │
│  │  2. Calculate Technical Indicators (RSI, MACD, EMAs)     │  │
│  │  3. Get Account State (Positions, Balance, Margin)       │  │
│  │  4. Invoke LangChain Trading Agent                       │  │
│  │  5. Execute Trade Decision (if not HOLD)                 │  │
│  │  6. Update Database (Positions, Trades, Logs)            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           LANGCHAIN TRADING AGENT                        │  │
│  │                                                          │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │  Trading Chain (RunnableSequence)                 │ │  │
│  │  │  • System Prompt (Trading Rules)                  │ │  │
│  │  │  • Market Data Formatter                          │ │  │
│  │  │  • LLM (ZhipuAI or OpenRouter)                    │ │  │
│  │  │  • Zod Schema Parser (TradeDecision)              │ │  │
│  │  └────────────────────────────────────────────────────┘ │  │
│  │                                                          │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │  LangChain Tools (Future Phase)                   │ │  │
│  │  │  • getMarketDataTool                              │ │  │
│  │  │  • calculateIndicatorsTool                        │ │  │
│  │  │  • analyzeRiskTool                                │ │  │
│  │  │  • getPositionsTool                               │ │  │
│  │  └────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           HYPERLIQUID SDK INTEGRATION                    │  │
│  │                                                          │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │  InfoClient (@nktkas/hyperliquid)                 │ │  │
│  │  │  • allMids() - Get current prices                 │ │  │
│  │  │  • candleSnapshot() - Get OHLCV candles           │ │  │
│  │  │  • clearinghouseState() - Get account state       │ │  │
│  │  │  • userFills() - Get trade history                │ │  │
│  │  └────────────────────────────────────────────────────┘ │  │
│  │                                                          │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │  ExchangeClient (@nktkas/hyperliquid)             │ │  │
│  │  │  • order() - Place market/limit orders            │ │  │
│  │  │  • cancel() - Cancel open orders                  │ │  │
│  │  │  • updateLeverage() - Adjust leverage             │ │  │
│  │  │  • updateIsolatedMargin() - Manage margin         │ │  │
│  │  └────────────────────────────────────────────────────┘ │  │
│  │                                                          │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │  Technical Indicators Module                      │ │  │
│  │  │  • calculateRSI() - Real RSI from candles         │ │  │
│  │  │  • calculateMACD() - Real MACD from candles       │ │  │
│  │  │  • calculateEMA() - Exponential moving averages   │ │  │
│  │  └────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           DATABASE (Convex Tables)                       │  │
│  │  • botConfig - User settings, API keys                   │  │
│  │  • positions - Open positions with P&L                   │  │
│  │  • trades - Trade history with AI reasoning             │  │
│  │  • aiLogs - LLM prompts and responses                    │  │
│  │  • accountSnapshots - Performance tracking              │  │
│  │  • systemLogs - Error and info logs                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              EXTERNAL SERVICES                                  │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  Hyperliquid DEX │  │  OpenRouter API  │  │  ZhipuAI API │ │
│  │  (Testnet)       │  │  (Multi-Model)   │  │  (GLM-4-plus)│ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Responsibilities

#### 2.2.1 Trading Loop (Convex Cron)
**Location**: `/convex/trading/tradingLoop.ts`

**Responsibilities**:
1. Triggered every 3 minutes via Convex cron
2. Query all active bots from `botConfig` table
3. For each bot:
   - Fetch market data from Hyperliquid Info API
   - Calculate technical indicators from candle data
   - Retrieve account state (balance, positions, margin)
   - Invoke LangChain trading agent with context
   - Execute trade decision (if not HOLD)
   - Update database with results
   - Log errors and system events

**Current Status**: 95% implemented, needs indicator calculation enhancement

#### 2.2.2 LangChain Trading Agent
**Location**: `/convex/ai/agents/tradingAgent.ts`

**Responsibilities**:
1. Receive market data, account state, and positions as input
2. Create trading chain with selected AI model (ZhipuAI or OpenRouter)
3. Format inputs for prompt template
4. Invoke LLM with trading system prompt
5. Parse and validate response using Zod schema
6. Return type-safe `TradeDecision` object
7. Handle errors gracefully (default to HOLD on failure)

**Current Status**: Implemented, needs real indicator data input

#### 2.2.3 Trading Chain (LangChain RunnableSequence)
**Location**: `/convex/ai/chains/tradingChain.ts`

**Responsibilities**:
1. Orchestrate multi-step decision pipeline:
   - Format market data into readable text
   - Format positions with P&L calculations
   - Inject trading rules (max leverage, position size)
   - Generate prompt from template
   - Invoke LLM
   - Parse JSON response with Zod schema
2. Support model switching (ZhipuAI vs OpenRouter)
3. Maintain type safety throughout chain

**Current Status**: Implemented, working correctly

#### 2.2.4 Hyperliquid SDK Integration
**Location**: `/convex/hyperliquid/client.ts`

**Responsibilities**:
1. **InfoClient**: Fetch market data
   - `allMids()`: Get current prices for all symbols
   - `candleSnapshot()`: Retrieve OHLCV candles for indicator calculation
   - `clearinghouseState()`: Get account balance and positions
   - `userFills()`: Retrieve trade execution history
2. **ExchangeClient**: Execute trades
   - `order()`: Place market orders with proper signing
   - `cancel()`: Cancel pending orders
   - `updateLeverage()`: Adjust position leverage
3. **Technical Indicators**: Calculate real indicators
   - `calculateRSI()`: Compute RSI from candle data
   - `calculateMACD()`: Compute MACD and signal line
   - `calculateEMA()`: Exponential moving averages

**Current Status**:
- InfoClient: 60% complete (mock indicators)
- ExchangeClient: 30% complete (mock order placement)
- Technical Indicators: 0% complete (needs implementation)

#### 2.2.5 AI Model Adapters
**Locations**:
- `/convex/ai/models/zhipuai.ts`
- `/convex/ai/models/openrouter.ts`

**Responsibilities**:
1. **ZhipuAI Adapter**: Custom LangChain `BaseChatModel` implementation
   - Convert LangChain messages to ZhipuAI format
   - Call `https://open.bigmodel.cn/api/paas/v4/chat/completions`
   - Parse response into LangChain `AIMessage`
   - Support GLM-4-plus, GLM-4.5, GLM-Z1 models

2. **OpenRouter Adapter**: Wrapper around LangChain `ChatOpenAI`
   - Override base URL to `https://openrouter.ai/api/v1`
   - Add required headers (HTTP-Referer, X-Title)
   - Support 300+ models (Claude, GPT, Gemini, Deepseek)
   - Compatible with OpenAI SDK interface

**Current Status**: Both adapters implemented and working

#### 2.2.6 Zod Schemas
**Location**: `/convex/ai/parsers/schemas.ts`

**Responsibilities**:
1. Define type-safe schemas for AI outputs:
   - `TradeDecisionSchema`: Decision, symbol, leverage, size, stop loss, take profit
   - `MarketAnalysisSchema`: Trend, strength, indicators, key levels
2. Export TypeScript types via `z.infer<>`
3. Validate LLM JSON responses before execution
4. Provide runtime type safety

**Current Status**: Implemented, comprehensive coverage

---

## 3. Data Flow

### 3.1 Trading Decision Flow

```
1. Cron Trigger (Every 3 minutes)
   └──> runTradingCycle()
        │
        ├──> Query active bots from botConfig table
        │
        └──> For each active bot:
             │
             ├──> [STEP 1] Fetch Market Data
             │    └──> InfoClient.allMids() - Get current prices
             │    └──> InfoClient.candleSnapshot() - Get OHLCV data (15m, 1h, 4h)
             │    └──> calculateRSI() - Compute real RSI from candles
             │    └──> calculateMACD() - Compute real MACD from candles
             │    └──> calculateEMA() - Compute EMAs (9, 21, 50, 200 periods)
             │    └──> Result: { BTC: { price, rsi, macd, ema_9, ... }, ETH: {...}, ... }
             │
             ├──> [STEP 2] Get Account State
             │    └──> InfoClient.clearinghouseState(address)
             │    └──> Result: { accountValue, totalMarginUsed, withdrawable, positions }
             │
             ├──> [STEP 3] Query Current Positions
             │    └──> ctx.runQuery(getPositions, { userId })
             │    └──> Result: [{ symbol, side, size, entryPrice, unrealizedPnl, ... }]
             │
             ├──> [STEP 4] Invoke LangChain Agent
             │    └──> makeTradingDecision()
             │         │
             │         ├──> Get API key (ZHIPUAI_API_KEY or OPENROUTER_API_KEY)
             │         │
             │         ├──> Create trading chain:
             │         │    └──> Format market data (prices, indicators)
             │         │    └──> Format positions (P&L, leverage)
             │         │    └──> Inject config (maxLeverage, maxPositionSize)
             │         │    └──> Build prompt from template
             │         │    └──> Invoke LLM (ZhipuAI or OpenRouter)
             │         │    └──> Parse JSON response with Zod schema
             │         │
             │         └──> Return: TradeDecision {
             │              reasoning: "Market analysis...",
             │              decision: "OPEN_LONG" | "OPEN_SHORT" | "CLOSE" | "HOLD",
             │              symbol: "BTC",
             │              confidence: 0.75,
             │              leverage: 10,
             │              size_usd: 1000,
             │              stop_loss: 95000,
             │              take_profit: 105000
             │         }
             │
             ├──> [STEP 5] Save AI Log
             │    └──> ctx.runMutation(saveAILog, {
             │         systemPrompt, userPrompt, rawResponse, decision, reasoning, ...
             │    })
             │
             ├──> [STEP 6] Execute Trade (if decision !== HOLD)
             │    │
             │    ├──> Risk Checks:
             │    │    └──> Validate position size <= maxPositionSize * accountValue
             │    │    └──> Validate leverage <= maxLeverage
             │    │    └──> Validate stop loss exists
             │    │
             │    ├──> If CLOSE:
             │    │    └──> ExchangeClient.order(symbol, isBuy: !currentSide, reduceOnly: true)
             │    │    └──> ctx.runMutation(saveTrade, { action: "CLOSE", ... })
             │    │    └──> ctx.runMutation(closePosition, { symbol })
             │    │
             │    └──> If OPEN_LONG or OPEN_SHORT:
             │         └──> ExchangeClient.updateLeverage(symbol, leverage)
             │         └──> ExchangeClient.order(symbol, isBuy, size, orderType: Market)
             │         └──> ctx.runMutation(saveTrade, { action: "OPEN", ... })
             │         └──> ctx.runMutation(savePosition, { symbol, side, size, ... })
             │
             └──> [STEP 7] Error Handling
                  └──> Catch any errors, log to systemLogs table
                  └──> Return safe default (HOLD) on LLM failure
```

### 3.2 Data Model Notes

#### 3.2.1 Convex Tables

**botConfig** (Primary configuration table)
- `userId`: Clerk user ID (indexed)
- `modelName`: "glm-4-plus" | OpenRouter model ID
- `isActive`: Boolean flag to pause/resume trading
- `symbols`: ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"]
- `maxLeverage`: 1-20x leverage limit
- `maxPositionSize`: 0.01-1.0 (1% to 100% of account)
- `stopLossEnabled`: Force stop loss on all trades
- `maxDailyLoss`: Circuit breaker (-$1000 stops trading)
- `hyperliquidPrivateKey`: Encrypted wallet private key
- `hyperliquidAddress`: Public wallet address

**positions** (Active trading positions)
- `userId`, `symbol`, `side` ("LONG" | "SHORT")
- `size`: Position size in USD
- `leverage`: Current leverage (1-20x)
- `entryPrice`, `currentPrice`: Entry and mark price
- `unrealizedPnl`, `unrealizedPnlPct`: Floating P&L
- `stopLoss`, `takeProfit`: Risk management levels
- `liquidationPrice`: Auto-calculated liquidation price
- **Indexes**: `by_userId`, `by_symbol`

**trades** (Historical trade log)
- `userId`, `symbol`, `action` ("OPEN" | "CLOSE")
- `side` ("LONG" | "SHORT"), `size`, `leverage`, `price`
- `pnl`, `pnlPct`: Realized profit/loss (for CLOSE trades)
- `aiReasoning`: LLM explanation for trade
- `aiModel`: Which model made decision
- `confidence`: 0-1 confidence score
- `txHash`: Hyperliquid transaction hash
- **Indexes**: `by_userId`, `by_userId_time`

**aiLogs** (LLM interaction logs)
- `userId`, `modelName`
- `systemPrompt`, `userPrompt`: Full prompt text
- `rawResponse`: LLM JSON output
- `parsedResponse`: Validated Zod object
- `decision`, `reasoning`, `confidence`: Extracted fields
- `accountValue`, `marketData`: Context snapshot
- `processingTimeMs`: LLM latency
- **Indexes**: `by_userId`, `by_userId_time`

**accountSnapshots** (Performance tracking)
- `userId`, `accountValue`, `totalPnl`, `totalPnlPct`
- `numTrades`, `winRate`: Performance metrics
- `positions`: Snapshot of active positions
- `timestamp`: Unix timestamp
- **Indexes**: `by_userId`, `by_userId_time`

**systemLogs** (Error and info logs)
- `userId` (optional), `level` ("INFO" | "WARNING" | "ERROR")
- `message`: Human-readable log message
- `data`: Additional context (any type)
- **Index**: `by_timestamp`

#### 3.2.2 Hyperliquid API Data Models

**InfoClient Responses**:
1. `allMids()`: `{ "BTC": "98500.0", "ETH": "3420.5", ... }`
2. `candleSnapshot()`:
   ```typescript
   [
     { t: 1700000000000, o: 98000, h: 99000, l: 97500, c: 98500, v: 1234.56 },
     ...
   ]
   ```
3. `clearinghouseState()`:
   ```typescript
   {
     marginSummary: {
       accountValue: "10000.0",
       totalMarginUsed: "2000.0"
     },
     withdrawable: "8000.0",
     assetPositions: [
       {
         position: { coin: "BTC", szi: "0.1", entryPx: "98000.0" },
         unrealizedPnl: "50.0"
       }
     ]
   }
   ```

**ExchangeClient Requests**:
1. `order()`:
   ```typescript
   {
     coin: "BTC",
     is_buy: true,
     sz: 0.1,
     limit_px: 98500.0, // or null for market order
     order_type: { limit: { tif: "Gtc" } } | { market: {} },
     reduce_only: false
   }
   ```
2. `updateLeverage()`:
   ```typescript
   {
     coin: "BTC",
     leverage: 10,
     is_cross: false // Use isolated margin
   }
   ```

---

## 4. API Integration Patterns

### 4.1 Hyperliquid SDK Integration

#### 4.1.1 InfoClient Setup
```typescript
import { Hyperliquid } from "@nktkas/hyperliquid";

// Initialize in Convex action
const info = new Hyperliquid.InfoAPI({
  url: "https://api.hyperliquid-testnet.xyz",
});

// Fetch current prices
const prices = await info.allMids();
// Result: { BTC: "98500.0", ETH: "3420.5", ... }

// Fetch candle data for RSI/MACD calculation
const candles = await info.candleSnapshot({
  coin: "BTC",
  interval: "15m",
  startTime: Date.now() - 24 * 60 * 60 * 1000, // 24 hours ago
  endTime: Date.now(),
});
// Result: [{ t, o, h, l, c, v }, ...]
```

#### 4.1.2 ExchangeClient Setup
```typescript
import { Hyperliquid } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

// Create wallet from private key
const wallet = privateKeyToAccount(`0x${privateKey}`);

// Initialize exchange client
const exchange = new Hyperliquid.ExchangeAPI({
  url: "https://api.hyperliquid-testnet.xyz",
  wallet,
});

// Update leverage before opening position
await exchange.updateLeverage({
  coin: "BTC",
  leverage: 10,
  is_cross: false, // Use isolated margin
});

// Place market order
const orderResult = await exchange.order({
  coin: "BTC",
  is_buy: true,
  sz: 0.1, // Size in coins (not USD)
  limit_px: null, // Market order
  order_type: { market: {} },
  reduce_only: false,
});
// Result: { status: "ok", response: { data: { statuses: [...] } } }
```

### 4.2 Technical Indicator Calculation

#### 4.2.1 RSI (Relative Strength Index)
```typescript
function calculateRSI(candles: Candle[], period: number = 14): number {
  const closes = candles.map(c => c.c);
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  const avgGain = gains.slice(-period).reduce((a, b) => a + b) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b) / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}
```

#### 4.2.2 MACD (Moving Average Convergence Divergence)
```typescript
function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema = [data[0]];

  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }

  return ema;
}

function calculateMACD(candles: Candle[]): {
  macd: number;
  signal: number;
  histogram: number;
} {
  const closes = candles.map(c => c.c);
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);

  const macdLine = ema12.map((val, i) => val - ema26[i]);
  const signalLine = calculateEMA(macdLine, 9);

  const latestMacd = macdLine[macdLine.length - 1];
  const latestSignal = signalLine[signalLine.length - 1];

  return {
    macd: latestMacd,
    signal: latestSignal,
    histogram: latestMacd - latestSignal,
  };
}
```

### 4.3 OpenRouter Integration

#### 4.3.1 Model Selection Strategy
```typescript
// Configuration in botConfig
const modelConfigs = {
  "anthropic/claude-3.5-sonnet": {
    provider: "openrouter",
    temperature: 0.7,
    maxTokens: 2000,
    costPer1kTokens: 0.003,
  },
  "openai/gpt-4-turbo": {
    provider: "openrouter",
    temperature: 0.7,
    maxTokens: 2000,
    costPer1kTokens: 0.01,
  },
  "google/gemini-pro-1.5": {
    provider: "openrouter",
    temperature: 0.7,
    maxTokens: 2000,
    costPer1kTokens: 0.00125,
  },
  "glm-4-plus": {
    provider: "zhipuai",
    temperature: 0.7,
    maxTokens: 2000,
    costPer1kTokens: 0.001,
  },
};
```

#### 4.3.2 OpenRouter Chat Adapter
```typescript
import { ChatOpenAI } from "@langchain/openai";

export class OpenRouterChat extends ChatOpenAI {
  constructor(fields: {
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  }) {
    super({
      openAIApiKey: fields.apiKey,
      modelName: fields.model,
      temperature: fields.temperature ?? 0.7,
      maxTokens: fields.maxTokens ?? 2000,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
          "X-Title": "Four86 Trading Bot",
        },
      },
    });
  }
}
```

### 4.4 ZhipuAI Integration

#### 4.4.1 Custom LangChain Adapter
```typescript
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseMessage, AIMessage } from "@langchain/core/messages";

export class ZhipuAI extends BaseChatModel {
  apiKey: string;
  model: string = "glm-4-plus";
  temperature: number = 0.7;
  maxTokens: number = 2000;

  _llmType(): string {
    return "zhipuai";
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const formattedMessages = messages.map((msg) => ({
      role: msg._getType() === "human" ? "user" :
            msg._getType() === "system" ? "system" : "assistant",
      content: msg.content as string,
    }));

    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: formattedMessages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      }),
    });

    const data = await response.json();
    const text = data.choices[0].message.content;

    return {
      generations: [{ text, message: new AIMessage(text) }],
    };
  }
}
```

---

## 5. Type-Safe Schema Definitions

### 5.1 TradeDecisionSchema (Primary AI Output)
```typescript
import { z } from "zod";

export const TradeDecisionSchema = z.object({
  reasoning: z.string()
    .min(50)
    .describe("Detailed analysis of market conditions and trade rationale"),

  decision: z.enum(["OPEN_LONG", "OPEN_SHORT", "CLOSE", "HOLD"])
    .describe("The action to take"),

  symbol: z.enum(["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"])
    .optional()
    .describe("Symbol to trade (required for OPEN actions)"),

  confidence: z.number()
    .min(0)
    .max(1)
    .describe("Confidence level in this decision (0-1)"),

  leverage: z.number()
    .min(1)
    .max(20)
    .optional()
    .describe("Leverage to use (required for OPEN actions)"),

  size_usd: z.number()
    .positive()
    .optional()
    .describe("Position size in USD (required for OPEN actions)"),

  stop_loss: z.number()
    .positive()
    .optional()
    .describe("Stop loss price (required for OPEN actions)"),

  take_profit: z.number()
    .positive()
    .optional()
    .describe("Take profit price (required for OPEN actions)"),

  risk_reward_ratio: z.number()
    .optional()
    .describe("Calculated risk/reward ratio"),
});

export type TradeDecision = z.infer<typeof TradeDecisionSchema>;
```

### 5.2 MarketDataSchema (Internal Data Model)
```typescript
export const MarketDataSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  volume_24h: z.number().optional(),

  indicators: z.object({
    rsi: z.number().min(0).max(100),
    macd: z.number(),
    macd_signal: z.number(),
    macd_histogram: z.number(),
    ema_9: z.number(),
    ema_21: z.number(),
    ema_50: z.number(),
    ema_200: z.number(),
    price_change_short: z.number(), // 15min change %
    price_change_medium: z.number(), // 4h change %
    price_change_long: z.number(), // 24h change %
  }),

  candles: z.array(z.object({
    t: z.number(), // timestamp
    o: z.number(), // open
    h: z.number(), // high
    l: z.number(), // low
    c: z.number(), // close
    v: z.number(), // volume
  })),
});

export type MarketData = z.infer<typeof MarketDataSchema>;
```

### 5.3 AccountStateSchema (Hyperliquid Account)
```typescript
export const AccountStateSchema = z.object({
  accountValue: z.number(),
  totalMarginUsed: z.number(),
  withdrawable: z.number(),
  totalNotionalValue: z.number(),

  positions: z.array(z.object({
    symbol: z.string(),
    side: z.enum(["LONG", "SHORT"]),
    size: z.number(),
    entryPrice: z.number(),
    markPrice: z.number(),
    leverage: z.number(),
    unrealizedPnl: z.number(),
    liquidationPrice: z.number(),
  })),
});

export type AccountState = z.infer<typeof AccountStateSchema>;
```

---

## 6. Error Handling Strategy

### 6.1 Error Categories

#### 6.1.1 LLM Errors
- **Invalid JSON Response**: LLM returns malformed JSON
  - **Handling**: Retry once with clarified prompt, then default to HOLD
  - **Logging**: Save to `aiLogs` with error flag

- **Schema Validation Failure**: Response doesn't match Zod schema
  - **Handling**: Log validation errors, default to HOLD
  - **Logging**: Save raw response and validation errors to `aiLogs`

- **API Rate Limit**: OpenRouter or ZhipuAI throttles requests
  - **Handling**: Exponential backoff (1s, 2s, 4s), skip cycle if still failing
  - **Logging**: Save to `systemLogs` with level "WARNING"

#### 6.1.2 Hyperliquid API Errors
- **Network Timeout**: API request takes >10s
  - **Handling**: Retry with exponential backoff, skip cycle after 3 failures
  - **Logging**: Save to `systemLogs` with level "ERROR"

- **Invalid Order**: Order rejected (insufficient margin, invalid size)
  - **Handling**: Parse error message, adjust parameters if recoverable
  - **Logging**: Save to `systemLogs` and `trades` (with failed status)

- **Authentication Failure**: Invalid private key or signature
  - **Handling**: Mark bot as inactive, notify user
  - **Logging**: Save to `systemLogs` with level "ERROR"

#### 6.1.3 Risk Management Violations
- **Position Size Exceeds Limit**: AI suggests size > maxPositionSize
  - **Handling**: Reject trade, log warning
  - **Logging**: Save to `aiLogs` with rejection reason

- **Leverage Exceeds Limit**: AI suggests leverage > maxLeverage
  - **Handling**: Cap leverage at max, proceed with trade
  - **Logging**: Save to `aiLogs` with adjustment note

- **Missing Stop Loss**: AI doesn't provide stop loss for OPEN trade
  - **Handling**: Reject trade if `stopLossEnabled` is true
  - **Logging**: Save to `aiLogs` with rejection reason

### 6.2 Error Recovery Patterns

```typescript
// LLM Error Handling
try {
  const decision = await makeTradingDecision(ctx, args);
  return decision;
} catch (error) {
  console.error("LLM error:", error);

  // Log error
  await ctx.runMutation(internal.mutations.saveSystemLog, {
    userId: args.userId,
    level: "ERROR",
    message: "LLM decision failed",
    data: { error: String(error), args },
  });

  // Return safe default
  return {
    reasoning: `Error occurred: ${error}. Defaulting to HOLD for safety.`,
    decision: "HOLD",
    confidence: 0,
  } as TradeDecision;
}

// Hyperliquid API Retry Pattern
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      const delay = baseDelay * Math.pow(2, i);
      console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error("Max retries exceeded");
}
```

---

## 7. Configuration Management

### 7.1 Environment Variables
```bash
# .env.local (Convex environment)

# AI Model APIs
ZHIPUAI_API_KEY=your_zhipuai_api_key
OPENROUTER_API_KEY=your_openrouter_api_key

# Hyperliquid
HYPERLIQUID_TESTNET=true # false for mainnet

# Application
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Clerk Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

### 7.2 Bot Configuration (Per User)
Stored in `botConfig` Convex table:
```typescript
{
  userId: "user_abc123",
  modelName: "glm-4-plus", // or "anthropic/claude-3.5-sonnet"
  isActive: true,
  startingCapital: 10000,
  currentCapital: 10500,

  // Trading settings
  symbols: ["BTC", "ETH", "SOL"],
  maxLeverage: 10,
  maxPositionSize: 0.1, // 10% of account per trade
  stopLossEnabled: true,

  // Risk management
  maxDailyLoss: -500, // Stop trading if daily loss > $500
  minAccountValue: 5000, // Stop trading if account < $5000

  // Hyperliquid credentials
  hyperliquidPrivateKey: "encrypted_private_key",
  hyperliquidAddress: "0xabc123...",

  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}
```

### 7.3 Trading Parameters
```typescript
// System-wide constants
export const TRADING_CONFIG = {
  CRON_INTERVAL: "*/3 * * * *", // Every 3 minutes
  MAX_LEVERAGE: 20,
  MIN_LEVERAGE: 1,
  MAX_POSITION_SIZE: 1.0, // 100% of account
  MIN_POSITION_SIZE: 0.01, // 1% of account
  MIN_CONFIDENCE: 0.5, // Don't trade if confidence < 50%
  MIN_RISK_REWARD: 1.5, // Require 1.5:1 R/R minimum
  MAX_OPEN_POSITIONS: 5,
  INDICATORS: {
    RSI_PERIOD: 14,
    MACD_FAST: 12,
    MACD_SLOW: 26,
    MACD_SIGNAL: 9,
    EMA_PERIODS: [9, 21, 50, 200],
  },
  CANDLE_LOOKBACK: 200, // Fetch 200 candles for indicator calculation
};
```

---

## 8. Observability

### 8.1 Logging Strategy

#### 8.1.1 AI Logs (LLM Interactions)
**Table**: `aiLogs`

**Logged Data**:
- Full system prompt and user prompt
- Raw LLM JSON response
- Parsed and validated decision
- Processing time (ms)
- Account value and market data snapshot

**Use Cases**:
- Debug LLM decision-making process
- Analyze model performance (accuracy, confidence vs. outcomes)
- Replay historical decisions

#### 8.1.2 Trade Logs (Execution History)
**Table**: `trades`

**Logged Data**:
- Trade action (OPEN/CLOSE), symbol, side, size, leverage
- Entry/exit price
- Realized P&L (for closes)
- AI reasoning and confidence
- Hyperliquid transaction hash

**Use Cases**:
- Track trading performance
- Calculate win rate and Sharpe ratio
- Audit trade execution

#### 8.1.3 System Logs (Errors and Events)
**Table**: `systemLogs`

**Logged Data**:
- Log level (INFO, WARNING, ERROR)
- Message and additional context (any data)
- Timestamp

**Use Cases**:
- Monitor system health
- Troubleshoot errors
- Track uptime and cron execution

### 8.2 Metrics to Track

#### 8.2.1 Trading Performance
- **Total P&L**: Sum of all realized profits/losses
- **Total P&L %**: P&L relative to starting capital
- **Win Rate**: Percentage of profitable trades
- **Average Win**: Mean profit on winning trades
- **Average Loss**: Mean loss on losing trades
- **Sharpe Ratio**: Risk-adjusted returns
- **Max Drawdown**: Largest peak-to-trough decline

#### 8.2.2 AI Model Performance
- **Decision Latency**: Time to get LLM response
- **Decision Distribution**: OPEN_LONG vs OPEN_SHORT vs CLOSE vs HOLD
- **Confidence vs. Outcome**: Correlation between confidence and P&L
- **Model Comparison**: GLM-4-plus vs Claude vs GPT performance

#### 8.2.3 System Health
- **Cron Success Rate**: Percentage of successful 3-minute cycles
- **API Error Rate**: Hyperliquid API failures per hour
- **LLM Error Rate**: Invalid JSON or schema validation failures
- **Average Cycle Time**: End-to-end execution time per cycle

### 8.3 Dashboards (Frontend Integration)
**Location**: Next.js frontend (to be implemented)

**Key Views**:
1. **Trading Dashboard**: Live positions, P&L, recent trades
2. **Performance Charts**: Equity curve, win rate, drawdown
3. **AI Insights**: Recent decisions with reasoning
4. **System Status**: Uptime, error logs, API health

---

## 9. Risks and Mitigations

### 9.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **LLM Hallucinations** | AI makes irrational trades | High | Strict Zod schema validation, risk checks, confidence thresholds |
| **Hyperliquid SDK Incompatibility** | Convex edge runtime limitations | Medium | Use fetch API directly, avoid Node.js-specific features |
| **API Rate Limits** | Trading cycles fail | Low | Exponential backoff, fallback to default models |
| **Private Key Exposure** | Account compromise | High | Encrypt keys in database, use env vars, never log |
| **Indicator Calculation Errors** | Incorrect RSI/MACD values | Medium | Unit tests for indicator functions, cross-check with TradingView |
| **Order Signing Failure** | Trades rejected by Hyperliquid | Medium | Validate signatures locally, use viem for robust signing |

### 9.2 Financial Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Excessive Leverage** | Liquidation | High | Enforce maxLeverage limit, require stop losses |
| **Position Concentration** | Large single loss | Medium | Enforce maxPositionSize, limit open positions |
| **Flash Crashes** | Slippage and liquidation | Low | Use stop losses, monitor liquidation price |
| **API Downtime** | Missed exit signals | Low | Monitor positions manually, set alerts |
| **Model Overconfidence** | Risky trades | Medium | Require high confidence (>0.7) for high-leverage trades |

### 9.3 Operational Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Convex Cold Starts** | Delayed cron execution | Low | Use warm-up queries, monitor latency |
| **Database Write Conflicts** | Lost trade records | Low | Use Convex optimistic concurrency control |
| **Testnet vs. Mainnet Confusion** | Accidental mainnet trades | High | Environment flag validation, separate API keys |
| **User Credential Loss** | Locked funds | Medium | Backup private keys, support account recovery |

---

## 10. Testing Strategy

### 10.1 Unit Tests
**Location**: `/tests/unit/`

**Coverage**:
- Technical indicator functions (RSI, MACD, EMA)
- Zod schema validation
- Market data formatters
- Risk check functions

**Framework**: Vitest

### 10.2 Integration Tests
**Location**: `/tests/integration/`

**Coverage**:
- Hyperliquid InfoClient API calls (testnet)
- LangChain trading chain end-to-end
- Convex action/mutation workflows
- OpenRouter and ZhipuAI API integrations

**Framework**: Vitest + Convex test harness

### 10.3 End-to-End Tests
**Location**: `/tests/e2e/`

**Coverage**:
- Full trading cycle (market data → AI decision → trade execution)
- Frontend dashboard (Playwright)
- Multi-user scenarios
- Error handling and recovery

**Framework**: Playwright

### 10.4 Manual Testing Checklist
- [ ] Verify indicator calculations match TradingView
- [ ] Test order signing with Hyperliquid testnet
- [ ] Validate LLM decision quality across models
- [ ] Check risk limits enforce correctly
- [ ] Ensure error logs capture all failure modes
- [ ] Test bot pause/resume functionality

---

## 11. Deployment and Rollout

### 11.1 Phase 1: Technical Indicators (Week 1)
- Implement real RSI, MACD, EMA calculation
- Fetch candle data from Hyperliquid
- Update trading chain to use real indicators
- Add unit tests for indicator functions

### 11.2 Phase 2: Hyperliquid SDK Integration (Week 2)
- Implement ExchangeClient order placement
- Add order signing with viem
- Test on Hyperliquid testnet
- Handle API errors and retries

### 11.3 Phase 3: LangChain Tools (Week 3)
- Create tools for market data, risk analysis
- Update trading agent to use tool-based workflow
- Add tool schemas and validation
- Test multi-step reasoning

### 11.4 Phase 4: Testing and Optimization (Week 4)
- Run integration tests on testnet
- Monitor AI decision quality
- Optimize prompt templates
- Fine-tune risk parameters

### 11.5 Phase 5: Production Deployment (Week 5)
- Deploy to Convex production
- Enable mainnet (manual approval)
- Monitor first live trades
- Iterate based on real performance

---

## 12. Success Criteria

### 12.1 Functional Requirements
- [ ] Real technical indicators calculated from Hyperliquid candle data
- [ ] ExchangeClient successfully places and cancels orders on testnet
- [ ] LangChain agent makes valid trading decisions (no schema errors)
- [ ] Risk limits enforce correctly (leverage, position size, stop loss)
- [ ] All trades logged to database with AI reasoning
- [ ] Error handling prevents system crashes

### 12.2 Performance Requirements
- [ ] Trading cycle completes in <30 seconds (95th percentile)
- [ ] LLM decision latency <5 seconds (median)
- [ ] Indicator calculation <1 second per symbol
- [ ] Cron success rate >99% (excluding intentional pauses)

### 12.3 Quality Requirements
- [ ] >80% unit test coverage for core functions
- [ ] >70% integration test coverage
- [ ] Zero private key exposures in logs
- [ ] All Zod schemas enforce required fields

---

## 13. Appendices

### 13.1 Hyperliquid SDK Reference
- **Docs**: https://hyperliquid.gitbook.io/hyperliquid-docs
- **SDK**: https://github.com/nktkas/hyperliquid
- **Testnet**: https://app.hyperliquid-testnet.xyz

### 13.2 LangChain Resources
- **Docs**: https://js.langchain.com/docs/get_started/introduction
- **Structured Output**: https://js.langchain.com/docs/how_to/structured_output
- **Custom Models**: https://js.langchain.com/docs/how_to/custom_llm

### 13.3 OpenRouter Resources
- **Docs**: https://openrouter.ai/docs
- **Models**: https://openrouter.ai/models
- **Pricing**: https://openrouter.ai/models (per-model pricing)

### 13.4 ZhipuAI Resources
- **Docs**: https://open.bigmodel.cn/dev/api
- **Models**: GLM-4-plus, GLM-4.5, GLM-Z1
- **Pricing**: https://open.bigmodel.cn/pricing

---

## Document Control

**Last Updated**: 2025-11-16
**Review Cycle**: Weekly during implementation
**Approver**: Project Lead
**Distribution**: Development Team, QA, DevOps
