# Four86 - AI Crypto Trading Bot

Autonomous AI trading bot on Hyperliquid DEX with LangChain integration.

## Trading Symbols
- BTC, ETH, SOL, BNB, DOGE, XRP

## Tech Stack
- **Frontend**: Next.js 15 + App Router
- **UI**: Shadcn/ui (Black & White theme)
- **Auth**: Clerk
- **Backend**: Convex (Database + API + Scheduled Functions)
- **Trading**: Hyperliquid DEX
- **AI**: LangChain.js + Zod (Structured Outputs)
  - ZhipuAI (GLM-4-plus)
  - OpenRouter (Claude, GPT, Gemini, etc.)
- **Deployment**: Vercel + Convex Cloud

## ✅ Completed

### Backend Core
- [x] Convex database schema (botConfig, positions, trades, aiLogs, etc.)
- [x] LangChain Zod schemas for type-safe trading decisions
- [x] Custom ZhipuAI LangChain model wrapper
- [x] OpenRouter LangChain model wrapper
- [x] Trading prompt templates
- [x] Trading chain with structured output parser
- [x] Hyperliquid SDK integration (market data, orders)
- [x] Trading agent with LangChain
- [x] Trading loop logic
- [x] Convex scheduled functions (runs every 3 minutes)
- [x] Convex queries and mutations

## 🚧 In Progress

### Frontend
- [ ] Clerk authentication setup
- [ ] Shadcn/ui configuration
- [ ] Dashboard page (black & white design)
- [ ] Settings page
- [ ] Real-time data subscriptions

## 📝 Next Steps

### 1. Environment Variables
Create `.env.local` and add:
```bash
# Convex (already set)
CONVEX_DEPLOYMENT=prod:coordinated-leopard-6
NEXT_PUBLIC_CONVEX_URL=https://coordinated-leopard-6.convex.cloud

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_key
CLERK_SECRET_KEY=your_clerk_secret

# AI APIs
ZHIPUAI_API_KEY=your_zhipuai_key
OPENROUTER_API_KEY=your_openrouter_key

# Hyperliquid (Testnet)
HYPERLIQUID_PRIVATE_KEY=your_private_key
HYPERLIQUID_ADDRESS=your_address

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 2. Start Development
```bash
# Terminal 1: Run Convex
npm run convex:dev

# Terminal 2: Run Next.js
npm run dev
```

### 3. Build Frontend
- Set up Clerk authentication
- Configure Shadcn/ui components
- Build dashboard with black/white design
- Create settings page for bot configuration

### 4. Test
- Test on Hyperliquid testnet
- Monitor trading loop execution
- Verify AI decisions

## Architecture

```
Next.js Frontend (Black & White)
    ↓
Convex Backend
    ├─ Scheduled Functions (every 3 min)
    ├─ LangChain Trading Agent
    ├─ Zod Schema Validation
    └─ Hyperliquid Integration
    ↓
AI Models (ZhipuAI / OpenRouter)
    ↓
Hyperliquid DEX (Testnet)
```

## Key Features

### Type-Safe AI Decisions
```typescript
const decision: TradeDecision = await tradingChain.invoke(input);
// TypeScript knows: decision.decision is "OPEN_LONG" | "OPEN_SHORT" | "CLOSE" | "HOLD"
// TypeScript knows: decision.confidence is number between 0-1
```

### Structured Outputs with Zod
- No more fragile JSON parsing
- Compile-time type checking
- Automatic validation

### Automated Trading
- Runs every 2 minutes via Convex crons
- LangChain agent analyzes market data
- Executes trades based on AI decisions
- Risk management built-in

## UI Design Principles

- **Colors**: Black and white only (monochrome)
- **Components**: ShadCN exclusively
- **Style**: Clean, minimal, professional

## Development Status

**Backend**: 95% Complete ✅
**Frontend**: 10% Complete 🚧
**Testing**: 0% Complete ⏳

## License

Private
