import { internalMutation } from "../_generated/server";

/**
 * Migration to remove deprecated stopLossEnabled field from botConfig table
 * Run this once to clean up old data
 */
export const removeStopLossEnabledField = internalMutation({
  handler: async (ctx) => {
    console.log("[migration] Starting: Remove stopLossEnabled field from botConfig");

    // Get all botConfig records
    const allConfigs = await ctx.db.query("botConfig").collect();

    console.log(`[migration] Found ${allConfigs.length} botConfig record(s)`);

    let updatedCount = 0;

    for (const config of allConfigs) {
      // Check if this config has the deprecated field
      if ("stopLossEnabled" in config) {
        console.log(`[migration] Removing stopLossEnabled from config ${config._id}`);

        // Create a new object without stopLossEnabled
        const { stopLossEnabled, ...configWithoutStopLoss } = config as any;

        // Replace the entire document with the cleaned version
        await ctx.db.replace(config._id, configWithoutStopLoss);

        updatedCount++;
      }
    }

    console.log(`[migration] Complete: Updated ${updatedCount} record(s)`);

    return {
      success: true,
      totalRecords: allConfigs.length,
      updatedRecords: updatedCount,
    };
  },
});
