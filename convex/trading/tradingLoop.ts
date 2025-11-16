import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";

export const runTradingCycle = internalAction({
  handler: async (ctx) => {
    // Get all active bots
    const activeBots = await ctx.runQuery(api.queries.getActiveBots);

    console.log(`Running trading cycle for ${activeBots.length} active bot(s)`);

    for (const bot of activeBots) {
      try {
        console.log(`Processing bot ${bot._id} for user ${bot.userId}`);

        // 1. Get user credentials (private keys, API keys)
        const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
          userId: bot.userId,
        });

        if (!credentials) {
          console.error(`No credentials found for user ${bot.userId}`);
          await ctx.runMutation(api.mutations.saveSystemLog, {
            userId: bot.userId,
            level: "ERROR",
            message: "Trading cycle skipped: No credentials configured",
            data: { botId: bot._id },
          });
          continue;
        }

        if (!credentials.hyperliquidPrivateKey || !credentials.hyperliquidAddress) {
          console.error(`Missing Hyperliquid credentials for user ${bot.userId}`);
          await ctx.runMutation(api.mutations.saveSystemLog, {
            userId: bot.userId,
            level: "ERROR",
            message: "Trading cycle skipped: Missing Hyperliquid credentials",
            data: { botId: bot._id },
          });
          continue;
        }

        // 2. Fetch detailed multi-timeframe market data for all symbols
        // Filter out XRP on testnet (not available)
        const symbols = credentials.hyperliquidTestnet
          ? bot.symbols.filter((s: string) => s !== "XRP")
          : bot.symbols;

        const detailedMarketData = await ctx.runAction(api.hyperliquid.detailedMarketData.getDetailedMarketData, {
          symbols,
          testnet: credentials.hyperliquidTestnet,
        });

        // 3. Get account state from Hyperliquid
        const accountState = await ctx.runAction(api.hyperliquid.client.getAccountState, {
          address: credentials.hyperliquidAddress,
          testnet: credentials.hyperliquidTestnet,
        });

        // 3.5. Sync positions with Hyperliquid (remove stale positions from database)
        const hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
          address: credentials.hyperliquidAddress,
          testnet: credentials.hyperliquidTestnet,
        });

        // Extract symbols of actual positions on Hyperliquid
        const hyperliquidSymbols = hyperliquidPositions
          .map((p: any) => {
            const coin = p.position?.coin || p.coin;
            const szi = p.position?.szi || p.szi || "0";
            // Only include positions with non-zero size
            return parseFloat(szi) !== 0 ? coin : null;
          })
          .filter((s: string | null): s is string => s !== null);

        // Sync database with reality
        await ctx.runMutation(api.mutations.syncPositions, {
          userId: bot.userId,
          hyperliquidSymbols,
        });

        // 4. Get current positions from database (now synced with Hyperliquid)
        const positions = await ctx.runQuery(api.queries.getPositions, {
          userId: bot.userId,
        });

        // 5. Get performance metrics
        const performanceMetrics = await ctx.runQuery(internal.trading.performanceMetrics.getPerformanceMetrics, {
          userId: bot.userId,
        });

        // 6. Use detailed LangChain agent to make trading decision with multi-timeframe analysis
        const decision = await ctx.runAction(api.ai.agents.tradingAgent.makeDetailedTradingDecision, {
          userId: bot.userId,
          modelType: bot.modelName.startsWith("glm-") ? "zhipuai" : "openrouter",
          modelName: bot.modelName,
          detailedMarketData,
          accountState,
          positions,
          performanceMetrics,
          config: {
            maxLeverage: bot.maxLeverage,
            maxPositionSize: bot.maxPositionSize,
          },
        });

        // 7. Save AI log
        await ctx.runMutation(api.mutations.saveAILog, {
          userId: bot.userId,
          modelName: bot.modelName,
          systemPrompt: "Detailed multi-timeframe trading system",
          userPrompt: JSON.stringify({ detailedMarketData, accountState, positions, performanceMetrics }),
          rawResponse: JSON.stringify(decision),
          parsedResponse: decision,
          decision: decision.decision,
          reasoning: decision.reasoning,
          confidence: decision.confidence,
          accountValue: accountState.accountValue,
          marketData: detailedMarketData, // Store detailed market data
          processingTimeMs: 0,
        });

        // 8. Execute trade if needed
        if (decision.decision !== "HOLD") {
          await executeTradeDecision(ctx, bot, credentials, decision, accountState);
        }

        console.log(`Bot ${bot._id} decision: ${decision.decision}`);

      } catch (error) {
        console.error(`Error in trading cycle for bot ${bot._id}:`, error);
        await ctx.runMutation(api.mutations.saveSystemLog, {
          userId: bot.userId,
          level: "ERROR",
          message: "Trading cycle error",
          data: { error: String(error) },
        });
      }
    }
  },
});

