# LangChain Integration - Implementation Addendum

## Overview

Adding **LangChain.js** to handle all prompting and agentic work. This provides:
- ✅ Structured prompts with templates
- ✅ Reliable output parsing with Zod schemas
- ✅ Chain of thought reasoning
- ✅ Tool calling capabilities (future)
- ✅ Better error handling
- ✅ Conversation memory (if needed)

---

## Updated Architecture

```
Convex Trading Loop
    ↓
LangChain Agent
    ↓
├─ Prompt Templates (structured)
├─ AI Models (ZhipuAI, OpenRouter via LangChain)
├─ Output Parsers (Zod schemas)
└─ Tool Calling (optional, for future features)
    ↓
Structured Decision Object
    ↓
Trade Executor
```

---

## Installation

### Updated package.json
```json
{
  "dependencies": {
    "langchain": "^0.3.0",
    "@langchain/core": "^0.3.0",
    "@langchain/openai": "^0.3.0",
    "@langchain/community": "^0.3.0",
    "zod": "^3.23.0",
    "zod-to-json-schema": "^3.23.0",
    // ... existing dependencies
  }
}
```

### Install command
```bash
npm install langchain @langchain/core @langchain/openai @langchain/community zod zod-to-json-schema
```

---

## Project Structure Changes

```
convex/
├── ai/
│   ├── models/
│   │   ├── zhipuai.ts           # Custom LangChain model for ZhipuAI
│   │   └── openrouter.ts        # Custom LangChain model for OpenRouter
│   ├── chains/
│   │   ├── tradingChain.ts      # Main trading decision chain
│   │   └── analysisChain.ts     # Market analysis chain
│   ├── prompts/
│   │   ├── system.ts            # System prompt template
│   │   ├── marketAnalysis.ts    # Market analysis prompt
│   │   └── riskAssessment.ts    # Risk assessment prompt
│   ├── parsers/
│   │   ├── tradeDecision.ts     # Parse trading decisions
│   │   └── schemas.ts           # Zod schemas for outputs
│   └── agents/
│       └── tradingAgent.ts      # Main trading agent
```

---

## Implementation Details

### 1. Zod Schemas for Structured Outputs

**File: `convex/ai/parsers/schemas.ts`**
```typescript
import { z } from "zod";

// Trading decision schema
export const TradeDecisionSchema = z.object({
  reasoning: z.string().describe("Detailed analysis of market conditions and trade rationale"),
  
  decision: z.enum(["OPEN_LONG", "OPEN_SHORT", "CLOSE", "HOLD"])
    .describe("The action to take"),
  
  symbol: z.enum(["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"])
    .optional()
    .describe("Symbol to trade (required for OPEN actions)"),
  
  confidence: z.number().min(0).max(1)
    .describe("Confidence level in this decision (0-1)"),
  
  leverage: z.number().min(1).max(20)
    .optional()
    .describe("Leverage to use (required for OPEN actions)"),
  
  size_usd: z.number().positive()
    .optional()
    .describe("Position size in USD (required for OPEN actions)"),
  
  stop_loss: z.number().positive()
    .optional()
    .describe("Stop loss price (required for OPEN actions)"),
  
  take_profit: z.number().positive()
    .optional()
    .describe("Take profit price (required for OPEN actions)"),
  
  risk_reward_ratio: z.number()
    .optional()
    .describe("Calculated risk/reward ratio"),
});

export type TradeDecision = z.infer<typeof TradeDecisionSchema>;

// Market analysis schema
export const MarketAnalysisSchema = z.object({
  symbol: z.string(),
  trend: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]),
  strength: z.number().min(0).max(10),
  key_levels: z.object({
    support: z.array(z.number()),
    resistance: z.array(z.number()),
  }),
  indicators: z.object({
    rsi_signal: z.enum(["OVERSOLD", "OVERBOUGHT", "NEUTRAL"]),
    macd_signal: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]),
    volume_signal: z.enum(["HIGH", "NORMAL", "LOW"]),
  }),
  summary: z.string(),
});

export type MarketAnalysis = z.infer<typeof MarketAnalysisSchema>;
```

### 2. Custom LangChain Model for ZhipuAI

