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
});
