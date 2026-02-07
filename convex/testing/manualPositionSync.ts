import { action } from "../_generated/server";
import { internal } from "../fnRefs";

/**
 * Manual trigger for position sync - for testing
 * Run this from Convex dashboard to manually sync positions
 */
export const manualPositionSync = action({
  handler: async (ctx) => {
    console.log("[manualPositionSync] Starting manual position sync...");

    try {
      await ctx.runAction(internal.trading.positionSync.syncAllPositions);
      console.log("[manualPositionSync] Position sync completed successfully");
      return { success: true, message: "Position sync completed" };
    } catch (error) {
      console.error("[manualPositionSync] Error during position sync:", error);
      return {
        success: false,
        error: String(error),
        message: "Position sync failed"
      };
    }
  },
});