**File: `convex/ai/models/zhipuai.ts`**
```typescript
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseMessage, AIMessage } from "@langchain/core/messages";
import { ChatResult } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";

export interface ZhipuAIInput {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class ZhipuAI extends BaseChatModel {
  apiKey: string;
  model: string = "glm-4-plus";
  temperature: number = 0.7;
  maxTokens: number = 2000;

  constructor(fields: ZhipuAIInput) {
    super(fields);
    this.apiKey = fields.apiKey;
    this.model = fields.model ?? this.model;
    this.temperature = fields.temperature ?? this.temperature;
    this.maxTokens = fields.maxTokens ?? this.maxTokens;
  }

  _llmType(): string {
    return "zhipuai";
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    // Convert LangChain messages to ZhipuAI format
    const formattedMessages = messages.map((msg) => ({
      role: msg._getType() === "human" ? "user" : 
            msg._getType() === "system" ? "system" : "assistant",
      content: msg.content as string,
    }));

    // Call ZhipuAI API
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

    if (!response.ok) {
      throw new Error(`ZhipuAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.choices[0].message.content;

    return {
      generations: [
        {
          text,
          message: new AIMessage(text),
        },
      ],
    };
  }
}
```

### 3. Custom LangChain Model for OpenRouter

**File: `convex/ai/models/openrouter.ts`**
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
          "X-Title": "Alpha Arena Trader",
        },
      },
    });
  }
}
```

### 4. Prompt Templates

**File: `convex/ai/prompts/system.ts`**
```typescript
import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from "@langchain/core/prompts";

export const SYSTEM_PROMPT = SystemMessagePromptTemplate.fromTemplate(`
You are an expert cryptocurrency trading AI with deep knowledge of technical analysis and risk management.

Your role is to analyze market conditions and make informed trading decisions for a single trading account.

## Trading Rules
- Every position MUST have a stop-loss
- Maximum leverage: {maxLeverage}x
- Maximum position size: {maxPositionSize}% of account
- Minimum risk/reward ratio: 1:2
- Never risk more than 2% of account on a single trade

## Analysis Framework
1. Evaluate technical indicators (RSI, MACD, EMA)
2. Identify support and resistance levels
3. Assess trend strength and direction
4. Calculate risk/reward ratio
5. Determine position size based on volatility
6. Set appropriate stop-loss and take-profit levels

## Decision Criteria
- OPEN_LONG: Clear bullish signals, good risk/reward, favorable market conditions
- OPEN_SHORT: Clear bearish signals, good risk/reward, favorable market conditions
- CLOSE: Position target hit, invalidation triggered, or better opportunity elsewhere
- HOLD: No clear opportunity, wait for better setup

## Output Format
You must respond with valid JSON matching this structure exactly:
{{
  "reasoning": "Detailed analysis...",
  "decision": "OPEN_LONG" | "OPEN_SHORT" | "CLOSE" | "HOLD",
  "symbol": "BTC" | "ETH" | "SOL" | etc,
  "confidence": 0.75,
  "leverage": 10,
  "size_usd": 1000,
  "stop_loss": 95000,
  "take_profit": 105000,
  "risk_reward_ratio": 2.5
}}

Only trade when you see HIGH CONFIDENCE opportunities. It's better to HOLD than force trades.
`);

export const MARKET_DATA_PROMPT = HumanMessagePromptTemplate.fromTemplate(`
# Trading Update - {timestamp}

## Market Data

{marketDataFormatted}

## Account Status

- Account Value: ${accountValue}
- Available Cash: ${availableCash}
- Margin Used: ${marginUsed}
- Open Positions: {positionCount}

{positionsFormatted}

## Task

Analyze the market data and decide your next action. Consider:
1. Technical indicators across all timeframes
2. Current position exposure
3. Risk management rules
4. Market momentum and volatility

Respond with your decision in the specified JSON format.
`);

export const tradingPrompt = ChatPromptTemplate.fromMessages([
  SYSTEM_PROMPT,
  MARKET_DATA_PROMPT,
]);
```

### 5. Structured Output Parser

**File: `convex/ai/parsers/tradeDecision.ts`**
```typescript
import { StructuredOutputParser } from "langchain/output_parsers";
import { TradeDecisionSchema } from "./schemas";

export const tradeDecisionParser = StructuredOutputParser.fromZodSchema(
  TradeDecisionSchema
);

// Get format instructions to add to prompt
export function getFormatInstructions(): string {
  return tradeDecisionParser.getFormatInstructions();
}

// Parse the AI response
export async function parseTradeDecision(text: string) {
  try {
    return await tradeDecisionParser.parse(text);
  } catch (error) {
    console.error("Failed to parse trade decision:", error);
    
    // Fallback: try to extract JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return TradeDecisionSchema.parse(parsed);
    }
    
    throw error;
  }
}
```

