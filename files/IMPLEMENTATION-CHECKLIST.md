# Alpha Arena Trader - Implementation Checklist

Track your progress building the AI trading bot with this day-by-day checklist.

---

## Week 1: Project Setup & Infrastructure

### Day 1: Initialize Project ⏱️ 2-3 hours
- [ ] Create Next.js app: `npx create-next-app@latest alpha-arena-trader --typescript --tailwind --app`
- [ ] Initialize git repository
- [ ] Install core dependencies (convex, clerk, etc.)
- [ ] Setup Shadcn/ui: `npx shadcn-ui@latest init`
- [ ] Create project structure (folders: app, components, convex, lib, types)
- [ ] Create README.md with project description

**Verification:** `npm run dev` works, app runs on localhost:3000

### Day 2: Setup Convex ⏱️ 2-3 hours
- [ ] Sign up for Convex account
- [ ] Run `npx convex dev`
- [ ] Create `convex/schema.ts` with all tables:
  - [ ] botConfig table
  - [ ] positions table
  - [ ] trades table
  - [ ] aiLogs table
  - [ ] accountSnapshots table
  - [ ] systemLogs table
- [ ] Add indexes to schema
- [ ] Push schema to Convex

**Verification:** Schema visible in Convex dashboard

### Day 3: Setup Clerk Authentication ⏱️ 2-3 hours
- [ ] Create Clerk account
- [ ] Create new application
- [ ] Copy API keys to `.env.local`
- [ ] Wrap app in `ClerkProvider` (app/layout.tsx)
- [ ] Create ConvexProviderWithClerk (components/providers/convex-provider.tsx)
- [ ] Create sign-in page: app/(auth)/sign-in/[[...sign-in]]/page.tsx
- [ ] Create sign-up page: app/(auth)/sign-up/[[...sign-up]]/page.tsx
- [ ] Test authentication flow

**Verification:** Can sign up, sign in, see user button

