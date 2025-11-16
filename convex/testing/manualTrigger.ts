import { action } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../_generated/api";

/**
 * Manually sync positions with Hyperliquid (fixes database sync issues)
 */
export const syncPositionsWithHyperliquid = action({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      console.log(`[Manual Sync] Starting position sync for user ${args.userId}`);

      // Get credentials
      const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
        userId: args.userId,
      });

      if (!credentials || !credentials.hyperliquidPrivateKey || !credentials.hyperliquidAddress) {
        console.error("[Manual Sync] Missing credentials");
        return { success: false, error: "Missing Hyperliquid credentials" };
      }

      // Get actual positions from Hyperliquid
      const hyperliquidPositions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
        address: credentials.hyperliquidAddress,
        testnet: credentials.hyperliquidTestnet,
      });

      console.log(`[Manual Sync] Hyperliquid has ${hyperliquidPositions.length} total positions`);

      // Extract symbols of actual positions on Hyperliquid (with non-zero size)
      const hyperliquidSymbols = hyperliquidPositions
        .map((p: any) => {
          const coin = p.position?.coin || p.coin;
          const szi = p.position?.szi || p.szi || "0";
          const size = parseFloat(szi);

          console.log(`[Manual Sync] ${coin}: size=${szi}`);

          // Only include positions with non-zero size
          return size !== 0 ? coin : null;
        })
        .filter((s: string | null): s is string => s !== null);

      console.log(`[Manual Sync] Active positions (non-zero): ${hyperliquidSymbols.join(", ") || "none"}`);

      // Sync database with reality
      await ctx.runMutation(api.mutations.syncPositions, {
        userId: args.userId,
        hyperliquidSymbols,
      });

      // Get updated positions from database
      const positions = await ctx.runQuery(api.queries.getPositions, {
        userId: args.userId,
      });

      console.log(`[Manual Sync] Database now has ${positions.length} positions`);

      return {
        success: true,
        message: "Positions synced successfully",
        hyperliquidPositions: hyperliquidSymbols.length,
        databasePositions: positions.length,
        symbols: hyperliquidSymbols,
      };

    } catch (error) {
      console.error("[Manual Sync] Error:", error);
      return {
        success: false,
        error: String(error),
      };
    }
  },
});

/**
 * Manually trigger the trading cycle for a specific user (for testing)
 * This bypasses the cron schedule and runs the loop immediately
 */
export const runTradingCycleForUser = action({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const logs: string[] = [];

    try {
      logs.push("Starting manual trading cycle...");

      // 1. Get bot config
      const botConfig = await ctx.runQuery(api.queries.getBotConfig, {
        userId: args.userId,
      });

      if (!botConfig) {
        logs.push("ERROR: No bot configuration found");
        return { success: false, logs, error: "No bot configuration found" };
      }

      logs.push(`Bot found - Model: ${botConfig.modelName}, Active: ${botConfig.isActive}`);

      // 2. Get credentials
      const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
        userId: args.userId,
      });

      if (!credentials) {
        logs.push("ERROR: No credentials found");
        return { success: false, logs, error: "No credentials configured" };
      }

      logs.push("Credentials loaded successfully");

      if (!credentials.hyperliquidPrivateKey || !credentials.hyperliquidAddress) {
        logs.push("ERROR: Missing Hyperliquid credentials");
        return { success: false, logs, error: "Missing Hyperliquid credentials" };
      }

      logs.push(`Hyperliquid wallet: ${credentials.hyperliquidAddress.slice(0, 6)}...${credentials.hyperliquidAddress.slice(-4)}`);
      logs.push(`Network: ${credentials.hyperliquidTestnet ? "Testnet" : "Mainnet"}`);

      // 3. Fetch detailed multi-timeframe market data
      logs.push(`Fetching detailed market data for: ${botConfig.symbols.join(", ")}`);

      const detailedMarketData = await ctx.runAction(api.hyperliquid.detailedMarketData.getDetailedMarketData, {
        symbols: botConfig.symbols,
        testnet: credentials.hyperliquidTestnet,
      });

      logs.push(`Detailed market data fetched for ${Object.keys(detailedMarketData).length} symbols`);
      logs.push(`(3-minute + 4-hour timeframes with historical series)`);

      // 4. Get account state
      logs.push("Fetching account state from Hyperliquid...");

      const accountState = await ctx.runAction(api.hyperliquid.client.getAccountState, {
        address: credentials.hyperliquidAddress,
        testnet: credentials.hyperliquidTestnet,
      });

      logs.push(`Account value: $${accountState.accountValue.toFixed(2)}`);

      // 5. Get current positions
      const positions = await ctx.runQuery(api.queries.getPositions, {
        userId: args.userId,
      });

      logs.push(`Current positions: ${positions.length}`);

      // 6. Get performance metrics
      logs.push("Calculating performance metrics...");

      const performanceMetrics = await ctx.runQuery(internal.trading.performanceMetrics.getPerformanceMetrics, {
        userId: args.userId,
      });

      logs.push(`Return: ${performanceMetrics.totalReturnPct.toFixed(2)}%, Sharpe: ${performanceMetrics.sharpeRatio.toFixed(2)}`);

      // 7. Make detailed trading decision using AI
      logs.push("Sending data to AI for decision (with multi-timeframe analysis)...");

      const decision = await ctx.runAction(api.ai.agents.tradingAgent.makeDetailedTradingDecision, {
        userId: args.userId,
        modelType: botConfig.modelName.startsWith("glm-") ? "zhipuai" : "openrouter",
        modelName: botConfig.modelName,
        detailedMarketData,
        accountState,
        positions,
        performanceMetrics,
        config: {
          maxLeverage: botConfig.maxLeverage,
          maxPositionSize: botConfig.maxPositionSize,
        },
      });

      logs.push(`AI Decision: ${decision.decision}`);
      logs.push(`Reasoning: ${decision.reasoning}`);
      logs.push(`Confidence: ${((decision.confidence || 0) * 100).toFixed(0)}%`);

      // 8. Save AI log
      await ctx.runMutation(api.mutations.saveAILog, {
        userId: args.userId,
        modelName: botConfig.modelName,
        systemPrompt: "Detailed multi-timeframe trading system",
        userPrompt: JSON.stringify({ detailedMarketData, accountState, positions, performanceMetrics }),
        rawResponse: JSON.stringify(decision),
        parsedResponse: decision,
        decision: decision.decision,
        reasoning: decision.reasoning,
        confidence: decision.confidence,
        accountValue: accountState.accountValue,
        marketData: detailedMarketData,
        processingTimeMs: 0,
      });

      logs.push("AI log saved to database");

      // 9. Note about execution
      if (decision.decision !== "HOLD") {
        if (botConfig.isActive) {
          logs.push(`⚠️  Bot is ACTIVE - Trade would be executed: ${decision.decision}`);
          logs.push("(Manual test mode - not executing actual trade)");
        } else {
          logs.push("Bot is INACTIVE - No trade would be executed");
        }
      }

      return {
        success: true,
        logs,
        decision,
        accountState,
        marketData: Object.keys(detailedMarketData),
      };

    } catch (error) {
      logs.push(`ERROR: ${error}`);
      console.error("Manual trading cycle error:", error);

      return {
        success: false,
        logs,
        error: String(error),
      };
    }
  },
});