### 6. Trading Chain

**File: `convex/ai/chains/tradingChain.ts`**
```typescript
import { RunnableSequence } from "@langchain/core/runnables";
import { tradingPrompt } from "../prompts/system";
import { tradeDecisionParser } from "../parsers/tradeDecision";
import { ZhipuAI } from "../models/zhipuai";
import { OpenRouterChat } from "../models/openrouter";

export function createTradingChain(
  modelType: "zhipuai" | "openrouter",
  modelName: string,
  apiKey: string,
  config: {
    maxLeverage: number;
    maxPositionSize: number;
  }
) {
  // Select the appropriate model
  const model = modelType === "zhipuai" 
    ? new ZhipuAI({ apiKey, model: "glm-4-plus" })
    : new OpenRouterChat({ apiKey, model: modelName });

  // Create the chain
  const chain = RunnableSequence.from([
    {
      // Format the input
      marketDataFormatted: (input: any) => formatMarketData(input.marketData),
      positionsFormatted: (input: any) => formatPositions(input.positions),
      accountValue: (input: any) => input.accountState.accountValue,
      availableCash: (input: any) => input.accountState.withdrawable,
      marginUsed: (input: any) => input.accountState.totalMarginUsed,
      positionCount: (input: any) => input.positions.length,
      timestamp: () => new Date().toISOString(),
      maxLeverage: () => config.maxLeverage,
      maxPositionSize: () => config.maxPositionSize,
    },
    tradingPrompt,
    model,
    tradeDecisionParser,
  ]);

  return chain;
}

function formatMarketData(marketData: Record<string, any>): string {
  let formatted = "";
  
  for (const [symbol, data] of Object.entries(marketData)) {
    formatted += `
### ${symbol}
- Price: $${data.price.toFixed(2)}
- 24h Volume: $${data.volume_24h?.toFixed(0) || 'N/A'}
- RSI: ${data.indicators.rsi.toFixed(1)} ${getRSISignal(data.indicators.rsi)}
- MACD: ${data.indicators.macd.toFixed(2)} (Signal: ${data.indicators.macd_signal.toFixed(2)})
- Trend (10min): ${data.indicators.price_change_short >= 0 ? '+' : ''}${data.indicators.price_change_short.toFixed(2)}%
- Trend (4h): ${data.indicators.price_change_medium >= 0 ? '+' : ''}${data.indicators.price_change_medium.toFixed(2)}%
`;
  }
  
  return formatted;
}

function formatPositions(positions: any[]): string {
  if (positions.length === 0) {
    return "\n## Current Positions\n\nNo open positions.";
  }
  
  let formatted = "\n## Current Positions\n";
  
  for (const pos of positions) {
    formatted += `
**${pos.symbol}** - ${pos.side}
- Size: $${pos.size.toFixed(2)} (${pos.leverage}x leverage)
- Entry: $${pos.entryPrice.toFixed(2)}
- Current: $${pos.currentPrice.toFixed(2)}
- P&L: $${pos.unrealizedPnl.toFixed(2)} (${pos.unrealizedPnlPct.toFixed(2)}%)
- Stop Loss: $${pos.stopLoss?.toFixed(2) || 'None'}
- Take Profit: $${pos.takeProfit?.toFixed(2) || 'None'}
`;
  }
  
  return formatted;
}

function getRSISignal(rsi: number): string {
  if (rsi < 30) return "(OVERSOLD)";
  if (rsi > 70) return "(OVERBOUGHT)";
  return "(NEUTRAL)";
}
```

### 7. Trading Agent