### Day 4: Environment & Configuration ⏱️ 2-3 hours
- [ ] Copy `.env.example.nextjs` to `.env.local`
- [ ] Get ZhipuAI API key (https://open.bigmodel.cn/)
- [ ] Get OpenRouter API key (https://openrouter.ai/)
- [ ] Setup Hyperliquid testnet wallet
- [ ] Get testnet USDC from faucet
- [ ] Generate Hyperliquid API keys
- [ ] Add all keys to `.env.local`
- [ ] Add `.env.local` to `.gitignore`

**Verification:** All environment variables set

### Day 5-7: Basic UI Components ⏱️ 4-6 hours
- [ ] Install Shadcn components: `npx shadcn-ui@latest add button card table badge input label select`
- [ ] Create dashboard layout (app/(dashboard)/layout.tsx)
- [ ] Create basic dashboard page (app/(dashboard)/dashboard/page.tsx)
- [ ] Create account value card component
- [ ] Create positions table component
- [ ] Create basic bot controls component
- [ ] Style with Tailwind

**Verification:** Dashboard loads with placeholder data

---

## Week 2: Backend Core - Hyperliquid & AI

### Day 8: Hyperliquid Client ⏱️ 3-4 hours
- [ ] Install hyperliquid SDK: `npm install hyperliquid`
- [ ] Create `convex/hyperliquid/client.ts`
- [ ] Implement `createHyperliquidClient()` function
- [ ] Create `getMarketData` action
- [ ] Create `getAccountState` action
- [ ] Test market data fetching in Convex dashboard

**Verification:** Can fetch BTC/ETH/SOL prices in Convex

### Day 9: Hyperliquid Trading Functions ⏱️ 3-4 hours
- [ ] Create `convex/hyperliquid/executor.ts`
- [ ] Implement `placeOrder` action
- [ ] Implement `closePosition` action
- [ ] Implement `modifyOrder` action
- [ ] Add error handling
- [ ] Test on testnet with small amounts

**Verification:** Can place test orders on Hyperliquid testnet

### Day 10: ZhipuAI Integration ⏱️ 3-4 hours
- [ ] Create `convex/ai/zhipuai.ts`
- [ ] Implement `queryZhipuAI` action
- [ ] Test with simple prompt
- [ ] Handle errors and timeouts
- [ ] Log response times
- [ ] Verify JSON parsing works

**Verification:** Can query GLM-4 and get JSON response

### Day 11: OpenRouter Integration ⏱️ 2-3 hours
- [ ] Create `convex/ai/openrouter.ts`
- [ ] Implement `queryOpenRouter` action
- [ ] Support multiple models (Claude, GPT-4, Gemini)
- [ ] Test with each model
- [ ] Handle rate limits
- [ ] Add retry logic

**Verification:** Can query 3+ different models via OpenRouter

### Day 12-13: Prompt Engineering ⏱️ 4-5 hours
- [ ] Create `convex/ai/promptBuilder.ts`
- [ ] Define `SYSTEM_PROMPT` constant
- [ ] Implement `buildUserPrompt()` function
- [ ] Add market data formatting
- [ ] Add position formatting
- [ ] Add account state formatting
- [ ] Test prompt with real data
- [ ] Refine based on AI responses

**Verification:** Prompts generate good AI decisions

### Day 14: Response Parser ⏱️ 2-3 hours
- [ ] Create `convex/ai/responseParser.ts`
- [ ] Implement JSON extraction from responses
- [ ] Handle various response formats
- [ ] Validate parsed data
- [ ] Add error handling for malformed responses
- [ ] Test with 20+ sample responses

**Verification:** 95%+ parse success rate

---

## Week 3: Trading Logic & Scheduled Functions

### Day 15-16: Trading Loop Core ⏱️ 5-6 hours
- [ ] Create `convex/trading/tradingLoop.ts`
- [ ] Implement `runTradingCycle` internal action
- [ ] Step 1: Fetch market data for all symbols
- [ ] Step 2: Calculate technical indicators
- [ ] Step 3: Get account state
- [ ] Step 4: Build prompts
- [ ] Step 5: Query AI model
- [ ] Step 6: Parse response
- [ ] Step 7: Execute trade decisions
- [ ] Step 8: Save logs

**Verification:** One complete cycle runs successfully

### Day 17: Risk Management ⏱️ 3-4 hours
- [ ] Create `convex/trading/riskManagement.ts`
- [ ] Implement position size validation
- [ ] Implement leverage limits
- [ ] Implement daily loss circuit breaker
- [ ] Add account value minimum check
- [ ] Test risk limits prevent bad trades
- [ ] Add override mechanism for emergencies

**Verification:** Risk limits block dangerous trades

### Day 18: Position Monitoring ⏱️ 3-4 hours
- [ ] Create `convex/trading/positionMonitor.ts`
- [ ] Implement position sync from Hyperliquid
- [ ] Check stop losses
- [ ] Check take profits
- [ ] Update unrealized P&L
- [ ] Detect liquidation risks
- [ ] Send alerts for critical positions

**Verification:** Positions update every minute

### Day 19: Account Sync ⏱️ 2-3 hours
- [ ] Create `convex/trading/accountSync.ts`
- [ ] Sync account value
- [ ] Sync margin used
- [ ] Sync available cash
- [ ] Calculate performance metrics
- [ ] Save account snapshots
- [ ] Generate daily reports

**Verification:** Account state stays in sync

### Day 20-21: Scheduled Functions (Crons) ⏱️ 3-4 hours
- [ ] Create `convex/crons.ts`
- [ ] Setup trading loop cron (every 3 minutes)
- [ ] Setup position monitor cron (every 1 minute)
- [ ] Setup account sync cron (every 5 minutes)
- [ ] Test cron triggers in Convex dashboard
- [ ] Add logging for each cron run
- [ ] Monitor for failures

**Verification:** Crons run automatically on schedule

---

## Week 4: Frontend Dashboard Development

### Day 22-23: Convex Queries & Mutations ⏱️ 4-5 hours
- [ ] Create `convex/queries.ts`
  - [ ] `getBotConfig`
  - [ ] `getPositions`
  - [ ] `getRecentTrades`
  - [ ] `getRecentAILogs`
  - [ ] `getAccountSnapshots`
- [ ] Create `convex/mutations.ts`
  - [ ] `updateBotConfig`
  - [ ] `toggleBot`
  - [ ] `resetBot`
  - [ ] `saveTrade`
  - [ ] `saveAILog`
  - [ ] `savePosition`
- [ ] Test all queries and mutations

**Verification:** All CRUD operations work

### Day 24: Dashboard Page ⏱️ 3-4 hours
- [ ] Complete `app/(dashboard)/dashboard/page.tsx`
- [ ] Use `useQuery` hooks for real-time data
- [ ] Show account value card
- [ ] Show positions table
- [ ] Show recent trades
- [ ] Show AI reasoning logs
- [ ] Add loading states
- [ ] Add error handling

**Verification:** Dashboard shows live data

### Day 25: Account Value Card ⏱️ 2-3 hours
- [ ] Complete `components/dashboard/account-value-card.tsx`
- [ ] Show current value prominently
- [ ] Calculate and show P&L
- [ ] Calculate and show P&L percentage
- [ ] Add trend indicator (up/down arrow)
- [ ] Color code (green for profit, red for loss)
- [ ] Show starting value
- [ ] Add mini chart (optional)

**Verification:** Card updates in real-time

### Day 26: Positions Table ⏱️ 2-3 hours
- [ ] Complete `components/dashboard/positions-table.tsx`
- [ ] Use Shadcn Table component
- [ ] Show all open positions
- [ ] Display: symbol, side, size, entry, current, P&L
- [ ] Add leverage badge
- [ ] Color code P&L
- [ ] Add action buttons (close position)
- [ ] Handle empty state

**Verification:** Shows all positions, updates live

### Day 27: Trade History ⏱️ 2-3 hours
- [ ] Complete `components/dashboard/trade-history.tsx`
- [ ] Show recent 10-20 trades
- [ ] Display: time, symbol, action, size, price, P&L
- [ ] Add filters (symbol, date range)
- [ ] Add pagination
- [ ] Export to CSV button
- [ ] Sort by date (newest first)

**Verification:** Trade log is comprehensive

### Day 28: AI Reasoning Log ⏱️ 2-3 hours
- [ ] Complete `components/dashboard/ai-reasoning-log.tsx`
- [ ] Show recent AI decisions
- [ ] Display reasoning text
- [ ] Show decision (OPEN/CLOSE/HOLD)
- [ ] Add confidence score
- [ ] Add timestamp
- [ ] Make expandable for full prompt/response
- [ ] Add search/filter

**Verification:** Can see AI thought process

---

## Week 5: Settings, Polish & Testing

### Day 29: Bot Controls ⏱️ 2-3 hours
- [ ] Complete `components/dashboard/bot-controls.tsx`
- [ ] Add Start/Stop button
- [ ] Add status indicator
- [ ] Add reset button with confirmation
- [ ] Show active model name
- [ ] Add emergency stop
- [ ] Display last cycle time
- [ ] Add manual trigger button

**Verification:** Can control bot from UI

### Day 30: Settings Page ⏱️ 3-4 hours
- [ ] Complete `app/(dashboard)/settings/page.tsx`
- [ ] Model selection dropdown (ZhipuAI + OpenRouter models)
- [ ] Risk management settings:
  - [ ] Max leverage slider
  - [ ] Max position size slider
  - [ ] Daily loss limit slider
  - [ ] Min account value input
- [ ] Trading symbols multi-select
- [ ] API key management
- [ ] Save button with validation
- [ ] Reset to defaults button

**Verification:** Settings persist and apply

### Day 31: Trades Page ⏱️ 2-3 hours
- [ ] Create `app/(dashboard)/trades/page.tsx`
- [ ] Full trade history table
- [ ] Advanced filters
- [ ] Date range picker
- [ ] Performance metrics:
  - [ ] Total trades
  - [ ] Win rate
  - [ ] Average P&L
  - [ ] Best/worst trade
- [ ] Export functionality
- [ ] Charts (optional)

**Verification:** Complete trade analytics

### Day 32-33: UI Polish ⏱️ 4-5 hours
- [ ] Add loading skeletons for all components
- [ ] Add error boundaries
- [ ] Improve mobile responsiveness
- [ ] Add dark mode support (next-themes)
- [ ] Add toast notifications (sonner)
- [ ] Improve color scheme consistency
- [ ] Add animations (tailwindcss-animate)
- [ ] Accessibility improvements
- [ ] Add help tooltips

**Verification:** Beautiful, professional UI

### Day 34: Integration Testing ⏱️ 3-4 hours
- [ ] Test complete flow start to finish
- [ ] Test with real testnet funds ($100)
- [ ] Verify all crons running
- [ ] Check all UI updates in real-time
- [ ] Test error scenarios
- [ ] Test risk management limits
- [ ] Test stop trading functionality
- [ ] Document any bugs

**Verification:** End-to-end flow works

### Day 35: Bug Fixes ⏱️ 3-4 hours
- [ ] Fix all critical bugs from testing
- [ ] Improve error handling
- [ ] Add more logging
- [ ] Optimize slow queries
- [ ] Fix UI glitches
- [ ] Test edge cases
- [ ] Code cleanup

**Verification:** No critical bugs remain

---

## Week 6: Deployment & Monitoring

### Day 36: Prepare for Production ⏱️ 2-3 hours
- [ ] Review all environment variables
- [ ] Update `.env.example` with production values
- [ ] Set up Convex production deployment
- [ ] Set up Clerk production environment
- [ ] Review security best practices
- [ ] Add rate limiting
- [ ] Enable Convex authentication
- [ ] Set up error tracking (Sentry, optional)

**Verification:** Production config ready

### Day 37: Deploy to Vercel ⏱️ 2-3 hours
- [ ] Create Vercel account
- [ ] Connect GitHub repo
- [ ] Configure environment variables in Vercel
- [ ] Deploy to preview
- [ ] Test preview deployment
- [ ] Deploy to production
- [ ] Test production deployment
- [ ] Set up custom domain (optional)

**Verification:** App live on Vercel

### Day 38: Deploy Convex ⏱️ 1-2 hours
- [ ] Run `npx convex deploy`
- [ ] Verify production deployment
- [ ] Test crons on production
- [ ] Monitor function execution
- [ ] Check database in production
- [ ] Verify API integrations work

**Verification:** Backend fully deployed

### Day 39-40: Monitoring Setup ⏱️ 3-4 hours
- [ ] Set up Convex logging
- [ ] Create monitoring dashboard
- [ ] Set up alerts for:
  - [ ] Trading failures
  - [ ] API errors
  - [ ] Position liquidation risks
  - [ ] Daily loss limit hit
- [ ] Email notifications (optional)
- [ ] Telegram bot (optional)
- [ ] Create runbook for common issues

**Verification:** Monitoring system active

### Day 41: Documentation ⏱️ 2-3 hours
- [ ] Write comprehensive README
- [ ] Document API integrations
- [ ] Create setup guide
- [ ] Document troubleshooting steps
- [ ] Add code comments
- [ ] Create architecture diagram
- [ ] Document environment variables
- [ ] Create video demo (optional)

**Verification:** Clear documentation

### Day 42: Final Testing & Launch 🚀 ⏱️ 3-4 hours
- [ ] Test on testnet one final time
- [ ] Verify all features working
- [ ] Monitor for 24 hours
- [ ] Review performance
- [ ] Gather metrics
- [ ] Plan improvements
- [ ] Launch announcement (optional)
- [ ] **Celebrate! 🎉**

**Verification:** LIVE AND TRADING!

---

## Post-Launch: Ongoing Maintenance

### Weekly Tasks
- [ ] Review trading performance
- [ ] Check AI decision quality
- [ ] Monitor costs (API usage)
- [ ] Review risk management effectiveness
- [ ] Update models if needed
- [ ] Backup database
- [ ] Security audit

### Monthly Tasks
- [ ] Performance analysis
- [ ] Strategy optimization
- [ ] Prompt engineering improvements
- [ ] Cost optimization
- [ ] Feature planning
- [ ] Community feedback

---

## Optional Enhancements

### Phase 2 Features (After launch)
- [ ] Backtesting engine
- [ ] Paper trading mode
- [ ] Multiple strategy support
- [ ] Advanced analytics
- [ ] Mobile app
- [ ] Telegram bot commands
- [ ] Model comparison
- [ ] Strategy marketplace
- [ ] Social features
- [ ] API for third-party integrations

---

## Progress Tracker

**Current Phase:** [ ] Week 1 [ ] Week 2 [ ] Week 3 [ ] Week 4 [ ] Week 5 [ ] Week 6

**Days Completed:** _____ / 42

**Estimated Launch Date:** _______________

**Notes:**
_______________________________________
_______________________________________
_______________________________________

---

## Success Criteria

Before launching with real money:

- [ ] ✅ 2+ weeks successful testnet operation
- [ ] ✅ Win rate > 40%
- [ ] ✅ No critical bugs in 1 week
- [ ] ✅ Risk management working perfectly
- [ ] ✅ UI fully functional
- [ ] ✅ Monitoring system in place
- [ ] ✅ Emergency stop tested
- [ ] ✅ All team members trained

---

**Remember:**
- Don't rush - quality over speed
- Test thoroughly on testnet
- Start with small amounts
- Monitor constantly at first
- Iterate based on results

**Good luck! 🚀**
