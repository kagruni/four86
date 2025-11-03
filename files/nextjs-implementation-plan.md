# Alpha Arena Clone - Next.js Implementation Plan

## Project Overview

A single-model AI trading application that autonomously trades crypto on Hyperliquid DEX using AI decision-making. Built with modern web technologies for real-time monitoring and control.

---

## Technology Stack

### Frontend
- **Framework**: Next.js 14+ (App Router)
- **Styling**: Tailwind CSS + Shadcn/ui
- **Authentication**: Clerk
- **Real-time Updates**: Convex subscriptions
- **Charts**: Recharts or TradingView widgets
- **State Management**: React hooks + Convex queries

### Backend
- **Database & API**: Convex
- **Trading Integration**: Hyperliquid Node.js SDK
- **AI Models**: 
  - ZhipuAI API (GLM-4.6)
  - OpenRouter API (all other models)

### Infrastructure
- **Hosting**: Vercel (Next.js) + Convex Cloud
- **Cron Jobs**: Convex scheduled functions
- **Environment**: Node.js 18+

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Next.js Frontend                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Dashboard (Shadcn/ui + Tailwind)                   │   │
│  │  - Live account value                               │   │
│  │  - Position cards                                   │   │
│  │  - Trade history                                    │   │
│  │  - AI reasoning logs                                │   │
│  │  - Model selection                                  │   │
│  │  - Start/Stop controls                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                         ↕ (Convex subscriptions)            │
└─────────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────────┐
│                     Convex Backend                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Queries (Real-time data)                            │  │
│  │  - Get account state                                 │  │
│  │  - Get positions                                     │  │
│  │  - Get trade history                                 │  │
│  │  - Get AI logs                                       │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Mutations (Write operations)                        │  │
│  │  - Update bot status                                 │  │
│  │  - Save trade                                        │  │
│  │  - Save AI reasoning                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Actions (External API calls)                        │  │
│  │  - Query AI models (ZhipuAI, OpenRouter)           │  │
│  │  - Execute trades (Hyperliquid)                     │  │
│  │  - Fetch market data                                │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Scheduled Functions (Cron)                          │  │
│  │  - Trading loop (every 3 minutes)                   │  │
│  │  - Position monitor (every 1 minute)                │  │
│  │  - Account sync (every 5 minutes)                   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────────┐
│                   External Services                          │
│  - Hyperliquid API (Trading)                                │
│  - ZhipuAI API (GLM-4.6)                                    │
│  - OpenRouter API (GPT, Claude, Gemini, etc.)              │
└─────────────────────────────────────────────────────────────┘
```

---

## Convex + Long-Running Operations Strategy

### The Challenge
Convex actions have a **5-minute timeout**. Our trading loop needs to run continuously.

### Solution: Scheduled Functions (Cron)

Convex supports scheduled functions that run on a schedule. Perfect for our use case!

```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Main trading loop - runs every 3 minutes
crons.interval(
  "trading loop",
  { minutes: 3 },
  internal.trading.runTradingCycle
);

// Position monitoring - runs every 1 minute
crons.interval(
  "position monitor",
  { minutes: 1 },
  internal.trading.monitorPositions
);

// Account sync - runs every 5 minutes
crons.interval(
  "account sync",
  { minutes: 5 },
  internal.trading.syncAccountState
);

