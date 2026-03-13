import { internalAction } from "../_generated/server";
import { api, internal } from "../fnRefs";
import { executeClose, replaceManagedStopOrder } from "./executors/tradeExecutor";
import { recordTradeOutcome } from "./circuitBreaker";
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
        const bot = await ctx.runQuery(api.queries.getBotConfig, { userId });

        if (!bot) {
          console.log(`[managedExit] Skipping ${userId}: missing bot config`);
          continue;
        }
        let botState = {
          circuitBreakerState: bot.circuitBreakerState,
          consecutiveAiFailures: bot.consecutiveAiFailures,
          consecutiveLosses: bot.consecutiveLosses,
          circuitBreakerTrippedAt: bot.circuitBreakerTrippedAt,
        };

        const positionsByWallet = new Map<string, any[]>();
        for (const position of userPositions) {
          const walletKey = String(position.walletId ?? "legacy");
          const nextPositions = positionsByWallet.get(walletKey) || [];
          nextPositions.push(position);
          positionsByWallet.set(walletKey, nextPositions);
        }

        for (const walletPositions of positionsByWallet.values()) {
          const walletId = walletPositions[0]?.walletId;
          const wallet = await ctx.runQuery(internal.wallets.queries.resolveSelectedWalletInternal, {
            userId,
            ...(walletId ? { walletId } : {}),
          });

          if (!wallet?.hyperliquidPrivateKey || !wallet?.hyperliquidAddress) {
            console.log(`[managedExit] Skipping user ${userId} wallet ${walletId ?? "legacy"}: missing wallet credentials`);
            continue;
          }

          const symbols = [...new Set(walletPositions.map((position: any) => position.symbol))];
          const [hyperliquidPositions, currentPrices] = await Promise.all([
            ctx.runAction(api.hyperliquid.client.getUserPositions, {
              address: wallet.hyperliquidAddress,
              testnet: wallet.hyperliquidTestnet,
            }),
            ctx.runAction(api.hyperliquid.client.getCurrentPrices, {
              symbols,
              testnet: wallet.hyperliquidTestnet,
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

          for (const position of walletPositions) {
            const livePosition = livePositionMap.get(position.symbol);
            if (!livePosition) {
              console.log(`[managedExit] ${position.symbol} not present on exchange for ${userId}/${wallet.label}, skipping`);
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

            const closeReason =
              ageMinutes >= rules.managedExitStaleMinutes && livePnlPct < rules.managedExitStaleMinProfitPct
                ? "stale_trade"
                : ageMinutes >= rules.managedExitMaxHoldMinutes
                  ? "max_hold"
                  : effectiveStop !== undefined && hasStopBeenCrossed(position.side, currentPrice, effectiveStop)
                    ? tightenedStop !== undefined && effectiveStop === tightenedStop
                      ? "tightened_trailing_stop"
                      : trailingStop !== undefined && effectiveStop === trailingStop
                        ? "trailing_stop"
                        : breakEvenStop !== undefined && effectiveStop === breakEvenStop
                          ? "break_even_stop"
                          : "hard_stop"
                    : null;

            if (closeReason) {
              const closeResult = await executeClose(ctx, api, { ...bot, ...botState }, wallet, {
                decision: "CLOSE",
                symbol: position.symbol,
                confidence: 1,
                reasoning: formatManagedExitReason(closeReason),
              }, {
                wallet,
                countCircuitBreakerLoss: false,
              });

              const tradeWon = (closeResult?.pnl ?? 0) >= 0;
              const nextTradeOutcomeState = recordTradeOutcome(
                botState,
                {
                  maxConsecutiveLosses: bot.maxConsecutiveLosses,
                },
                tradeWon
              );

              botState = {
                ...botState,
                circuitBreakerState: nextTradeOutcomeState.circuitBreakerState,
                consecutiveLosses: nextTradeOutcomeState.consecutiveLosses,
                circuitBreakerTrippedAt: nextTradeOutcomeState.circuitBreakerTrippedAt,
              };

              await ctx.runMutation(api.mutations.updateCircuitBreakerState, {
                userId,
                circuitBreakerState: nextTradeOutcomeState.circuitBreakerState,
                consecutiveLosses: nextTradeOutcomeState.consecutiveLosses,
                circuitBreakerTrippedAt: nextTradeOutcomeState.circuitBreakerTrippedAt,
              });
              continue;
            }

            if (effectiveStop !== undefined && effectiveStop !== position.managedStopPrice) {
              await replaceManagedStopOrder(ctx, api, wallet, position, sizeInCoins, effectiveStop);
            }

            await ctx.runMutation(api.mutations.updatePositionRuntime, {
              userId,
              ...(walletId ? { walletId } : {}),
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