async function executeTradeDecision(ctx: any, bot: any, credentials: any, decision: any, accountState: any) {
  // Risk checks
  const maxPositionSizeUsd = accountState.accountValue * bot.maxPositionSize;

  if (decision.size_usd && decision.size_usd > maxPositionSizeUsd) {
    console.log(`Trade rejected: position size ${decision.size_usd} exceeds max ${maxPositionSizeUsd}`);
    return;
  }

  if (decision.leverage && decision.leverage > bot.maxLeverage) {
    console.log(`Trade rejected: leverage ${decision.leverage} exceeds max ${bot.maxLeverage}`);
    return;
  }

  try {
    if (decision.decision === "CLOSE") {
      // Get the position to close from database
      const positions = await ctx.runQuery(api.queries.getPositions, {
        userId: bot.userId,
      });

      const positionToClose = positions.find((p: any) => p.symbol === decision.symbol);

      if (!positionToClose) {
        console.log(`No position found for ${decision.symbol}, skipping close`);
        return;
      }

      // Get actual position size from Hyperliquid (not from database)
      const hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
        address: credentials.hyperliquidAddress,
        testnet: credentials.hyperliquidTestnet,
      });

      // Find the actual position on Hyperliquid
      const actualPosition = hyperliquidPositions.find((p: any) => {
        // Position info comes in format like { position: { coin: "BTC", szi: "0.01" } }
        const coin = p.position?.coin || p.coin;
        return coin === decision.symbol;
      });

      if (!actualPosition) {
        console.log(`No actual position found on Hyperliquid for ${decision.symbol}, removing from database`);
        await ctx.runMutation(api.mutations.closePosition, {
          userId: bot.userId,
          symbol: decision.symbol,
        });
        return;
      }

      // Get the actual size from Hyperliquid
      // szi is the signed size (positive for long, negative for short)
      const szi = actualPosition.position?.szi || actualPosition.szi || "0";
      const actualSize = Math.abs(parseFloat(szi));

      console.log(`Closing ${decision.symbol} position:`);
      console.log(`  Database size: ${positionToClose.size} USD`);
      console.log(`  Actual Hyperliquid size: ${actualSize} coins`);
      console.log(`  Side: ${positionToClose.side}`);

      // Close existing position with actual size from Hyperliquid
      // To close a LONG position, we SELL (isBuy=false)
      // To close a SHORT position, we BUY (isBuy=true)
      const result = await ctx.runAction(api.hyperliquid.client.closePosition, {
        privateKey: credentials.hyperliquidPrivateKey,
        address: credentials.hyperliquidAddress,
        symbol: decision.symbol,
        size: actualSize, // Use actual size from Hyperliquid, not database
        isBuy: positionToClose.side === "SHORT", // Opposite of position side
        testnet: credentials.hyperliquidTestnet,
      });

      // Save trade record
      await ctx.runMutation(api.mutations.saveTrade, {
        userId: bot.userId,
        symbol: decision.symbol,
        action: "CLOSE",
        side: "CLOSE",
        size: 0,
        leverage: 1,
        price: 0,
        aiReasoning: decision.reasoning,
        aiModel: bot.modelName,
        confidence: decision.confidence,
        txHash: result.txHash,
      });

      // Remove position from database
      await ctx.runMutation(api.mutations.closePosition, {
        userId: bot.userId,
        symbol: decision.symbol,
      });

    } else if (decision.decision === "OPEN_LONG" || decision.decision === "OPEN_SHORT") {
      // Get current market price to convert USD to coin size
      const currentPrice = await ctx.runAction(api.hyperliquid.client.getMarketData, {
        symbols: [decision.symbol!],
        testnet: credentials.hyperliquidTestnet,
      });

      const entryPrice = currentPrice[decision.symbol!]?.price || 0;
      if (entryPrice === 0) {
        throw new Error(`Cannot get market price for ${decision.symbol}`);
      }

      // Convert USD size to coin size
      // Example: $7327 / $934 BNB = 7.84 BNB
      const sizeInCoins = decision.size_usd! / entryPrice;

      console.log(`Opening position: ${decision.symbol} ${decision.decision}`);
      console.log(`  Size: $${decision.size_usd} / $${entryPrice} = ${sizeInCoins.toFixed(4)} coins`);
      console.log(`  Leverage: ${decision.leverage}x`);

      // Open new position
      const result = await ctx.runAction(api.hyperliquid.client.placeOrder, {
        privateKey: credentials.hyperliquidPrivateKey,
        address: credentials.hyperliquidAddress,
        symbol: decision.symbol!,
        isBuy: decision.decision === "OPEN_LONG",
        size: sizeInCoins,
        leverage: decision.leverage!,
        price: entryPrice,
        testnet: credentials.hyperliquidTestnet,
      });

      const isLongPosition = decision.decision === "OPEN_LONG";

      // Place stop-loss order if specified
      if (decision.stop_loss) {
        try {
          console.log(`Placing stop-loss order at $${decision.stop_loss}...`);
          await ctx.runAction(api.hyperliquid.client.placeStopLoss, {
            privateKey: credentials.hyperliquidPrivateKey,
            symbol: decision.symbol!,
            size: sizeInCoins,
            triggerPrice: decision.stop_loss,
            isLongPosition,
            testnet: credentials.hyperliquidTestnet,
          });
        } catch (error) {
          console.error(`Failed to place stop-loss order:`, error);
          // Don't fail the entire trade if SL order fails - position is still open
        }
      }

      // Place take-profit order if specified
      if (decision.take_profit) {
        try {
          console.log(`Placing take-profit order at $${decision.take_profit}...`);
          await ctx.runAction(api.hyperliquid.client.placeTakeProfit, {
            privateKey: credentials.hyperliquidPrivateKey,
            symbol: decision.symbol!,
            size: sizeInCoins,
            triggerPrice: decision.take_profit,
            isLongPosition,
            testnet: credentials.hyperliquidTestnet,
          });
        } catch (error) {
          console.error(`Failed to place take-profit order:`, error);
          // Don't fail the entire trade if TP order fails - position is still open
        }
      }

      // Save trade record
      await ctx.runMutation(api.mutations.saveTrade, {
        userId: bot.userId,
        symbol: decision.symbol!,
        action: "OPEN",
        side: decision.decision === "OPEN_LONG" ? "LONG" : "SHORT",
        size: decision.size_usd!,
        leverage: decision.leverage!,
        price: result.price,
        aiReasoning: decision.reasoning,
        aiModel: bot.modelName,
        confidence: decision.confidence,
        txHash: result.txHash,
      });

      // Generate invalidation condition based on stop loss and side
      const invalidationCondition = generateInvalidationCondition(
        decision.symbol!,
        decision.decision === "OPEN_LONG" ? "LONG" : "SHORT",
        result.price,
        decision.stop_loss
      );

      // Save position to database
      await ctx.runMutation(api.mutations.savePosition, {
        userId: bot.userId,
        symbol: decision.symbol!,
        side: decision.decision === "OPEN_LONG" ? "LONG" : "SHORT",
        size: decision.size_usd!,
        leverage: decision.leverage!,
        entryPrice: result.price,
        currentPrice: result.price,
        unrealizedPnl: 0,
        unrealizedPnlPct: 0,
        stopLoss: decision.stop_loss,
        takeProfit: decision.take_profit,
        liquidationPrice: result.price * (decision.decision === "OPEN_LONG" ? 0.9 : 1.1), // Mock liquidation price

        // New fields
        invalidationCondition,
        entryReasoning: decision.reasoning,
        confidence: decision.confidence,
        entryOrderId: result.txHash, // Using txHash as order ID for now
      });

      console.log(`Executed ${decision.decision} for ${decision.symbol} at $${result.price}`);
    }
  } catch (error) {
    console.error("Error executing trade:", error);
    await ctx.runMutation(api.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "ERROR",
      message: "Trade execution error",
      data: { error: String(error), decision },
    });
  }
}

/**
 * Generate invalidation condition description for a position
 * @param symbol - Trading symbol (e.g., "BTC")
 * @param side - Position side ("LONG" or "SHORT")
 * @param entryPrice - Entry price
 * @param stopLoss - Stop loss price (optional)
 * @returns Human-readable invalidation condition
 */
function generateInvalidationCondition(
  symbol: string,
  side: string,
  entryPrice: number,
  stopLoss?: number
): string {
  if (!stopLoss) {
    // No stop loss specified - use default percentage
    const defaultStopPct = 0.05; // 5%
    const invalidationPrice = side === "LONG"
      ? entryPrice * (1 - defaultStopPct)
      : entryPrice * (1 + defaultStopPct);

    return `If ${symbol} price closes ${side === "LONG" ? "below" : "above"} $${invalidationPrice.toFixed(2)} (${(defaultStopPct * 100).toFixed(1)}% against entry) on 3-minute candle`;
  }

  // Calculate percentage from stop loss
  const stopPct = Math.abs((stopLoss - entryPrice) / entryPrice) * 100;

  return `If ${symbol} price closes ${side === "LONG" ? "below" : "above"} $${stopLoss.toFixed(2)} (${stopPct.toFixed(1)}% stop loss) on 3-minute candle`;
}