export default crons;
```

### How It Works

1. **Scheduled Function** triggers every 3 minutes
2. Calls an **Internal Action** that:
   - Fetches market data
   - Queries AI model
   - Parses response
   - Executes trades
3. **Mutations** save results to database
4. **Frontend** receives updates via subscriptions

### Backup Strategy: External Worker

If Convex crons don't meet requirements, we can use:
- **Vercel Cron Jobs** (trigger Next.js API routes)
- **External Node.js worker** (separate process)
- **GitHub Actions** (scheduled workflows)

---

## Database Schema (Convex)

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Bot configuration and status
  botConfig: defineTable({
    userId: v.string(), // Clerk user ID
    modelName: v.string(), // "glm-4.6" or OpenRouter model
    isActive: v.boolean(),
    startingCapital: v.number(),
    currentCapital: v.number(),
    
    // Trading settings
    symbols: v.array(v.string()), // ["BTC", "ETH", "SOL"]
    maxLeverage: v.number(),
    maxPositionSize: v.number(),
    stopLossEnabled: v.boolean(),
    
    // Risk management
    maxDailyLoss: v.number(),
    minAccountValue: v.number(),
    
    // API keys (encrypted)
    hyperliquidPrivateKey: v.string(),
    hyperliquidAddress: v.string(),
    
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Trading positions
  positions: defineTable({
    userId: v.string(),
    symbol: v.string(), // "BTC"
    side: v.string(), // "LONG" or "SHORT"
    size: v.number(),
    leverage: v.number(),
    entryPrice: v.number(),
    currentPrice: v.number(),
    unrealizedPnl: v.number(),
    unrealizedPnlPct: v.number(),
    stopLoss: v.optional(v.number()),
    takeProfit: v.optional(v.number()),
    liquidationPrice: v.number(),
    
    openedAt: v.number(),
    lastUpdated: v.number(),
  }).index("by_userId", ["userId"])
    .index("by_symbol", ["userId", "symbol"]),

  // Trade history
  trades: defineTable({
    userId: v.string(),
    symbol: v.string(),
    action: v.string(), // "OPEN" or "CLOSE"
    side: v.string(), // "LONG" or "SHORT"
    size: v.number(),
    leverage: v.number(),
    price: v.number(),
    pnl: v.optional(v.number()), // For closing trades
    pnlPct: v.optional(v.number()),
    
    // AI decision context
    aiReasoning: v.string(),
    aiModel: v.string(),
    
    // Hyperliquid transaction
    txHash: v.optional(v.string()),
    
    executedAt: v.number(),
  }).index("by_userId", ["userId"])
    .index("by_userId_time", ["userId", "executedAt"]),

  // AI reasoning logs
  aiLogs: defineTable({
    userId: v.string(),
    modelName: v.string(),
    
    // Prompt data
    systemPrompt: v.string(),
    userPrompt: v.string(),
    
    // Response
    rawResponse: v.string(),
    parsedResponse: v.optional(v.any()),
    
    // Decision
    decision: v.string(), // "OPEN", "CLOSE", "HOLD"
    reasoning: v.string(),
    
    // Context
    accountValue: v.number(),
    marketData: v.any(),
    
    // Timing
    processingTimeMs: v.number(),
    createdAt: v.number(),
  }).index("by_userId", ["userId"])
    .index("by_userId_time", ["userId", "createdAt"]),

  // Account snapshots (for performance tracking)
  accountSnapshots: defineTable({
    userId: v.string(),
    accountValue: v.number(),
    totalPnl: v.number(),
    totalPnlPct: v.number(),
    
    numTrades: v.number(),
    winRate: v.number(),
    
    positions: v.array(v.any()),
    
    timestamp: v.number(),
  }).index("by_userId", ["userId"])
    .index("by_userId_time", ["userId", "timestamp"]),

  // System events/logs
  systemLogs: defineTable({
    userId: v.optional(v.string()),
    level: v.string(), // "INFO", "WARNING", "ERROR"
    message: v.string(),
    data: v.optional(v.any()),
    timestamp: v.number(),
  }).index("by_timestamp", ["timestamp"]),
});
```

---

## Implementation Plan

### Phase 1: Project Setup (Week 1)

#### 1.1 Initialize Next.js Project
```bash
npx create-next-app@latest alpha-arena-trader --typescript --tailwind --app
cd alpha-arena-trader
```

#### 1.2 Install Core Dependencies
```bash
# Convex
npm install convex

# Clerk authentication
npm install @clerk/nextjs

# Shadcn/ui
npx shadcn-ui@latest init

# Additional UI components
npm install recharts lucide-react date-fns

# Hyperliquid SDK
npm install hyperliquid

# AI clients
npm install openai
# Note: ZhipuAI doesn't have official SDK, we'll use fetch
```

#### 1.3 Setup Convex
```bash
npx convex dev
```

#### 1.4 Setup Clerk
1. Create account at clerk.com
2. Create application
3. Add environment variables
4. Wrap app with ClerkProvider

