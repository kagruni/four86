import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { createTradingChain, createDetailedTradingChain } from "../chains/tradingChain";
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
