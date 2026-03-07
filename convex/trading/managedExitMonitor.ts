import { internalAction } from "../_generated/server";
import { api, internal } from "../fnRefs";
import { executeClose, replaceManagedStopOrder } from "./executors/tradeExecutor";
import {
  formatManagedExitReason,
  getBreakEvenStopPrice,
  getManagedExitRules,
  getManagedPeakPrice,
  getTrailingStopPrice,
  hasStopBeenCrossed,
  isManagedExitPosition,
  tightenManagedStop,
  calculateHardStopPrice,
} from "./managedExitUtils";

function calculateLivePnlPct(positionValue: number, unrealizedPnl: number): number {
  return positionValue > 0 ? (unrealizedPnl / positionValue) * 100 : 0;
}

function getTimeSinceOpenMinutes(openedAt: number | undefined, now: number): number {
  if (!openedAt) return 0;
  return (now - openedAt) / 60000;
}

export const runManagedExitCycle = internalAction({
  handler: async (ctx) => {
    const allPositions = await ctx.runQuery(internal.queries.getAllPositionsForSync);
    const managedPositions = (allPositions || []).filter((position: any) => isManagedExitPosition(position));

    if (managedPositions.length === 0) {
      console.log("[managedExit] No managed positions to monitor");
      return;
    }

    const positionsByUser = new Map<string, any[]>();
    for (const position of managedPositions) {
      const userPositions = positionsByUser.get(position.userId) || [];
      userPositions.push(position);
      positionsByUser.set(position.userId, userPositions);
    }

    for (const [userId, userPositions] of positionsByUser.entries()) {
      const lockId = `managed-exit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const lock = await ctx.runMutation(api.mutations.acquireTradingLock, { userId, lockId });
      if (!lock.success) {
        console.log(`[managedExit] Skipping ${userId}: trading lock already held (${lock.lockId})`);
        continue;
      }

      try {
        const [credentials, bot] = await Promise.all([
          ctx.runQuery(internal.queries.getFullUserCredentials, { userId }),
          ctx.runQuery(api.queries.getBotConfig, { userId }),
        ]);

        if (!credentials?.hyperliquidPrivateKey || !credentials.hyperliquidAddress || !bot) {
          console.log(`[managedExit] Skipping ${userId}: missing credentials or bot config`);
          continue;
        }

        const symbols = [...new Set(userPositions.map((position: any) => position.symbol))];
        const [hyperliquidPositions, currentPrices] = await Promise.all([
          ctx.runAction(api.hyperliquid.client.getUserPositions, {
            address: credentials.hyperliquidAddress,
            testnet: credentials.hyperliquidTestnet,
          }),
          ctx.runAction(api.hyperliquid.client.getCurrentPrices, {
            symbols,
            testnet: credentials.hyperliquidTestnet,
          }),
        ]);

        const livePositionMap = new Map<string, any>();
        for (const livePosition of hyperliquidPositions || []) {
          const pos = livePosition.position || livePosition;
          const szi = parseFloat(pos.szi || "0");
          if (szi !== 0 && pos.coin) {
            livePositionMap.set(pos.coin, pos);
          }
        }

        for (const position of userPositions) {
          const livePosition = livePositionMap.get(position.symbol);
          if (!livePosition) {
            console.log(`[managedExit] ${position.symbol} not present on exchange for ${userId}, skipping`);
            continue;
          }

          const currentPrice = currentPrices[position.symbol];
          if (!currentPrice || !Number.isFinite(currentPrice)) {
            console.log(`[managedExit] Missing current price for ${position.symbol}, skipping`);
            continue;
          }

          const szi = parseFloat(livePosition.szi || "0");
          const sizeInCoins = Math.abs(szi);
          const unrealizedPnl = parseFloat(livePosition.unrealizedPnl || "0");
          const positionValue = Math.abs(parseFloat(livePosition.positionValue || "0"));
          const livePnlPct = calculateLivePnlPct(positionValue, unrealizedPnl);
          const rules = getManagedExitRules(position.exitRulesSnapshot || bot);
          const peakPrice = getManagedPeakPrice(position.side, position.managedPeakPrice, currentPrice);
          const now = Date.now();
          const ageMinutes = getTimeSinceOpenMinutes(position.openedAt, now);

          const hardStop = calculateHardStopPrice(position.entryPrice, position.side, rules.managedExitHardStopLossPct);
          const breakEvenStop = livePnlPct >= rules.managedExitBreakEvenTriggerPct
            ? getBreakEvenStopPrice(position.entryPrice, position.side, rules.managedExitBreakEvenLockProfitPct)
            : undefined;
          const trailingStop = livePnlPct >= rules.managedExitTrailingTriggerPct
            ? getTrailingStopPrice(peakPrice, position.side, rules.managedExitTrailingDistancePct)
            : undefined;
          const tightenedStop = livePnlPct >= rules.managedExitTightenTriggerPct
            ? getTrailingStopPrice(peakPrice, position.side, rules.managedExitTightenedDistancePct)
            : undefined;
          const effectiveStop = tightenManagedStop(position.side, position.managedStopPrice, [
            hardStop,
            breakEvenStop,
            trailingStop,
            tightenedStop,
          ]);

          if (ageMinutes >= rules.managedExitStaleMinutes && livePnlPct < rules.managedExitStaleMinProfitPct) {
            await executeClose(ctx, api, bot, credentials, {
              decision: "CLOSE",
              symbol: position.symbol,
              confidence: 1,
              reasoning: formatManagedExitReason("stale_trade"),
            });
            continue;
          }

          if (ageMinutes >= rules.managedExitMaxHoldMinutes) {
            await executeClose(ctx, api, bot, credentials, {
              decision: "CLOSE",
              symbol: position.symbol,
              confidence: 1,
              reasoning: formatManagedExitReason("max_hold"),
            });
            continue;
          }

          if (effectiveStop !== undefined && hasStopBeenCrossed(position.side, currentPrice, effectiveStop)) {
            const stopReason = tightenedStop !== undefined && effectiveStop === tightenedStop
              ? "tightened_trailing_stop"
              : trailingStop !== undefined && effectiveStop === trailingStop
                ? "trailing_stop"
                : breakEvenStop !== undefined && effectiveStop === breakEvenStop
                  ? "break_even_stop"
                  : "hard_stop";
            await executeClose(ctx, api, bot, credentials, {
              decision: "CLOSE",
              symbol: position.symbol,
              confidence: 1,
              reasoning: formatManagedExitReason(stopReason),
            });
            continue;
          }

          if (effectiveStop !== undefined && effectiveStop !== position.managedStopPrice) {
            await replaceManagedStopOrder(ctx, api, credentials, position, sizeInCoins, effectiveStop);
          }

          await ctx.runMutation(api.mutations.updatePositionRuntime, {
            userId,
            symbol: position.symbol,
            currentPrice,
            unrealizedPnl,
            unrealizedPnlPct: livePnlPct,
            stopLoss: effectiveStop,
            managedPeakPrice: peakPrice,
            managedStopPrice: effectiveStop,
            managedStopReason: effectiveStop === tightenedStop
              ? "tightened_trailing_stop"
              : effectiveStop === trailingStop
                ? "trailing_stop"
                : effectiveStop === breakEvenStop
                  ? "break_even_stop"
                  : "hard_stop",
            breakEvenActivatedAt: breakEvenStop && !position.breakEvenActivatedAt ? now : position.breakEvenActivatedAt,
            trailingActivatedAt: trailingStop && !position.trailingActivatedAt ? now : position.trailingActivatedAt,
            trailingTightenedAt: tightenedStop && !position.trailingTightenedAt ? now : position.trailingTightenedAt,
            exitRulesSnapshot: position.exitRulesSnapshot || rules,
          });
        }
      } catch (error) {
        console.error(`[managedExit] Error while processing ${userId}:`, error);
      } finally {
        await ctx.runMutation(api.mutations.releaseTradingLock, {
          userId,
          lockId,
        });
      }
    }
  },
});