#### 1.5 Project Structure
```
alpha-arena-trader/
├── app/
│   ├── (auth)/
│   │   ├── sign-in/[[...sign-in]]/page.tsx
│   │   └── sign-up/[[...sign-up]]/page.tsx
│   ├── (dashboard)/
│   │   ├── dashboard/
│   │   │   └── page.tsx
│   │   ├── settings/
│   │   │   └── page.tsx
│   │   ├── trades/
│   │   │   └── page.tsx
│   │   └── layout.tsx
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ui/              # Shadcn components
│   ├── dashboard/
│   │   ├── account-value-card.tsx
│   │   ├── positions-table.tsx
│   │   ├── trade-history.tsx
│   │   ├── ai-reasoning-log.tsx
│   │   └── bot-controls.tsx
│   └── shared/
├── convex/
│   ├── _generated/
│   ├── schema.ts
│   ├── queries.ts
│   ├── mutations.ts
│   ├── actions.ts
│   ├── crons.ts
│   ├── trading/
│   │   ├── tradingLoop.ts
│   │   ├── positionMonitor.ts
│   │   └── accountSync.ts
│   ├── ai/
│   │   ├── zhipuai.ts
│   │   ├── openrouter.ts
│   │   └── promptBuilder.ts
│   └── hyperliquid/
│       ├── client.ts
│       ├── executor.ts
│       └── dataFetcher.ts
├── lib/
│   ├── utils.ts
│   └── constants.ts
└── types/
    └── trading.ts
```

---

### Phase 2: Backend Development (Week 2-3)

#### 2.1 Convex Schema
Create `convex/schema.ts` (shown above)

#### 2.2 Hyperliquid Integration

**File: `convex/hyperliquid/client.ts`**
```typescript
import { action } from "../_generated/server";
import { v } from "convex/values";
import Hyperliquid from "hyperliquid";

// Create Hyperliquid client
export const createHyperliquidClient = (
  privateKey: string,
  address: string,
  testnet: boolean = true
) => {
  const info = new Hyperliquid.InfoAPI(testnet ? "testnet" : "mainnet");
  const exchange = new Hyperliquid.ExchangeAPI(privateKey, testnet);
  
  return { info, exchange };
};

// Get market data
export const getMarketData = action({
  args: {
    symbols: v.array(v.string()),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { info } = createHyperliquidClient("", "", args.testnet);
    
    const marketData: Record<string, any> = {};
    
    for (const symbol of args.symbols) {
      try {
        const allMids = await info.getAllMids();
        const meta = await info.getMeta();
        
        // Get price
        const price = allMids[symbol];
        
        // Get 24h volume and funding rate
        // Note: Adapt to actual Hyperliquid SDK methods
        
        marketData[symbol] = {
          symbol,
          price,
          timestamp: Date.now(),
        };
      } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error);
      }
    }
    
    return marketData;
  },
});

// Get account state
export const getAccountState = action({
  args: {
    address: v.string(),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { info } = createHyperliquidClient("", "", args.testnet);
    
    const userState = await info.getUserState(args.address);
    
    return {
      accountValue: userState.marginSummary.accountValue,
      totalMarginUsed: userState.marginSummary.totalMarginUsed,
      withdrawable: userState.withdrawable,
      positions: userState.assetPositions,
    };
  },
});

// Place order
export const placeOrder = action({
  args: {
    privateKey: v.string(),
    symbol: v.string(),
    isBuy: v.boolean(),
    size: v.number(),
    leverage: v.number(),
    price: v.optional(v.number()),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { exchange } = createHyperliquidClient(
      args.privateKey,
      "", // address not needed for orders
      args.testnet
    );
    
    const order = {
      coin: args.symbol,
      is_buy: args.isBuy,
      sz: args.size,
      limit_px: args.price,
      order_type: { limit: { tif: "Gtc" } },
      reduce_only: false,
    };
    
    const result = await exchange.order(order, args.leverage);
    
    return result;
  },
});
```

#### 2.3 AI Integration

**File: `convex/ai/zhipuai.ts`**
```typescript
import { action } from "../_generated/server";
import { v } from "convex/values";

export const queryZhipuAI = action({
  args: {
    systemPrompt: v.string(),
    userPrompt: v.string(),
    apiKey: v.string(),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      // ZhipuAI API endpoint
      const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${args.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "glm-4-plus",
          messages: [
            { role: "system", content: args.systemPrompt },
            { role: "user", content: args.userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`ZhipuAI API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      const processingTime = Date.now() - startTime;
      
      return {
        content: data.choices[0].message.content,
        model: "glm-4-plus",
        processingTimeMs: processingTime,
      };
    } catch (error) {
      console.error("ZhipuAI error:", error);
      throw error;
    }
  },
});
```

**File: `convex/ai/openrouter.ts`**
```typescript
import { action } from "../_generated/server";
import { v } from "convex/values";

