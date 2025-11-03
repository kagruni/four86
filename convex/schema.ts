import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Bot configuration and status
  botConfig: defineTable({
    userId: v.string(), // Clerk user ID
    modelName: v.string(), // "glm-4-plus" or OpenRouter model
    isActive: v.boolean(),
    startingCapital: v.number(),
    currentCapital: v.number(),

    // Trading settings
    symbols: v.array(v.string()), // ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"]
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
});
