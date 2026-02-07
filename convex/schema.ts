import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // User credentials (API keys and secrets)
  userCredentials: defineTable({
    userId: v.string(), // Clerk user ID

    // ZhipuAI credentials
    zhipuaiApiKey: v.optional(v.string()),

    // OpenRouter credentials
    openrouterApiKey: v.optional(v.string()),

    // Hyperliquid credentials
    hyperliquidPrivateKey: v.optional(v.string()),
    hyperliquidAddress: v.optional(v.string()),
    hyperliquidTestnet: v.boolean(), // true for testnet, false for mainnet

    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Bot configuration and status
  botConfig: defineTable({
    userId: v.string(), // Clerk user ID
    modelName: v.string(), // "glm-4-plus" or OpenRouter model
    isActive: v.boolean(),
    startingCapital: v.number(),
    currentCapital: v.number(),

    // Trading settings
    symbols: v.array(v.string()), // ["BTC", "ETH", "SOL", "BNB", "DOGE"]
    maxLeverage: v.number(),
    maxPositionSize: v.number(),

    // Risk management (existing)
    maxDailyLoss: v.number(),
    minAccountValue: v.number(),

    // Tier 1: Essential Risk Controls (optional for backward compatibility)
    perTradeRiskPct: v.optional(v.number()), // 0.5 - 5.0, default 2.0
    maxTotalPositions: v.optional(v.number()), // 1 - 5, default 3
    maxSameDirectionPositions: v.optional(v.number()), // 1 - 3, default 2
    consecutiveLossLimit: v.optional(v.number()), // 2 - 5, default 3

    // Tier 2: Trading Behavior (optional for backward compatibility)
    tradingMode: v.optional(v.string()), // "conservative" | "balanced" | "aggressive"
    minEntryConfidence: v.optional(v.number()), // 0.50 - 0.80, default 0.60
    minRiskRewardRatio: v.optional(v.number()), // 1.0 - 3.0, default 1.5
    stopOutCooldownHours: v.optional(v.number()), // 0 - 24, default 6

    // Tier 3: Advanced (optional for backward compatibility)
    minEntrySignals: v.optional(v.number()), // 1 - 4, default 2
    require4hAlignment: v.optional(v.boolean()), // default false
    tradeVolatileMarkets: v.optional(v.boolean()), // default true
    volatilitySizeReduction: v.optional(v.number()), // 25 - 75, default 50 (percentage)
    stopLossAtrMultiplier: v.optional(v.number()), // 1.0 - 3.0, default 1.5

    // Deprecated fields (for backward compatibility, will be removed in migration)
    stopLossEnabled: v.optional(v.boolean()), // DEPRECATED - always enabled for safety

    // Feature flags (previously hard-coded)
    tradingPromptMode: v.optional(v.string()), // "alpha_arena" | "compact" | "detailed"

    // Circuit breaker fields
    circuitBreakerState: v.optional(v.string()), // "active" | "tripped" | "cooldown"
    consecutiveAiFailures: v.optional(v.number()),
    consecutiveLosses: v.optional(v.number()),
    circuitBreakerTrippedAt: v.optional(v.number()),
    circuitBreakerCooldownMinutes: v.optional(v.number()), // default 30
    maxConsecutiveAiFailures: v.optional(v.number()), // default 3
    maxConsecutiveLosses: v.optional(v.number()), // default 5

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

    // Exit plan and invalidation
    invalidationCondition: v.optional(v.string()), // Description of when position should be closed
    entryReasoning: v.optional(v.string()), // Why this position was entered
    confidence: v.optional(v.number()), // AI confidence level (0-1)

    // Order tracking
    entryOrderId: v.optional(v.string()), // Hyperliquid entry order ID
    takeProfitOrderId: v.optional(v.string()), // TP order ID
    stopLossOrderId: v.optional(v.string()), // SL order ID

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
    confidence: v.optional(v.number()),

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
    decision: v.string(), // "OPEN_LONG", "OPEN_SHORT", "CLOSE", "HOLD"
    reasoning: v.string(),
    confidence: v.optional(v.number()),

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

  // Market research and sentiment data
  marketResearch: defineTable({
    userId: v.string(),
    fearGreedIndex: v.number(),
    fearGreedLabel: v.string(),
    overallSentiment: v.string(),       // "very_bearish" to "very_bullish"
    sentimentScore: v.number(),          // -1 to 1
    perCoinSentiment: v.any(),           // { BTC: { sentiment, news_count, key_headline }, ... }
    keyEvents: v.any(),                  // [{ headline, impact, asset, sentiment }]
    marketNarrative: v.string(),         // LLM-generated summary
    recommendedBias: v.string(),         // "risk_off" | "neutral" | "risk_on"
    rawNewsData: v.any(),
    aiAnalysis: v.any(),
    sources: v.array(v.string()),
    processingTimeMs: v.number(),
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

  // Trading locks (prevents race conditions/duplicate entries)
  tradingLocks: defineTable({
    userId: v.string(),
    lockId: v.string(), // Unique ID for this lock instance
    acquiredAt: v.number(), // When the lock was acquired
    expiresAt: v.number(), // Auto-expire after 2 minutes (safety)
  }).index("by_userId", ["userId"])
    .index("by_userId_expires", ["userId", "expiresAt"]),

  // Per-symbol trade locks (prevents rapid duplicate orders on same symbol)
  symbolTradeLocks: defineTable({
    userId: v.string(),
    symbol: v.string(),
    side: v.string(), // "LONG" or "SHORT"
    attemptedAt: v.number(), // When the trade was attempted
    expiresAt: v.number(), // Lock expires after 60 seconds
  }).index("by_userId_symbol", ["userId", "symbol"])
    .index("by_expiresAt", ["expiresAt"]),

  // Backtest run configurations and results
  backtestRuns: defineTable({
    userId: v.string(),
    status: v.string(), // "running" | "completed" | "failed"

    // Configuration
    symbol: v.string(),
    startDate: v.number(), // timestamp
    endDate: v.number(), // timestamp
    modelName: v.string(),
    tradingPromptMode: v.string(), // "alpha_arena" | "compact" | "detailed"
    initialCapital: v.number(),
    maxLeverage: v.number(),

    // Results (populated on completion)
    totalPnl: v.optional(v.number()),
    totalPnlPct: v.optional(v.number()),
    winRate: v.optional(v.number()),
    totalTrades: v.optional(v.number()),
    maxDrawdown: v.optional(v.number()),
    maxDrawdownPct: v.optional(v.number()),
    sharpeRatio: v.optional(v.number()),
    finalCapital: v.optional(v.number()),

    // Live progress (updated during run)
    currentCapital: v.optional(v.number()),
    currentTrades: v.optional(v.number()),
    progressPct: v.optional(v.number()), // 0-100

    // Realistic cost tracking
    totalFees: v.optional(v.number()),        // Total trading fees paid
    totalFunding: v.optional(v.number()),     // Net funding rate costs
    liquidationCount: v.optional(v.number()), // Number of forced liquidations

    // Metadata
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"])
    .index("by_userId_status", ["userId", "status"]),

  // Individual simulated trades within a backtest
  backtestTrades: defineTable({
    runId: v.id("backtestRuns"),
    userId: v.string(),

    // Trade details
    symbol: v.string(),
    action: v.string(), // "OPEN" | "CLOSE"
    side: v.string(), // "LONG" | "SHORT"
    entryPrice: v.number(),
    exitPrice: v.optional(v.number()),
    size: v.number(), // USD value
    leverage: v.number(),

    // Outcome
    pnl: v.optional(v.number()),
    pnlPct: v.optional(v.number()),
    exitReason: v.optional(v.string()), // "take_profit" | "stop_loss" | "ai_close" | "end_of_period" | "liquidation"
    fundingPaid: v.optional(v.number()), // Funding rate cost for this trade

    // AI context
    confidence: v.optional(v.number()),
    reasoning: v.optional(v.string()),

    // Timing
    entryTime: v.number(),
    exitTime: v.optional(v.number()),
  }).index("by_runId", ["runId"])
    .index("by_userId", ["userId"]),

  // Telegram bot integration settings
  telegramSettings: defineTable({
    userId: v.string(),
    chatId: v.optional(v.string()),
    isLinked: v.boolean(),
    isEnabled: v.boolean(),
    // Notification toggles
    notifyTradeOpened: v.boolean(),
    notifyTradeClosed: v.boolean(),
    notifyRiskAlerts: v.boolean(),
    notifyDailySummary: v.boolean(),
    // Linking flow
    verificationCode: v.optional(v.string()),
    verificationExpiresAt: v.optional(v.number()),
    // Confirmation flow for dangerous commands
    pendingAction: v.optional(v.string()),       // "closeall" | "close_BTC" etc.
    pendingActionToken: v.optional(v.string()),
    pendingActionExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"])
    .index("by_chatId", ["chatId"])
    .index("by_verificationCode", ["verificationCode"]),
});
