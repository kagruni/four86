import { action } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Public action to run the stopLossEnabled migration
 * Call this from the Convex dashboard or via the app
 */
export const runRemoveStopLossEnabledMigration = action({
  handler: async (ctx) => {
    console.log("[migration] Running removeStopLossEnabled migration...");

    const result = await ctx.runMutation(
      internal.migrations.removeStopLossEnabled.removeStopLossEnabledField
    );

    console.log("[migration] Migration result:", result);

    return result;
  },
});