**File: `convex/ai/agents/tradingAgent.ts`**
```typescript
import { action } from "../../_generated/server";
import { v } from "convex/values";
import { createTradingChain } from "../chains/tradingChain";
import type { TradeDecision } from "../parsers/schemas";

export const makeTradingDecision = action({
  args: {
    modelType: v.union(v.literal("zhipuai"), v.literal("openrouter")),
    modelName: v.string(),
    marketData: v.any(),
    accountState: v.any(),
    positions: v.any(),
    config: v.object({
      maxLeverage: v.number(),
      maxPositionSize: v.number(),
    }),
  },
  handler: async (ctx, args): Promise<TradeDecision> => {
    const startTime = Date.now();
    
    try {
      // Get API key from environment
      const apiKey = args.modelType === "zhipuai"
        ? process.env.ZHIPUAI_API_KEY!
        : process.env.OPENROUTER_API_KEY!;
      
      // Create the trading chain
      const chain = createTradingChain(
        args.modelType,
        args.modelName,
        apiKey,
        args.config
      );
      
      // Invoke the chain
      const decision = await chain.invoke({
        marketData: args.marketData,
        accountState: args.accountState,
        positions: args.positions,
      });
      
      const processingTime = Date.now() - startTime;
      
      console.log(`Trading decision made in ${processingTime}ms:`, decision.decision);
      
      return decision;
      
    } catch (error) {
      console.error("Error in trading agent:", error);
      
      // Return safe default (HOLD)
      return {
        reasoning: `Error occurred: ${error}. Defaulting to HOLD for safety.`,
        decision: "HOLD",
        confidence: 0,
      };
    }
  },
});
```

### 8. Updated Trading Loop

**File: `convex/trading/tradingLoop.ts`**
```typescript
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getMarketData, getAccountState } from "../hyperliquid/client";
import { makeTradingDecision } from "../ai/agents/tradingAgent";

export const runTradingCycle = internalAction({
  handler: async (ctx) => {
    // Get all active bots
    const activeBots = await ctx.runQuery(internal.queries.getActiveBots);
    
    for (const bot of activeBots) {
      try {
        console.log(`Running trading cycle for bot ${bot._id}`);
        
        // 1. Fetch market data
        const marketData = await getMarketData({
          symbols: bot.symbols,
          testnet: true,
        });
        
        // 2. Get account state
        const accountState = await getAccountState({
          address: bot.hyperliquidAddress,
          testnet: true,
        });
        
        // 3. Get current positions
        const positions = await ctx.runQuery(
          internal.queries.getPositions,
          { userId: bot.userId }
        );
        
        // 4. Use LangChain agent to make decision
        const decision = await makeTradingDecision({
          modelType: bot.modelName === "glm-4-plus" ? "zhipuai" : "openrouter",
          modelName: bot.modelName,
          marketData,
          accountState,
          positions,
          config: {
            maxLeverage: bot.maxLeverage,
            maxPositionSize: bot.maxPositionSize,
          },
        });
        
        // 5. Save AI log
        await ctx.runMutation(internal.mutations.saveAILog, {
          userId: bot.userId,
          modelName: bot.modelName,
          decision: decision.decision,
          reasoning: decision.reasoning,
          confidence: decision.confidence,
          accountValue: accountState.accountValue,
          marketData,
          processingTimeMs: 0, // Already logged in agent
        });
        
        // 6. Execute trade if needed
        if (decision.decision !== "HOLD") {
          await executeTradeDecision(ctx, bot, decision, accountState);
        }
        
      } catch (error) {
        console.error(`Error in trading cycle for bot ${bot._id}:`, error);
        await ctx.runMutation(internal.mutations.saveSystemLog, {
          userId: bot.userId,
          level: "ERROR",
          message: "Trading cycle error",
          data: { error: String(error) },
        });
      }
    }
  },
});

async function executeTradeDecision(ctx: any, bot: any, decision: any, accountState: any) {
  // Implementation same as before, but now decision is strongly typed!
  // TypeScript will catch any issues with the decision structure
}
```

---

## Advanced Features with LangChain

### 1. Multi-Step Reasoning Chain

**File: `convex/ai/chains/advancedTradingChain.ts`**
```typescript
import { RunnableSequence } from "@langchain/core/runnables";

export function createAdvancedTradingChain(model: any) {
  const chain = RunnableSequence.from([
    // Step 1: Market Analysis
    {
      analysis: marketAnalysisChain,
    },
    // Step 2: Risk Assessment
    {
      analysis: (input: any) => input.analysis,
      risks: riskAssessmentChain,
    },
    // Step 3: Position Sizing
    {
      analysis: (input: any) => input.analysis,
      risks: (input: any) => input.risks,
      position: positionSizingChain,
    },
    // Step 4: Final Decision
    {
      analysis: (input: any) => input.analysis,
      risks: (input: any) => input.risks,
      position: (input: any) => input.position,
      decision: finalDecisionChain,
    },
  ]);
  
  return chain;
}
```

