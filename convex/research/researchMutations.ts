import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const saveMarketResearch = internalMutation({
  args: {
    userId: v.string(),
    fearGreedIndex: v.number(),
    fearGreedLabel: v.string(),
    overallSentiment: v.string(),
    sentimentScore: v.number(),
    perCoinSentiment: v.any(),
    keyEvents: v.any(),
    marketNarrative: v.string(),
    recommendedBias: v.string(),
    rawNewsData: v.any(),
    aiAnalysis: v.any(),
    sources: v.array(v.string()),
    processingTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("marketResearch", {
      ...args,
      timestamp: Date.now(),
    });
  },
});
