import { query } from "../_generated/server";

// Diagnostic: Get ALL bot configs (not just for one user)
export const getAllBotConfigs = query({
  handler: async (ctx) => {
    const allBots = await ctx.db.query("botConfig").collect();
    return allBots.map(bot => ({
      _id: bot._id,
      userId: bot.userId,
      isActive: bot.isActive,
      modelName: bot.modelName,
      symbols: bot.symbols,
      createdAt: bot.createdAt,
      updatedAt: bot.updatedAt,
    }));
  },
});