export const queryOpenRouter = action({
  args: {
    model: v.string(), // "anthropic/claude-3.5-sonnet", "openai/gpt-4-turbo", etc.
    systemPrompt: v.string(),
    userPrompt: v.string(),
    apiKey: v.string(),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${args.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
          "X-Title": "Alpha Arena Trader",
        },
        body: JSON.stringify({
          model: args.model,
          messages: [
            { role: "system", content: args.systemPrompt },
            { role: "user", content: args.userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      const processingTime = Date.now() - startTime;
      
      return {
        content: data.choices[0].message.content,
        model: args.model,
        processingTimeMs: processingTime,
      };
    } catch (error) {
      console.error("OpenRouter error:", error);
      throw error;
    }
  },
});
```

**File: `convex/ai/promptBuilder.ts`**
```typescript
export const SYSTEM_PROMPT = `You are an autonomous cryptocurrency trading agent.

You manage a trading account and make decisions based on technical analysis and market conditions.

RULES:
- Every position MUST have a stop-loss
- Use leverage between 5x-20x based on conviction
- Consider risk/reward ratio (minimum 1:2)
- Never risk more than 2% of account on a single trade

RESPONSE FORMAT (JSON):
{
  "reasoning": "Your detailed analysis of market conditions",
  "decision": "OPEN_LONG" | "OPEN_SHORT" | "CLOSE" | "HOLD",
  "symbol": "BTC" | "ETH" | "SOL" | etc,
  "leverage": 10,
  "size_usd": 1000,
  "stop_loss": 95000,
  "take_profit": 105000,
  "confidence": 0.75
}

Only trade when you see clear opportunities. It's better to HOLD than force trades.`;

export function buildUserPrompt(
  marketData: Record<string, any>,
  accountState: any,
  positions: any[]
) {
  const timestamp = new Date().toISOString();
  
  let prompt = `# Trading Update - ${timestamp}\n\n`;
  
  // Market data
  prompt += `## Market Data\n\n`;
  for (const [symbol, data] of Object.entries(marketData)) {
    prompt += `### ${symbol}\n`;
    prompt += `- Price: $${data.price.toFixed(2)}\n`;
    prompt += `- RSI: ${data.rsi.toFixed(1)}\n`;
    prompt += `- MACD: ${data.macd.toFixed(2)}\n`;
    prompt += `- Trend: ${data.trend}\n\n`;
  }
  
  // Account state
  prompt += `## Account Status\n\n`;
  prompt += `- Account Value: $${accountState.accountValue.toFixed(2)}\n`;
  prompt += `- Available Cash: $${accountState.withdrawable.toFixed(2)}\n`;
  prompt += `- Margin Used: $${accountState.totalMarginUsed.toFixed(2)}\n\n`;
  
  // Positions
  if (positions.length > 0) {
    prompt += `## Current Positions\n\n`;
    for (const pos of positions) {
      prompt += `**${pos.symbol}** - ${pos.side}\n`;
      prompt += `- Size: $${pos.size.toFixed(2)}\n`;
      prompt += `- Entry: $${pos.entryPrice.toFixed(2)}\n`;
      prompt += `- Current: $${pos.currentPrice.toFixed(2)}\n`;
      prompt += `- P&L: ${pos.unrealizedPnlPct.toFixed(2)}%\n\n`;
    }
  } else {
    prompt += `## Current Positions\n\nNo open positions.\n\n`;
  }
  
  prompt += `## Task\n\nAnalyze the data and decide your next action. Respond in JSON format.`;
  
  return prompt;
}
```

#### 2.4 Trading Loop

**File: `convex/trading/tradingLoop.ts`**
```typescript
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getMarketData, getAccountState, placeOrder } from "../hyperliquid/client";
import { queryZhipuAI } from "../ai/zhipuai";
import { queryOpenRouter } from "../ai/openrouter";
import { SYSTEM_PROMPT, buildUserPrompt } from "../ai/promptBuilder";

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
        
        // 4. Build prompt
        const userPrompt = buildUserPrompt(marketData, accountState, positions);
        
        // 5. Query AI model
        let aiResponse;
        if (bot.modelName === "glm-4-plus") {
          aiResponse = await queryZhipuAI({
            systemPrompt: SYSTEM_PROMPT,
            userPrompt,
            apiKey: process.env.ZHIPUAI_API_KEY!,
          });
        } else {
          aiResponse = await queryOpenRouter({
            model: bot.modelName,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt,
            apiKey: process.env.OPENROUTER_API_KEY!,
          });
        }
        
        // 6. Parse response
        const decision = parseAIResponse(aiResponse.content);
        
        // 7. Save AI log
        await ctx.runMutation(internal.mutations.saveAILog, {
          userId: bot.userId,
          modelName: bot.modelName,
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          rawResponse: aiResponse.content,
          parsedResponse: decision,
          decision: decision.decision,
          reasoning: decision.reasoning,
          accountValue: accountState.accountValue,
          marketData,
          processingTimeMs: aiResponse.processingTimeMs,
        });
        
        // 8. Execute trade if needed
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

function parseAIResponse(response: string) {
  // Extract JSON from response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in response");
  }
  
  return JSON.parse(jsonMatch[0]);
}

async function executeTradeDecision(ctx: any, bot: any, decision: any, accountState: any) {
  // Risk checks
  if (decision.size_usd > accountState.accountValue * bot.maxPositionSize) {
    console.log("Trade rejected: position size too large");
    return;
  }
  
  // Execute trade via Hyperliquid
  const result = await placeOrder({
    privateKey: bot.hyperliquidPrivateKey,
    symbol: decision.symbol,
    isBuy: decision.decision === "OPEN_LONG",
    size: decision.size_usd / accountState.accountValue,
    leverage: decision.leverage,
    testnet: true,
  });
  
  // Save trade
  await ctx.runMutation(internal.mutations.saveTrade, {
    userId: bot.userId,
    symbol: decision.symbol,
    action: decision.decision.includes("OPEN") ? "OPEN" : "CLOSE",
    side: decision.decision.includes("LONG") ? "LONG" : "SHORT",
    size: decision.size_usd,
    leverage: decision.leverage,
    price: result.price,
    aiReasoning: decision.reasoning,
    aiModel: bot.modelName,
    txHash: result.txHash,
  });
}
```

#### 2.5 Scheduled Functions

**File: `convex/crons.ts`**
```typescript
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Main trading loop - every 3 minutes
crons.interval(
  "trading-loop",
  { minutes: 3 },
  internal.trading.tradingLoop.runTradingCycle
);

// Position monitoring - every 1 minute
crons.interval(
  "position-monitor",
  { minutes: 1 },
  internal.trading.positionMonitor.checkPositions
);

// Account sync - every 5 minutes
crons.interval(
  "account-sync",
  { minutes: 5 },
  internal.trading.accountSync.syncAllAccounts
);

export default crons;
```

---

### Phase 3: Frontend Development (Week 4-5)

#### 3.1 Setup Clerk Authentication

**File: `app/layout.tsx`**
```tsx
import { ClerkProvider } from '@clerk/nextjs';
import { ConvexClientProvider } from '@/components/providers/convex-provider';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <ConvexClientProvider>
            {children}
          </ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
```

**File: `components/providers/convex-provider.tsx`**
```tsx
"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useAuth } from "@clerk/nextjs";
import { ConvexProviderWithClerk } from "convex/react-clerk";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
```

#### 3.2 Dashboard Layout

**File: `app/(dashboard)/layout.tsx`**
```tsx
import { UserButton } from "@clerk/nextjs";
import { MainNav } from "@/components/dashboard/main-nav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <MainNav />
          <div className="ml-auto flex items-center space-x-4">
            <UserButton />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
```

#### 3.3 Dashboard Page Components

**File: `app/(dashboard)/dashboard/page.tsx`**
```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AccountValueCard } from "@/components/dashboard/account-value-card";
import { PositionsTable } from "@/components/dashboard/positions-table";
import { TradeHistory } from "@/components/dashboard/trade-history";
import { AIReasoningLog } from "@/components/dashboard/ai-reasoning-log";
import { BotControls } from "@/components/dashboard/bot-controls";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  const botConfig = useQuery(api.queries.getBotConfig);
  const positions = useQuery(api.queries.getPositions);
  const trades = useQuery(api.queries.getRecentTrades, { limit: 10 });
  const aiLogs = useQuery(api.queries.getRecentAILogs, { limit: 5 });
  
  if (!botConfig) {
    return <DashboardSkeleton />;
  }
  
  return (
    <div className="container py-6 space-y-6">
      {/* Header with controls */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trading Dashboard</h1>
          <p className="text-muted-foreground">
            Model: {botConfig.modelName}
          </p>
        </div>
        <BotControls botConfig={botConfig} />
      </div>
      
      {/* Account value */}
      <AccountValueCard
        currentValue={botConfig.currentCapital}
        startingValue={botConfig.startingCapital}
      />
      
      {/* Positions grid */}
      <div className="grid gap-6 md:grid-cols-2">
        <PositionsTable positions={positions ?? []} />
        <TradeHistory trades={trades ?? []} />
      </div>
      
      {/* AI reasoning */}
      <AIReasoningLog logs={aiLogs ?? []} />
    </div>
  );
}
```

**File: `components/dashboard/account-value-card.tsx`**
```tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

