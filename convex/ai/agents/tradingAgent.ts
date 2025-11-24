import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { createTradingChain, createDetailedTradingChain, createCompactTradingChain } from "../chains/tradingChain";
import type { TradeDecision } from "../parsers/schemas";

export const makeTradingDecision = action({
  args: {
    userId: v.string(),
    modelType: v.union(v.literal("zhipuai"), v.literal("openrouter")),
    modelName: v.string(),
    marketData: v.any(),
    accountState: v.any(),
    positions: v.any(),
    performanceMetrics: v.any(),
    config: v.object({
      maxLeverage: v.number(),
      maxPositionSize: v.number(),
    }),
  },
  handler: async (ctx, args): Promise<TradeDecision> => {
    const startTime = Date.now();

    try {
      // Get user credentials from database
      const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
        userId: args.userId,
      });

      if (!credentials) {
        throw new Error(`No credentials found for user ${args.userId}`);
      }

      // Get API key from database based on model type
      const apiKey = args.modelType === "zhipuai"
        ? credentials.zhipuaiApiKey
        : credentials.openrouterApiKey;

      if (!apiKey) {
        throw new Error(`${args.modelType === "zhipuai" ? "ZhipuAI" : "OpenRouter"} API key not configured for user ${args.userId}`);
      }

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
        performanceMetrics: args.performanceMetrics,
      });

      const processingTime = Date.now() - startTime;

      console.log(`Trading decision made in ${processingTime}ms:`, decision.decision);

      return decision as TradeDecision;

    } catch (error) {
      console.error("Error in trading agent:", error);

      // Return safe default (HOLD)
      return {
        reasoning: `Error occurred: ${error}. Defaulting to HOLD for safety.`,
        decision: "HOLD",
        confidence: 0,
      } as TradeDecision;
    }
  },
});

/**
 * Make a detailed trading decision using multi-timeframe analysis
 * Uses the comprehensive prompt system with historical indicator series
 */
export const makeDetailedTradingDecision = action({
  args: {
    userId: v.string(),
    modelType: v.union(v.literal("zhipuai"), v.literal("openrouter")),
    modelName: v.string(),
    detailedMarketData: v.any(), // Record<string, DetailedCoinData>
    accountState: v.any(),
    positions: v.any(),
    performanceMetrics: v.any(),
    config: v.object({
      maxLeverage: v.number(),
      maxPositionSize: v.number(),
      maxDailyLoss: v.optional(v.number()),
      minAccountValue: v.optional(v.number()),
      perTradeRiskPct: v.optional(v.number()),
      maxTotalPositions: v.optional(v.number()),
      maxSameDirectionPositions: v.optional(v.number()),
      consecutiveLossLimit: v.optional(v.number()),
      tradingMode: v.optional(v.string()),
      minEntryConfidence: v.optional(v.number()),
      minRiskRewardRatio: v.optional(v.number()),
      stopOutCooldownHours: v.optional(v.number()),
      minEntrySignals: v.optional(v.number()),
      require4hAlignment: v.optional(v.boolean()),
      tradeVolatileMarkets: v.optional(v.boolean()),
      volatilitySizeReduction: v.optional(v.number()),
      stopLossAtrMultiplier: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args): Promise<TradeDecision> => {
    const startTime = Date.now();

    try {
      // Get user credentials from database
      const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
        userId: args.userId,
      });

      if (!credentials) {
        throw new Error(`No credentials found for user ${args.userId}`);
      }

      // Get API key from database based on model type
      const apiKey = args.modelType === "zhipuai"
        ? credentials.zhipuaiApiKey
        : credentials.openrouterApiKey;

      if (!apiKey) {
        throw new Error(`${args.modelType === "zhipuai" ? "ZhipuAI" : "OpenRouter"} API key not configured for user ${args.userId}`);
      }

      // Get recent trading actions for context (OPEN/CLOSE only, skip HOLD)
      const recentActions = await ctx.runQuery(internal.queries.getRecentTradingActions, {
        userId: args.userId,
        limit: 5,
      });

      // Create the detailed trading chain
      const chain = createDetailedTradingChain(
        args.modelType,
        args.modelName,
        apiKey,
        args.config
      );

      // Invoke the chain with detailed market data
      const decision = await chain.invoke({
        detailedMarketData: args.detailedMarketData,
        accountState: args.accountState,
        positions: args.positions || [],
        performanceMetrics: args.performanceMetrics,
        recentActions: recentActions || [],
      });

      const processingTime = Date.now() - startTime;

      console.log(`Detailed trading decision made in ${processingTime}ms:`, decision.decision);

      return decision as TradeDecision;

    } catch (error) {
      console.error("Error in detailed trading agent:", error);

      // Return safe default (HOLD)
      return {
        reasoning: `Error occurred: ${error}. Defaulting to HOLD for safety.`,
        decision: "HOLD",
        confidence: 0,
      } as TradeDecision;
    }
  },
});

/**
 * Make a compact trading decision using pre-processed signals
 *
 * Uses the streamlined compact prompt system that:
 * - Trusts pre-calculated signals (no raw data re-analysis)
 * - Focuses on decision-making, not technical analysis
 * - Uses significantly fewer tokens (~150 lines vs 680 lines)
 */
export const makeCompactTradingDecision = action({
  args: {
    userId: v.string(),
    modelType: v.union(v.literal("zhipuai"), v.literal("openrouter")),
    modelName: v.string(),
    processedSignals: v.any(), // ProcessedSignals type
    accountState: v.any(),
    positions: v.any(),
    config: v.object({
      maxLeverage: v.number(),
      maxPositionSize: v.number(),
      perTradeRiskPct: v.optional(v.number()),
      maxTotalPositions: v.optional(v.number()),
      maxSameDirectionPositions: v.optional(v.number()),
      minEntryConfidence: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args): Promise<TradeDecision> => {
    const startTime = Date.now();

    try {
      // Get user credentials from database
      const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
        userId: args.userId,
      });

      if (!credentials) {
        throw new Error(`No credentials found for user ${args.userId}`);
      }

      // Get API key from database based on model type
      const apiKey = args.modelType === "zhipuai"
        ? credentials.zhipuaiApiKey
        : credentials.openrouterApiKey;

      if (!apiKey) {
        throw new Error(`${args.modelType === "zhipuai" ? "ZhipuAI" : "OpenRouter"} API key not configured for user ${args.userId}`);
      }

      // Create the compact trading chain
      const chain = createCompactTradingChain(
        args.modelType,
        args.modelName,
        apiKey,
        args.config
      );

      // Invoke the chain with pre-processed signals
      const decision = await chain.invoke({
        processedSignals: args.processedSignals,
        accountState: args.accountState,
        positions: args.positions || [],
      });

      const processingTime = Date.now() - startTime;

      console.log(`Compact trading decision made in ${processingTime}ms:`, decision.decision);

      return decision as TradeDecision;

    } catch (error) {
      console.error("Error in compact trading agent:", error);

      // Return safe default (HOLD)
      return {
        reasoning: `Error occurred: ${error}. Defaulting to HOLD for safety.`,
        decision: "HOLD",
        confidence: 0,
      } as TradeDecision;
    }
  },
});
