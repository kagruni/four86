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

      if (!apiKey) {
        throw new Error(`API key not found for ${args.modelType}`);
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
