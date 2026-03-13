import { action } from "../_generated/server";
import { internal } from "../fnRefs";

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

export const runHybridSelectionDefaultsMigration = action({
  handler: async (ctx) => {
    console.log("[migration] Running hybrid selection defaults migration...");

    const result = await ctx.runMutation(
      internal.migrations.updateHybridSelectionDefaults.updateHybridSelectionDefaults
    );

    console.log("[migration] Migration result:", result);

    return result;
  },
});

export const runConnectedWalletBackfillMigration = action({
  handler: async (ctx) => {
    console.log("[migration] Running connected wallet backfill migration...");

    const result = await ctx.runMutation(
      internal.migrations.backfillConnectedWallets.backfillConnectedWallets
    );

    console.log("[migration] Migration result:", result);

    return result;
  },
});
