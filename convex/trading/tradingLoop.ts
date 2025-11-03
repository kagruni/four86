import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getMarketData, getAccountState, placeOrder, closePosition } from "../hyperliquid/client";
import { makeTradingDecision } from "../ai/agents/tradingAgent";

export const runTradingCycle = internalAction({
  handler: async (ctx) => {
    // Get all active bots
    const activeBots = await ctx.runQuery(internal.queries.getActiveBots);

    console.log(`Running trading cycle for ${activeBots.length} active bot(s)`);

    for (const bot of activeBots) {
      try {
        console.log(`Processing bot ${bot._id} for user ${bot.userId}`);

        // 1. Fetch market data for all symbols
        const marketData = await getMarketData(ctx, {
          symbols: bot.symbols,
          testnet: true,
        });

        // 2. Get account state from Hyperliquid
        const accountState = await getAccountState(ctx, {
          address: bot.hyperliquidAddress,
          testnet: true,
        });

        // 3. Get current positions from database
        const positions = await ctx.runQuery(internal.queries.getPositions, {
          userId: bot.userId,
        });

        // 4. Use LangChain agent to make trading decision
        const decision = await makeTradingDecision(ctx, {
          modelType: bot.modelName === "glm-4-plus" ? "zhipuai" : "openrouter",
          modelName: bot.modelName,
          marketData,
          accountState,
          positions,
          config: {
            maxLeverage: bot.maxLeverage,
            maxPositionSize: bot.maxPositionSize,
          },
        });

        // 5. Save AI log
        await ctx.runMutation(internal.mutations.saveAILog, {
          userId: bot.userId,
          modelName: bot.modelName,
          systemPrompt: "Trading system prompt", // Will be properly formatted in production
          userPrompt: JSON.stringify({ marketData, accountState, positions }),
          rawResponse: JSON.stringify(decision),
          parsedResponse: decision,
          decision: decision.decision,
          reasoning: decision.reasoning,
          confidence: decision.confidence,
          accountValue: accountState.accountValue,
          marketData,
          processingTimeMs: 0,
        });

        // 6. Execute trade if needed
        if (decision.decision !== "HOLD") {
          await executeTradeDecision(ctx, bot, decision, accountState);
        }

        console.log(`Bot ${bot._id} decision: ${decision.decision}`);

      } catch (error) {
        console.error(`Error in trading cycle for bot ${bot._id}:`, error);
        await ctx.runMutation(internal.mutations.saveSystemLog, {
          userId: bot.userId,
          level: "ERROR",
          message: "Trading cycle error",
          data: { error: String(error) },
        });
      }
    }
  },
});

async function executeTradeDecision(ctx: any, bot: any, decision: any, accountState: any) {
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
      // Close existing position
      const result = await closePosition(ctx, {
        privateKey: bot.hyperliquidPrivateKey,
        address: bot.hyperliquidAddress,
        symbol: decision.symbol,
        testnet: true,
      });

      // Save trade record
      await ctx.runMutation(internal.mutations.saveTrade, {
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
      await ctx.runMutation(internal.mutations.closePosition, {
        userId: bot.userId,
        symbol: decision.symbol,
      });

    } else if (decision.decision === "OPEN_LONG" || decision.decision === "OPEN_SHORT") {
      // Open new position
      const result = await placeOrder(ctx, {
        privateKey: bot.hyperliquidPrivateKey,
        address: bot.hyperliquidAddress,
        symbol: decision.symbol!,
        isBuy: decision.decision === "OPEN_LONG",
        size: decision.size_usd! / accountState.accountValue,
        leverage: decision.leverage!,
        price: decision.price,
        testnet: true,
      });

      // Save trade record
      await ctx.runMutation(internal.mutations.saveTrade, {
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

      // Save position to database
      await ctx.runMutation(internal.mutations.savePosition, {
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
      });

      console.log(`Executed ${decision.decision} for ${decision.symbol} at $${result.price}`);
    }
  } catch (error) {
    console.error("Error executing trade:", error);
    await ctx.runMutation(internal.mutations.saveSystemLog, {
      userId: bot.userId,
      level: "ERROR",
      message: "Trade execution error",
      data: { error: String(error), decision },
    });
  }
}
