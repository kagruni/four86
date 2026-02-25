import { action } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../fnRefs";

/**
 * FORCE CLOSE any position directly on Hyperliquid
 * Use this when a position exists on the exchange but not in our database
 */
export const forceClosePosition = action({
  args: {
    userId: v.string(),
    symbol: v.string(), // e.g., "ETH", "BTC"
  },
  handler: async (ctx, args) => {
    try {
      console.log(`[Force Close] Attempting to close ${args.symbol} for user ${args.userId}`);

      // Get credentials
      const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
        userId: args.userId,
      });

      if (!credentials || !credentials.hyperliquidPrivateKey || !credentials.hyperliquidAddress) {
        return { success: false, error: "Missing Hyperliquid credentials" };
      }

      // Use NUCLEAR CLOSE - cancels all orders first, then closes
      console.log(`[Force Close] Using nuclear close (cancels orders first)...`);
      const result = await ctx.runAction(api.hyperliquid.client.nuclearClosePosition, {
        privateKey: credentials.hyperliquidPrivateKey,
        address: credentials.hyperliquidAddress,
        symbol: args.symbol,
        testnet: credentials.hyperliquidTestnet,
      });

      console.log(`[Force Close] Nuclear close result:`, result);

      // Also remove from database if it exists there
      try {
        await ctx.runMutation(api.mutations.closePosition, {
          userId: args.userId,
          symbol: args.symbol,
        });
        console.log(`[Force Close] Also removed from database`);
      } catch (dbError) {
        console.log(`[Force Close] Position wasn't in database (that's fine)`);
      }

      return {
        success: result.success,
        message: `Nuclear close completed for ${args.symbol}. Cancelled ${result.cancelledOrders} orders.`,
        txHash: result.txHash,
        cancelledOrders: result.cancelledOrders,
      };

    } catch (error) {
      console.error("[Force Close] Error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/**
 * EMERGENCY DIRECT CLOSE - doesn't need database, uses provided credentials
 * Use this when credentials aren't in the database
 */
export const emergencyDirectClose = action({
  args: {
    privateKey: v.string(),
    walletAddress: v.string(),
    symbol: v.string(),
    testnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      console.log(`[Emergency Close] Starting for ${args.symbol} on ${args.testnet ? "testnet" : "mainnet"}`);

      // Use nuclear close directly
      const result = await ctx.runAction(api.hyperliquid.client.nuclearClosePosition, {
        privateKey: args.privateKey,
        address: args.walletAddress,
        symbol: args.symbol,
        testnet: args.testnet,
      });

      console.log(`[Emergency Close] Result:`, result);
      return result;
    } catch (error) {
      console.error("[Emergency Close] Error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/**
 * DEBUG: Show all position details and try to close
 * Use this to diagnose why a position can't be closed
 */
export const debugAndClosePosition = action({
  args: {
    userId: v.string(),
    symbol: v.string(),
  },
  handler: async (ctx, args) => {
    const logs: string[] = [];
    const log = (msg: string) => {
      console.log(msg);
      logs.push(msg);
    };

    try {
      log(`[DEBUG] Starting debug for ${args.symbol}`);

      // Get credentials
      const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
        userId: args.userId,
      });

      if (!credentials || !credentials.hyperliquidPrivateKey || !credentials.hyperliquidAddress) {
        return { success: false, error: "Missing Hyperliquid credentials", logs };
      }

      log(`[DEBUG] Wallet: ${credentials.hyperliquidAddress}`);
      log(`[DEBUG] Network: ${credentials.hyperliquidTestnet ? "TESTNET" : "MAINNET"}`);

      // Get ALL positions
      const positions = await ctx.runAction(api.hyperliquid.client.getUserPositions, {
        address: credentials.hyperliquidAddress,
        testnet: credentials.hyperliquidTestnet,
      });

      log(`[DEBUG] Total positions returned: ${positions.length}`);

      // Log all positions
      for (const p of positions) {
        const pos = p.position || p;
        const coin = pos.coin;
        const szi = pos.szi || "0";
        const entryPx = pos.entryPx || "0";
        const positionValue = pos.positionValue || "0";
        const leverage = pos.leverage?.value || pos.leverage || "1";

        log(`[DEBUG] Position: ${coin} | Size: ${szi} | Entry: $${entryPx} | Value: $${positionValue} | Leverage: ${leverage}x`);
      }

      // Find specific position
      const targetPos = positions.find((p: any) => {
        const coin = p.position?.coin || p.coin;
        return coin === args.symbol;
      });

      if (!targetPos) {
        log(`[DEBUG] No position found for ${args.symbol}!`);
        return {
          success: false,
          error: `Position ${args.symbol} not found`,
          logs,
          allPositions: positions.map((p: any) => (p.position?.coin || p.coin))
        };
      }

      const pos = targetPos.position || targetPos;
      const szi = parseFloat(pos.szi || "0");
      const size = Math.abs(szi);
      const isLong = szi > 0;

      log(`[DEBUG] Target position found:`);
      log(`  - Symbol: ${args.symbol}`);
      log(`  - Side: ${isLong ? "LONG" : "SHORT"}`);
      log(`  - Size (szi): ${szi}`);
      log(`  - Abs Size: ${size}`);
      log(`  - Entry Price: ${pos.entryPx}`);
      log(`  - Position Value: ${pos.positionValue}`);
      log(`  - Leverage: ${pos.leverage?.value || pos.leverage}`);
      log(`  - Liquidation Price: ${pos.liquidationPx}`);
      log(`  - Unrealized PnL: ${pos.unrealizedPnl}`);
      log(`  - Margin Used: ${pos.marginUsed}`);
      log(`  - Max Trade Size: ${pos.maxTradeSzs}`);

      // Get open orders
      const openOrders = await ctx.runAction(api.hyperliquid.client.getUserOpenOrders, {
        address: credentials.hyperliquidAddress,
        testnet: credentials.hyperliquidTestnet,
      });

      const ordersForSymbol = openOrders.filter((o: any) => o.coin === args.symbol);
      log(`[DEBUG] Open orders for ${args.symbol}: ${ordersForSymbol.length}`);
      for (const o of ordersForSymbol) {
        log(`  - Order: ${o.side} ${o.sz} @ ${o.limitPx} (oid: ${o.oid})`);
      }

      // Get current market price
      const marketData = await ctx.runAction(api.hyperliquid.client.getMarketData, {
        symbols: [args.symbol],
        testnet: credentials.hyperliquidTestnet,
      });
      const currentPrice = marketData[args.symbol]?.price || 0;
      log(`[DEBUG] Current market price: $${currentPrice}`);

      if (size === 0) {
        log(`[DEBUG] Position size is ZERO - nothing to close`);
        return { success: false, error: "Position size is zero", logs };
      }

      // Try to close with VERY aggressive slippage (10%)
      log(`[DEBUG] Attempting close with 10% slippage...`);
      const slippage = 0.10;
      const closePrice = isLong
        ? currentPrice * (1 - slippage) // Sell lower for long
        : currentPrice * (1 + slippage); // Buy higher for short

      log(`[DEBUG] Close order: ${isLong ? "SELL" : "BUY"} ${size} @ $${closePrice.toFixed(2)}`);

      try {
        // Use the SDK directly for more control
        const result = await ctx.runAction(api.hyperliquid.client.placeOrder, {
          privateKey: credentials.hyperliquidPrivateKey,
          address: credentials.hyperliquidAddress,
          symbol: args.symbol,
          isBuy: !isLong,
          size: size,
          leverage: 1,
          price: closePrice,
          testnet: credentials.hyperliquidTestnet,
        });

        log(`[DEBUG] Close order result: ${JSON.stringify(result)}`);

        return {
          success: true,
          message: `Close order placed`,
          logs,
          result,
        };
      } catch (closeError) {
        log(`[DEBUG] Close failed: ${closeError}`);
        return {
          success: false,
          error: `Close failed: ${closeError}`,
          logs,
        };
      }

    } catch (error) {
      log(`[DEBUG] Error: ${error}`);
      return {
        success: false,
        error: String(error),
        logs,
      };
    }
  },
});

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

/**
 * Manually close a position (sell button from dashboard)
 * This securely handles the private key on the server side
 */
export const manualClosePosition = action({
  args: {
    userId: v.string(),
    symbol: v.string(),
    size: v.number(), // Size in coins
    side: v.string(), // "LONG" or "SHORT"
  },
  handler: async (ctx, args) => {
    try {
      console.log(`[Manual Close] Closing ${args.symbol} position for user ${args.userId}`);
      console.log(`[Manual Close] Size: ${args.size}, Side: ${args.side}`);

      // Get credentials securely on the server
      const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
        userId: args.userId,
      });

      if (!credentials || !credentials.hyperliquidPrivateKey || !credentials.hyperliquidAddress) {
        console.error("[Manual Close] Missing credentials");
        return { success: false, error: "Missing Hyperliquid credentials" };
      }

      // Close the position on Hyperliquid
      // To close a LONG position, we SELL (isBuy=false)
      // To close a SHORT position, we BUY (isBuy=true)
      const result = await ctx.runAction(api.hyperliquid.client.closePosition, {
        privateKey: credentials.hyperliquidPrivateKey,
        address: credentials.hyperliquidAddress,
        symbol: args.symbol,
        size: args.size,
        isBuy: args.side === "SHORT", // Opposite of position side
        testnet: credentials.hyperliquidTestnet,
      });

      console.log(`[Manual Close] Position closed on Hyperliquid:`, result);

      // Save trade record
      await ctx.runMutation(api.mutations.saveTrade, {
        userId: args.userId,
        symbol: args.symbol,
        action: "CLOSE",
        side: "CLOSE",
        size: 0,
        leverage: 1,
        price: 0,
        aiReasoning: "Manual close from dashboard",
        aiModel: "manual",
        confidence: 1,
        txHash: result.txHash,
      });

      // Remove position from database
      await ctx.runMutation(api.mutations.closePosition, {
        userId: args.userId,
        symbol: args.symbol,
      });

      console.log(`[Manual Close] Position removed from database`);

      return {
        success: true,
        message: `Successfully closed ${args.symbol} position`,
        txHash: result.txHash,
      };

    } catch (error) {
      console.error("[Manual Close] Error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/**
 * Cancel a single open order on Hyperliquid from the dashboard.
 * Resolves credentials server-side so the frontend never sees the private key.
 */
export const manualCancelOrder = action({
  args: {
    userId: v.string(),
    symbol: v.string(),
    orderId: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      console.log(`[Manual Cancel] Cancelling order ${args.orderId} for ${args.symbol}`);

      const credentials = await ctx.runQuery(internal.queries.getFullUserCredentials, {
        userId: args.userId,
      });

      if (!credentials || !credentials.hyperliquidPrivateKey || !credentials.hyperliquidAddress) {
        return { success: false, error: "Missing Hyperliquid credentials" };
      }

      const result = await ctx.runAction(api.hyperliquid.client.cancelOrder, {
        privateKey: credentials.hyperliquidPrivateKey,
        address: credentials.hyperliquidAddress,
        symbol: args.symbol,
        orderId: args.orderId,
        testnet: credentials.hyperliquidTestnet ?? true,
      });

      console.log(`[Manual Cancel] Result:`, result);
      return { success: true, message: `Cancelled order ${args.orderId} for ${args.symbol}` };
    } catch (error) {
      console.error("[Manual Cancel] Error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