### 2. Memory (Track Previous Decisions)

**File: `convex/ai/memory/tradingMemory.ts`**
```typescript
import { BufferMemory } from "langchain/memory";
import { ConversationChain } from "langchain/chains";

export async function createTradingChainWithMemory(model: any, userId: string) {
  // Load previous decisions from Convex
  const recentLogs = await getRecentAILogs(userId, 5);
  
  const memory = new BufferMemory({
    memoryKey: "chat_history",
    inputKey: "market_data",
    outputKey: "decision",
  });
  
  // Pre-populate memory with recent decisions
  for (const log of recentLogs) {
    await memory.saveContext(
      { market_data: log.marketData },
      { decision: log.decision }
    );
  }
  
  const chain = new ConversationChain({
    llm: model,
    memory,
    prompt: tradingPromptWithHistory,
  });
  
  return chain;
}
```

### 3. Tool Calling (Future Feature)

**File: `convex/ai/tools/marketTools.ts`**
```typescript
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export const getHistoricalDataTool = new DynamicStructuredTool({
  name: "get_historical_data",
  description: "Get historical price data for a symbol",
  schema: z.object({
    symbol: z.string(),
    timeframe: z.enum(["1h", "4h", "1d"]),
    periods: z.number(),
  }),
  func: async ({ symbol, timeframe, periods }) => {
    // Fetch from Hyperliquid or other data source
    return historicalData;
  },
});

export const calculateIndicatorTool = new DynamicStructuredTool({
  name: "calculate_indicator",
  description: "Calculate a technical indicator",
  schema: z.object({
    indicator: z.enum(["RSI", "MACD", "BOLLINGER"]),
    symbol: z.string(),
    period: z.number(),
  }),
  func: async ({ indicator, symbol, period }) => {
    // Calculate indicator
    return result;
  },
});
```

---

## Benefits of LangChain Integration

### ✅ Type Safety
```typescript
// Before (string parsing, error-prone)
const decision = JSON.parse(response);
if (decision.action === "OPEN_LONG") { /* ... */ }

// After (fully typed, autocomplete, compile-time checks)
const decision: TradeDecision = await chain.invoke(input);
if (decision.decision === "OPEN_LONG") { /* ... */ }
```

### ✅ Reliable Parsing
```typescript
// Zod automatically validates and converts
const decision = TradeDecisionSchema.parse(data);
// TypeScript knows: decision.confidence is a number between 0-1
// TypeScript knows: decision.decision is one of 4 specific strings
```

### ✅ Better Error Handling
```typescript
try {
  const decision = await tradeDecisionParser.parse(response);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.log("Invalid decision format:", error.errors);
    // Can fallback or retry
  }
}
```

### ✅ Prompt Management
```typescript
// Easy to update prompts without changing code
export const SYSTEM_PROMPT = SystemMessagePromptTemplate.fromTemplate(`
  You are a trader with {experience} years of experience.
  Your risk tolerance is {riskLevel}.
  Your trading style is {style}.
`);

// Use with different configs
const conservativeTrader = SYSTEM_PROMPT.format({
  experience: 10,
  riskLevel: "low",
  style: "swing trading"
});
```

### ✅ Chain Composition
```typescript
// Break complex logic into steps
const analysisChain = createAnalysisChain();
const decisionChain = createDecisionChain();

// Combine them
const fullChain = RunnableSequence.from([
  analysisChain,
  decisionChain,
]);
```

---

## Updated Implementation Timeline

### Week 2: Backend Development (Updated)

#### Day 8: Setup LangChain (2-3 hours)
- [ ] Install LangChain packages
- [ ] Create Zod schemas
- [ ] Test basic chain

#### Day 9: Custom Models (3-4 hours)
- [ ] Implement ZhipuAI LangChain model
- [ ] Implement OpenRouter LangChain model
- [ ] Test both models

#### Day 10-11: Prompt Templates (4-5 hours)
- [ ] Create system prompt template
- [ ] Create market data prompt template
- [ ] Create risk assessment prompt
- [ ] Test with real data