interface AccountValueCardProps {
  currentValue: number;
  startingValue: number;
}

export function AccountValueCard({ currentValue, startingValue }: AccountValueCardProps) {
  const pnl = currentValue - startingValue;
  const pnlPct = ((pnl / startingValue) * 100).toFixed(2);
  const isProfit = pnl >= 0;
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account Value</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline space-x-3">
          <span className="text-4xl font-bold">
            ${currentValue.toFixed(2)}
          </span>
          <div className={`flex items-center space-x-1 ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
            {isProfit ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            <span className="text-xl font-semibold">
              {isProfit ? '+' : ''}{pnlPct}%
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          Starting: ${startingValue.toFixed(2)} • P&L: {isProfit ? '+' : ''}${Math.abs(pnl).toFixed(2)}
        </p>
      </CardContent>
    </Card>
  );
}
```

**File: `components/dashboard/bot-controls.tsx`**
```tsx
"use client";

import { Button } from "@/components/ui/button";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Play, Pause, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface BotControlsProps {
  botConfig: any;
}

export function BotControls({ botConfig }: BotControlsProps) {
  const toggleBot = useMutation(api.mutations.toggleBot);
  const resetBot = useMutation(api.mutations.resetBot);
  
  const handleToggle = async () => {
    try {
      await toggleBot({ isActive: !botConfig.isActive });
      toast.success(botConfig.isActive ? "Bot stopped" : "Bot started");
    } catch (error) {
      toast.error("Failed to toggle bot");
    }
  };
  
  const handleReset = async () => {
    if (!confirm("Are you sure? This will reset your account to starting capital.")) {
      return;
    }
    
    try {
      await resetBot();
      toast.success("Bot reset successfully");
    } catch (error) {
      toast.error("Failed to reset bot");
    }
  };
  
  return (
    <div className="flex items-center space-x-2">
      <Button
        onClick={handleToggle}
        variant={botConfig.isActive ? "destructive" : "default"}
      >
        {botConfig.isActive ? (
          <>
            <Pause className="mr-2 h-4 w-4" />
            Stop Trading
          </>
        ) : (
          <>
            <Play className="mr-2 h-4 w-4" />
            Start Trading
          </>
        )}
      </Button>
      
      <Button onClick={handleReset} variant="outline">
        <RotateCcw className="mr-2 h-4 w-4" />
        Reset
      </Button>
    </div>
  );
}
```

**File: `components/dashboard/positions-table.tsx`**
```tsx
"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Position {
  symbol: string;
  side: string;
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  leverage: number;
}

interface PositionsTableProps {
  positions: Position[];
}

export function PositionsTable({ positions }: PositionsTableProps) {
  if (positions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Open Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No open positions</p>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open Positions</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead>Current</TableHead>
              <TableHead>P&L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.map((position, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{position.symbol}</TableCell>
                <TableCell>
                  <Badge variant={position.side === "LONG" ? "default" : "destructive"}>
                    {position.side}
                  </Badge>
                </TableCell>
                <TableCell>${position.size.toFixed(2)}</TableCell>
                <TableCell>${position.entryPrice.toFixed(2)}</TableCell>
                <TableCell>${position.currentPrice.toFixed(2)}</TableCell>
                <TableCell
                  className={position.unrealizedPnl >= 0 ? "text-green-600" : "text-red-600"}
                >
                  ${position.unrealizedPnl.toFixed(2)} ({position.unrealizedPnlPct.toFixed(2)}%)
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

**File: `components/dashboard/ai-reasoning-log.tsx`**
```tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface AILog {
  modelName: string;
  decision: string;
  reasoning: string;
  confidence?: number;
  createdAt: number;
}

interface AIReasoningLogProps {
  logs: AILog[];
}

export function AIReasoningLog({ logs }: AIReasoningLogProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Reasoning</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          <div className="space-y-4">
            {logs.map((log, i) => (
              <div key={i} className="border-l-2 border-muted pl-4 py-2">
                <div className="flex items-center justify-between mb-2">
                  <Badge>{log.decision}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm">{log.reasoning}</p>
                {log.confidence && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Confidence: {(log.confidence * 100).toFixed(0)}%
                  </p>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
```

#### 3.4 Settings Page

**File: `app/(dashboard)/settings/page.tsx`**
```tsx
"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useState } from "react";

export default function SettingsPage() {
  const botConfig = useQuery(api.queries.getBotConfig);
  const updateConfig = useMutation(api.mutations.updateBotConfig);
  
  const [formData, setFormData] = useState({
    modelName: botConfig?.modelName || "glm-4-plus",
    maxLeverage: botConfig?.maxLeverage || 15,
    maxPositionSize: botConfig?.maxPositionSize || 0.2,
    maxDailyLoss: botConfig?.maxDailyLoss || 0.1,
  });
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      await updateConfig(formData);
      toast.success("Settings updated");
    } catch (error) {
      toast.error("Failed to update settings");
    }
  };
  
  return (
    <div className="container py-6">
      <h1 className="text-3xl font-bold tracking-tight mb-6">Settings</h1>
      
      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>AI Model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="model">Select Model</Label>
              <Select
                value={formData.modelName}
                onValueChange={(value) => setFormData({ ...formData, modelName: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="glm-4-plus">GLM-4 Plus (ZhipuAI)</SelectItem>
                  <SelectItem value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</SelectItem>
                  <SelectItem value="openai/gpt-4-turbo">GPT-4 Turbo</SelectItem>
                  <SelectItem value="google/gemini-pro-1.5">Gemini Pro 1.5</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Risk Management</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="maxLeverage">Max Leverage</Label>
              <Input
                id="maxLeverage"
                type="number"
                value={formData.maxLeverage}
                onChange={(e) => setFormData({ ...formData, maxLeverage: Number(e.target.value) })}
              />
            </div>
            
            <div>
              <Label htmlFor="maxPositionSize">Max Position Size (%)</Label>
              <Input
                id="maxPositionSize"
                type="number"
                step="0.01"
                value={formData.maxPositionSize * 100}
                onChange={(e) => setFormData({ ...formData, maxPositionSize: Number(e.target.value) / 100 })}
              />
            </div>
            
            <div>
              <Label htmlFor="maxDailyLoss">Max Daily Loss (%)</Label>
              <Input
                id="maxDailyLoss"
                type="number"
                step="0.01"
                value={formData.maxDailyLoss * 100}
                onChange={(e) => setFormData({ ...formData, maxDailyLoss: Number(e.target.value) / 100 })}
              />
            </div>
          </CardContent>
        </Card>
        
        <Button type="submit">Save Settings</Button>
      </form>
    </div>
  );
}
```

---

### Phase 4: Testing & Deployment (Week 6)

#### 4.1 Testing Checklist

- [ ] Convex cron jobs trigger correctly
- [ ] AI API calls work (both ZhipuAI and OpenRouter)
- [ ] Hyperliquid testnet integration functional
- [ ] Clerk authentication works
- [ ] Real-time updates via Convex subscriptions
- [ ] Risk management checks prevent bad trades
- [ ] UI components render correctly
- [ ] Mobile responsive

#### 4.2 Environment Variables

**`.env.local`**
```bash
# Convex
CONVEX_DEPLOYMENT=dev:your-deployment-name
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
CLERK_SECRET_KEY=sk_test_xxxxx

# AI APIs
ZHIPUAI_API_KEY=xxxxx
OPENROUTER_API_KEY=sk-or-xxxxx

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

#### 4.3 Deployment

**Vercel (Frontend + API Routes)**
```bash
vercel deploy
```

**Convex (Backend)**
```bash
npx convex deploy
```

---

## Alternative to Convex Crons: Manual Orchestration

If Convex scheduled functions don't work well, here's a backup approach:

### Option A: Vercel Cron Jobs

**File: `app/api/cron/trading/route.ts`**
```typescript
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  
  // Trigger Convex action
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  await client.action(api.trading.tradingLoop.runTradingCycle);
  
  return NextResponse.json({ success: true });
}
```

**File: `vercel.json`**
```json
{
  "crons": [{
    "path": "/api/cron/trading",
    "schedule": "*/3 * * * *"
  }]
}
```

### Option B: External Worker Process

Create a separate Node.js script that runs continuously:

**File: `worker/index.ts`**
```typescript
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const client = new ConvexHttpClient(process.env.CONVEX_URL!);

async function runTradingLoop() {
  while (true) {
    try {
      await client.action(api.trading.tradingLoop.runTradingCycle);
      console.log("Trading cycle complete");
    } catch (error) {
      console.error("Error in trading loop:", error);
    }
    
    // Wait 3 minutes
    await new Promise(resolve => setTimeout(resolve, 3 * 60 * 1000));
  }
}

runTradingLoop();
```

Deploy with:
- Railway
- Render
- DigitalOcean
- AWS EC2

---

## Cost Breakdown

### Monthly Costs (Estimated)

| Service | Cost |
|---------|------|
| Convex | $0-25 (free tier covers most usage) |
| Vercel | $0-20 (hobby/pro) |
| Clerk | $0-25 (free tier + auth) |
| ZhipuAI API | ~$30-50 (480 calls/day) |
| OpenRouter API | ~$50-100 (for GPT-4/Claude) |
| Hyperliquid | $0 (just gas fees) |
| **Total** | **~$80-220/month** |

---

## Key Features Checklist

### Core Features
- [x] Single-model autonomous trading
- [x] ZhipuAI (GLM-4.6) integration
- [x] OpenRouter multi-model support
- [x] Hyperliquid DEX integration
- [x] Real-time dashboard
- [x] Trade history
- [x] AI reasoning logs
- [x] Position monitoring

### Advanced Features (Future)
- [ ] Backtesting mode
- [ ] Paper trading mode
- [ ] Multiple symbol support
- [ ] Custom indicators
- [ ] Telegram notifications
- [ ] Performance analytics
- [ ] Model comparison (switch between models)
- [ ] Strategy templates

---

## Development Timeline

### Week 1: Setup & Infrastructure
- Day 1-2: Initialize project, install dependencies
- Day 3-4: Setup Convex schema, Clerk auth
- Day 5-7: Basic UI components with Shadcn

### Week 2: Backend Core
- Day 1-2: Hyperliquid integration
- Day 3-4: ZhipuAI + OpenRouter integration
- Day 5-7: Prompt builder and response parser

### Week 3: Trading Logic
- Day 1-3: Trading loop implementation
- Day 4-5: Position monitoring
- Day 6-7: Risk management

### Week 4: Frontend Dashboard
- Day 1-3: Dashboard page components
- Day 4-5: Real-time subscriptions
- Day 6-7: Settings page

### Week 5: Polish & Testing
- Day 1-3: Testnet testing
- Day 4-5: Bug fixes
- Day 6-7: UI polish

### Week 6: Deployment
- Day 1-2: Production deployment
- Day 3-7: Monitoring and adjustments

**Total: 6 weeks**

---

## Getting Started Command Sequence

```bash
# 1. Create Next.js app
npx create-next-app@latest alpha-arena-trader --typescript --tailwind --app
cd alpha-arena-trader

# 2. Install dependencies
npm install convex @clerk/nextjs openai hyperliquid
npm install recharts lucide-react date-fns sonner

# 3. Setup Shadcn/ui
npx shadcn-ui@latest init
npx shadcn-ui@latest add button card table badge input label select

# 4. Initialize Convex
npx convex dev

# 5. Setup environment variables
cp .env.example .env.local
# Fill in your API keys

# 6. Run development server
npm run dev
```

---

## Security Considerations

### API Key Management
- Store in environment variables
- Never commit to git
- Encrypt sensitive keys in Convex
- Use Clerk for user auth

### Risk Management
- Circuit breakers for daily loss limits
- Position size limits
- Manual override controls
- Emergency stop functionality

### Data Privacy
- User data isolated per Clerk user ID
- Convex row-level security
- API keys encrypted at rest

---

## Conclusion

This plan provides a complete roadmap for building an Alpha Arena-style trading bot with:

✅ Modern tech stack (Next.js, Convex, Clerk, Shadcn)
✅ Single-model focus (simpler than multi-model competition)
✅ ZhipuAI + OpenRouter integration
✅ Convex scheduled functions for continuous operation
✅ Real-time dashboard with beautiful UI
✅ Comprehensive risk management
✅ 6-week implementation timeline

The Convex scheduled functions approach should work well for the 3-minute trading cycles. If you encounter issues, the backup plans (Vercel crons or external worker) are ready to go.

Ready to start building! 🚀
