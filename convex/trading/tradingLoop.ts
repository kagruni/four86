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
        const detailedMarketData = await ctx.runAction(api.hyperliquid.detailedMarketData.getDetailedMarketData, {
          symbols: bot.symbols,
          testnet: credentials.hyperliquidTestnet,
        });

        // 3. Get account state from Hyperliquid
        const accountState = await ctx.runAction(api.hyperliquid.client.getAccountState, {
          address: credentials.hyperliquidAddress,
          testnet: credentials.hyperliquidTestnet,
        });

        // 4. Get current positions from database
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

      // Close existing position
      // To close a LONG position, we SELL (isBuy=false)
      // To close a SHORT position, we BUY (isBuy=true)
      const result = await ctx.runAction(api.hyperliquid.client.closePosition, {
        privateKey: credentials.hyperliquidPrivateKey,
        address: credentials.hyperliquidAddress,
        symbol: decision.symbol,
        size: positionToClose.size,
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
      // Open new position
      const result = await ctx.runAction(api.hyperliquid.client.placeOrder, {
        privateKey: credentials.hyperliquidPrivateKey,
        address: credentials.hyperliquidAddress,
        symbol: decision.symbol!,
        isBuy: decision.decision === "OPEN_LONG",
        size: decision.size_usd! / accountState.accountValue,
        leverage: decision.leverage!,
        price: decision.price,
        testnet: credentials.hyperliquidTestnet,
      });

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