#### Day 12-13: Chains & Parsers (4-5 hours)
- [ ] Build trading chain
- [ ] Implement structured output parser
- [ ] Add error handling
- [ ] Test end-to-end

#### Day 14: Integration (3-4 hours)
- [ ] Update trading loop to use LangChain
- [ ] Test complete flow
- [ ] Verify structured outputs

---

## Testing LangChain Integration

### Test File: `convex/ai/test.ts`
```typescript
import { action } from "../_generated/server";
import { createTradingChain } from "./chains/tradingChain";

export const testTradingChain = action({
  handler: async (ctx) => {
    const chain = createTradingChain(
      "zhipuai",
      "glm-4-plus",
      process.env.ZHIPUAI_API_KEY!,
      {
        maxLeverage: 15,
        maxPositionSize: 0.2,
      }
    );
    
    const mockInput = {
      marketData: {
        BTC: {
          price: 100000,
          indicators: {
            rsi: 65,
            macd: 150,
            macd_signal: 120,
            price_change_short: 2.5,
            price_change_medium: 8.3,
          },
        },
      },
      accountState: {
        accountValue: 10000,
        withdrawable: 9000,
        totalMarginUsed: 1000,
      },
      positions: [],
    };
    
    const decision = await chain.invoke(mockInput);
    
    console.log("Decision:", decision);
    
    return decision;
  },
});
```

Run test:
```bash
# In Convex dashboard, run:
testTradingChain()
```

---

## Migration Strategy

If you've already started without LangChain:

### Step 1: Install (5 min)
```bash
npm install langchain @langchain/core @langchain/openai @langchain/community zod zod-to-json-schema
```

### Step 2: Create Schemas (30 min)
Start with `schemas.ts` - define your data structures

### Step 3: Wrap Existing Models (1 hour)
Create LangChain wrappers for your current AI integrations

### Step 4: Create Simple Chain (1 hour)
Build one basic chain that replaces your current prompting

### Step 5: Test & Iterate (2 hours)
Verify it works better than your current approach

### Step 6: Replace Gradually (2-3 hours)
Swap out your old prompting code with LangChain chains

**Total migration: 1 day**

---

## Recommended Approach

### Start Simple
```typescript
// Week 1: Basic chain with structured output
const chain = RunnableSequence.from([
  prompt,
  model,
  parser,
]);
```

### Add Complexity Later
```typescript
// Week 3-4: Multi-step reasoning
const chain = RunnableSequence.from([
  analysisStep,
  riskStep,
  decisionStep,
]);
```

### Eventually: Full Agent
```typescript
// Month 2: Agent with tools
const agent = createReActAgent({
  llm: model,
  tools: [
    getHistoricalDataTool,
    calculateIndicatorTool,
    newsSearchTool,
  ],
});
```

---

## Resources

### LangChain.js Documentation
- [Getting Started](https://js.langchain.com/docs/get_started/introduction)
- [Chains](https://js.langchain.com/docs/modules/chains/)
- [Prompts](https://js.langchain.com/docs/modules/model_io/prompts/)
- [Output Parsers](https://js.langchain.com/docs/modules/model_io/output_parsers/)
- [Custom Models](https://js.langchain.com/docs/modules/model_io/models/chat/custom)

### Zod
- [Zod Documentation](https://zod.dev/)
- [Zod to JSON Schema](https://github.com/StefanTerdell/zod-to-json-schema)

### Examples
- [LangChain Trading Example](https://github.com/langchain-ai/langchainjs/tree/main/examples)
- [Structured Output Guide](https://js.langchain.com/docs/modules/model_io/output_parsers/types/structured)

---

## Key Takeaways

1. **LangChain makes prompting robust** - No more fragile string parsing
2. **Zod provides type safety** - Catch errors at compile time
3. **Chains enable complex reasoning** - Break problems into steps
4. **Easy to test and iterate** - Change prompts without touching code
5. **Future-proof** - Easy to add tools, memory, agents later

Start with basic chains, add complexity as needed. LangChain is perfect for this use case! 🚀

---

## Next Steps

1. Install LangChain packages
2. Create your first Zod schema
3. Build a simple chain
4. Test with mock data
5. Integrate into trading loop

**Ready to add LangChain!** Let me know if you need any clarification on the implementation.
