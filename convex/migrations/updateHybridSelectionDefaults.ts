import { internalMutation } from "../_generated/server";
import {
  needsHybridSelectionDefaultsMigration,
  normalizeHybridSelectionConfig,
} from "../trading/hybridSelectionConfig";

/**
 * Migration to update stale hybrid-selection defaults on existing botConfig rows.
 * Rows that already use explicit non-default values are left untouched.
 */
export const updateHybridSelectionDefaults = internalMutation({
  handler: async (ctx) => {
    console.log("[migration] Starting: Update hybrid selection defaults");

    const allConfigs = await ctx.db.query("botConfig").collect();
    console.log(`[migration] Found ${allConfigs.length} botConfig record(s)`);

    let updatedCount = 0;

    for (const config of allConfigs) {
      if (!needsHybridSelectionDefaultsMigration(config)) {
        continue;
      }

      const normalized = normalizeHybridSelectionConfig(config);
      console.log(`[migration] Updating hybrid defaults for config ${config._id}`);

      await ctx.db.patch(config._id, {
        hybridScoreFloor: normalized.hybridScoreFloor,
        hybridMinChopVolumeRatio: normalized.hybridMinChopVolumeRatio,
        updatedAt: Date.now(),
      });

      updatedCount += 1;
    }

    console.log(`[migration] Complete: Updated ${updatedCount} record(s)`);

    return {
      success: true,
      totalRecords: allConfigs.length,
      updatedRecords: updatedCount,
    };
  },
});
