import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Save or update user credentials
export const saveUserCredentials = mutation({
  args: {
    userId: v.string(),
    zhipuaiApiKey: v.optional(v.string()),
    openrouterApiKey: v.optional(v.string()),
    hyperliquidPrivateKey: v.optional(v.string()),
    hyperliquidAddress: v.optional(v.string()),
    hyperliquidTestnet: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing credentials
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    } else {
      // Create new credentials
      return await ctx.db.insert("userCredentials", {
        ...args,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// Delete user credentials
export const deleteUserCredentials = mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const credentials = await ctx.db
      .query("userCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (credentials) {
      await ctx.db.delete(credentials._id);
    }
  },
});

// Create or update bot configuration (without credentials)
export const upsertBotConfig = mutation({
  args: {
    userId: v.string(),
    modelName: v.string(),
    isActive: v.boolean(),
    startingCapital: v.number(),
    symbols: v.array(v.string()),
    maxLeverage: v.number(),
    maxPositionSize: v.number(),
    maxDailyLoss: v.number(),
    minAccountValue: v.number(),

    // Tier 1: Essential Risk Controls (optional for backward compatibility)
    perTradeRiskPct: v.optional(v.number()),
    maxTotalPositions: v.optional(v.number()),
    maxSameDirectionPositions: v.optional(v.number()),
    consecutiveLossLimit: v.optional(v.number()),

    // Tier 2: Trading Behavior (optional for backward compatibility)
    tradingMode: v.optional(v.string()),
    minEntryConfidence: v.optional(v.number()),
    minRiskRewardRatio: v.optional(v.number()),
    stopOutCooldownHours: v.optional(v.number()),

    // Tier 3: Advanced (optional for backward compatibility)
    minEntrySignals: v.optional(v.number()),
    require4hAlignment: v.optional(v.boolean()),
    tradeVolatileMarkets: v.optional(v.boolean()),
    volatilitySizeReduction: v.optional(v.number()),
    stopLossAtrMultiplier: v.optional(v.number()),
    tradingPromptMode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("botConfig")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("botConfig", {
        ...args,
        currentCapital: args.startingCapital,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// Toggle bot active status
export const toggleBot = mutation({
  args: {
    userId: v.string(),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("botConfig")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (config) {
      await ctx.db.patch(config._id, {
        isActive: args.isActive,
        updatedAt: Date.now(),
      });
    } else if (args.isActive) {
      // Create default config if trying to activate and no config exists
      console.log(`[toggleBot] Creating default botConfig for user ${args.userId}`);
      const now = Date.now();
      await ctx.db.insert("botConfig", {
        userId: args.userId,
        modelName: "deepseek/deepseek-r1", // Default to DeepSeek R1 (winner of Alpha Arena)
        isActive: true,
        startingCapital: 860, // Approximate from account value
        currentCapital: 860,
        symbols: ["BTC", "ETH", "SOL", "BNB", "DOGE"],
        maxLeverage: 10, // Alpha Arena style
        maxPositionSize: 30, // 30% max per position
        maxDailyLoss: 10,
        minAccountValue: 100,
        perTradeRiskPct: 2.0,
        maxTotalPositions: 3,
        maxSameDirectionPositions: 2,
        minEntryConfidence: 0.6,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// Save trade
export const saveTrade = mutation({
  args: {
    userId: v.string(),
    symbol: v.string(),
    action: v.string(),
    side: v.string(),
    size: v.number(),
    leverage: v.number(),
    price: v.number(),
    pnl: v.optional(v.number()),
    pnlPct: v.optional(v.number()),
    aiReasoning: v.string(),
    aiModel: v.string(),
    confidence: v.optional(v.number()),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("trades", {
      ...args,
      executedAt: Date.now(),
    });
  },
});

// Save AI log
export const saveAILog = mutation({
  args: {
    userId: v.string(),
    modelName: v.string(),
    systemPrompt: v.string(),
    userPrompt: v.string(),
    rawResponse: v.string(),
    parsedResponse: v.optional(v.any()),
    decision: v.string(),
    reasoning: v.string(),
    confidence: v.optional(v.number()),
    accountValue: v.number(),
    marketData: v.any(),
    processingTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("aiLogs", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// Save or update position
export const savePosition = mutation({
  args: {
    userId: v.string(),
    symbol: v.string(),
    side: v.string(),
    size: v.number(),
    leverage: v.number(),
    entryPrice: v.number(),
    currentPrice: v.number(),
    unrealizedPnl: v.number(),
    unrealizedPnlPct: v.number(),
    stopLoss: v.optional(v.number()),
    takeProfit: v.optional(v.number()),
    liquidationPrice: v.number(),

    // Exit plan and invalidation
    invalidationCondition: v.optional(v.string()),
    entryReasoning: v.optional(v.string()),
    confidence: v.optional(v.number()),

    // Order tracking
    entryOrderId: v.optional(v.string()),
    takeProfitOrderId: v.optional(v.string()),
    stopLossOrderId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("positions")
      .withIndex("by_symbol", (q) =>
        q.eq("userId", args.userId).eq("symbol", args.symbol)
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        lastUpdated: now,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("positions", {
        ...args,
        openedAt: now,
        lastUpdated: now,
      });
    }
  },
});

// Close position
export const closePosition = mutation({
  args: {
    userId: v.string(),
    symbol: v.string(),
  },
  handler: async (ctx, args) => {
    const position = await ctx.db
      .query("positions")
      .withIndex("by_symbol", (q) =>
        q.eq("userId", args.userId).eq("symbol", args.symbol)
      )
      .first();

    if (position) {
      await ctx.db.delete(position._id);
    }
  },
});

// Sync positions with Hyperliquid (remove positions that don't exist on exchange)
export const syncPositions = mutation({
  args: {
    userId: v.string(),
    hyperliquidSymbols: v.array(v.string()), // Array of symbols that actually exist on Hyperliquid
  },
  handler: async (ctx, args) => {
    console.log(`[syncPositions] Syncing for user ${args.userId}`);
    console.log(`[syncPositions] Hyperliquid has positions: ${args.hyperliquidSymbols.join(", ") || "none"}`);

    // Get all database positions for this user
    const dbPositions = await ctx.db
      .query("positions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    console.log(`[syncPositions] Database has ${dbPositions.length} positions`);

    const now = Date.now();
    const GRACE_PERIOD_MS = 3 * 60 * 1000; // 3 minutes

    // Find positions in database that don't exist on Hyperliquid
    // BUT: Don't remove positions opened less than 3 minutes ago (order might still be filling)
    const positionsToRemove = dbPositions.filter((dbPos) => {
      const isOnHyperliquid = args.hyperliquidSymbols.includes(dbPos.symbol);
      const age = now - dbPos.openedAt;
      const isOldEnough = age > GRACE_PERIOD_MS;

      if (!isOnHyperliquid) {
        if (isOldEnough) {
          console.log(`[syncPositions] ${dbPos.symbol} not on HL and old enough (${Math.floor(age / 1000)}s) - will remove`);
          return true; // Remove it
        } else {
          console.log(`[syncPositions] ${dbPos.symbol} not on HL but too new (${Math.floor(age / 1000)}s) - keeping for now (grace period)`);
          return false; // Keep it (grace period)
        }
      }
      return false; // It's on Hyperliquid, keep it
    });

    // Remove stale positions
    for (const position of positionsToRemove) {
      console.log(`[syncPositions] Removing stale position: ${position.symbol}`);

      // Preserve lifecycle integrity: when sync removes a DB position that no longer
      // exists on exchange, record a system CLOSE event instead of silently deleting.
      await ctx.db.insert("trades", {
        userId: args.userId,
        symbol: position.symbol,
        action: "CLOSE",
        side: position.side,
        size: Math.abs(position.size || 0),
        leverage: position.leverage || 1,
        price: position.currentPrice || position.entryPrice || 0,
        // Uses last known DB unrealized values as best-effort estimate.
        pnl: position.unrealizedPnl,
        pnlPct: position.unrealizedPnlPct,
        aiReasoning: "SYNC_CLOSE: Position not found on exchange during reconciliation",
        aiModel: "system_sync",
        confidence: 1.0,
        txHash: "sync_reconcile_close",
        executedAt: now,
      });

      await ctx.db.delete(position._id);
    }

    console.log(`[syncPositions] Removed ${positionsToRemove.length} stale positions`);
    console.log(`[syncPositions] Sync complete - ${dbPositions.length - positionsToRemove.length} positions remain`);
  },
});

// Save account snapshot
export const saveAccountSnapshot = mutation({
  args: {
    userId: v.string(),
    accountValue: v.number(),
    totalPnl: v.number(),
    totalPnlPct: v.number(),
    numTrades: v.number(),
    winRate: v.number(),
    positions: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("accountSnapshots", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

// Save system log
export const saveSystemLog = mutation({
  args: {
    userId: v.optional(v.string()),
    level: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("systemLogs", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

// Acquire trading lock (prevents concurrent trading loops)
export const acquireTradingLock = mutation({
  args: {
    userId: v.string(),
    lockId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const LOCK_TIMEOUT_MS = 120000; // 2 minutes
    
    // Check if active lock exists
    const existingLock = await ctx.db
      .query("tradingLocks")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.gt(q.field("expiresAt"), now))
      .first();
    
    if (existingLock) {
      // Lock already exists and is not expired
      return { success: false, reason: "lock_exists", lockId: existingLock.lockId };
    }
    
    // Acquire new lock
    await ctx.db.insert("tradingLocks", {
      userId: args.userId,
      lockId: args.lockId,
      acquiredAt: now,
      expiresAt: now + LOCK_TIMEOUT_MS,
    });
    
    return { success: true, lockId: args.lockId };
  },
});

// Release trading lock
export const releaseTradingLock = mutation({
  args: {
    userId: v.string(),
    lockId: v.string(),
  },
  handler: async (ctx, args) => {
    // Find the specific lock
    const lock = await ctx.db
      .query("tradingLocks")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("lockId"), args.lockId))
      .first();
    
    if (lock) {
      await ctx.db.delete(lock._id);
      return { success: true };
    }
    
    return { success: false, reason: "lock_not_found" };
  },
});

// Clean up expired locks (called periodically)
export const cleanupExpiredLocks = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const expiredLocks = await ctx.db
      .query("tradingLocks")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    for (const lock of expiredLocks) {
      await ctx.db.delete(lock._id);
    }

    // Also clean up expired symbol trade locks
    const expiredSymbolLocks = await ctx.db
      .query("symbolTradeLocks")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .collect();

    for (const lock of expiredSymbolLocks) {
      await ctx.db.delete(lock._id);
    }

    return { cleaned: expiredLocks.length, symbolLocksCleaned: expiredSymbolLocks.length };
  },
});

// Acquire per-symbol trade lock (prevents rapid duplicate orders)
// RACE-CONDITION SAFE: Uses "insert first, verify after" pattern
export const acquireSymbolTradeLock = mutation({
  args: {
    userId: v.string(),
    symbol: v.string(),
    side: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const LOCK_DURATION_MS = 120000; // 120 seconds - increased to prevent duplicates during slow AI responses

    // Step 1: Clean up ALL expired locks for this user/symbol first
    const expiredLocks = await ctx.db
      .query("symbolTradeLocks")
      .withIndex("by_userId_symbol", (q) => q.eq("userId", args.userId).eq("symbol", args.symbol))
      .filter((q) => q.lte(q.field("expiresAt"), now))
      .collect();

    for (const lock of expiredLocks) {
      await ctx.db.delete(lock._id);
    }

    // Step 2: Check if an active lock already exists
    const existingLock = await ctx.db
      .query("symbolTradeLocks")
      .withIndex("by_userId_symbol", (q) => q.eq("userId", args.userId).eq("symbol", args.symbol))
      .filter((q) => q.gt(q.field("expiresAt"), now))
      .first();

    if (existingLock) {
      const secondsRemaining = Math.ceil((existingLock.expiresAt - now) / 1000);
      console.log(`[SymbolLock] Lock exists for ${args.symbol}: ${secondsRemaining}s remaining (lockId: ${existingLock._id})`);
      return {
        success: false,
        reason: "symbol_locked",
        symbol: args.symbol,
        secondsRemaining
      };
    }

    // Step 3: Insert our lock with a unique token
    const lockToken = `${args.userId}-${args.symbol}-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const newLockId = await ctx.db.insert("symbolTradeLocks", {
      userId: args.userId,
      symbol: args.symbol,
      side: args.side,
      attemptedAt: now,
      expiresAt: now + LOCK_DURATION_MS,
    });

    // Step 4: RACE CONDITION CHECK - Verify we're the only lock holder
    // Get ALL active locks for this user/symbol (including ours)
    const allActiveLocks = await ctx.db
      .query("symbolTradeLocks")
      .withIndex("by_userId_symbol", (q) => q.eq("userId", args.userId).eq("symbol", args.symbol))
      .filter((q) => q.gt(q.field("expiresAt"), now))
      .collect();

    // If there are multiple locks, only the OLDEST one (by attemptedAt) wins
    if (allActiveLocks.length > 1) {
      // Sort by attemptedAt to find the winner
      allActiveLocks.sort((a, b) => a.attemptedAt - b.attemptedAt);
      const winningLock = allActiveLocks[0];

      if (winningLock._id !== newLockId) {
        // We lost the race - delete our lock and fail
        await ctx.db.delete(newLockId);
        console.log(`[SymbolLock] RACE LOST for ${args.symbol}: Another lock won (winner: ${winningLock._id})`);
        return {
          success: false,
          reason: "race_condition_lost",
          symbol: args.symbol,
          secondsRemaining: Math.ceil((winningLock.expiresAt - now) / 1000)
        };
      }

      // We won! Delete all other locks (losers)
      for (const lock of allActiveLocks) {
        if (lock._id !== newLockId) {
          await ctx.db.delete(lock._id);
          console.log(`[SymbolLock] Cleaned up losing lock: ${lock._id}`);
        }
      }
    }

    console.log(`[SymbolLock] Lock acquired for ${args.symbol} (${args.side}) - lockId: ${newLockId}`);
    return { success: true, symbol: args.symbol, lockId: newLockId };
  },
});

// Release per-symbol trade lock (call after trade completes or fails)
export const releaseSymbolTradeLock = mutation({
  args: {
    userId: v.string(),
    symbol: v.string(),
  },
  handler: async (ctx, args) => {
    // Find and delete the lock
    const lock = await ctx.db
      .query("symbolTradeLocks")
      .withIndex("by_userId_symbol", (q) => q.eq("userId", args.userId).eq("symbol", args.symbol))
      .first();

    if (lock) {
      await ctx.db.delete(lock._id);
      console.log(`[SymbolLock] Lock released for ${args.symbol}`);
      return { success: true };
    }

    return { success: false, reason: "lock_not_found" };
  },
});

// Update circuit breaker state on botConfig
export const updateCircuitBreakerState = mutation({
  args: {
    userId: v.string(),
    circuitBreakerState: v.optional(v.string()),
    consecutiveAiFailures: v.optional(v.number()),
    consecutiveLosses: v.optional(v.number()),
    circuitBreakerTrippedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("botConfig")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!config) return;

    const { userId, ...updates } = args;
    await ctx.db.patch(config._id, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

// Manual circuit breaker reset from dashboard
export const resetCircuitBreaker = mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("botConfig")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!config) return;

    await ctx.db.patch(config._id, {
      circuitBreakerState: "active",
      consecutiveAiFailures: 0,
      consecutiveLosses: 0,
      circuitBreakerTrippedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});
