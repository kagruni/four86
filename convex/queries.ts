import { query, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const AI_LOG_MATCH_WINDOW_MS = 10 * 60 * 1000;

function getExpectedDecisionForTrade(trade: {
  action: string;
  side: string;
}) {
  if (trade.action === "OPEN") {
    return trade.side === "SHORT" ? "OPEN_SHORT" : "OPEN_LONG";
  }

  if (trade.action === "CLOSE") {
    return "CLOSE";
  }

  return null;
}

function getAiLogSymbol(log: any) {
  const parsedResponse = log?.parsedResponse as any;
  return parsedResponse?.symbol ?? parsedResponse?.close_symbol ?? null;
}

function getStoredCandidateSet(log: any) {
  const parsedResponse = log?.parsedResponse as any;
  return parsedResponse?.candidateSet ?? log?.marketData?.candidateSet ?? null;
}

function getMatchedCandidate(candidateSet: any, selectedCandidateId: string | null) {
  if (!candidateSet || !selectedCandidateId) {
    return null;
  }

  const allCandidates = [
    ...(Array.isArray(candidateSet.topCandidates) ? candidateSet.topCandidates : []),
    ...(Array.isArray(candidateSet.candidates) ? candidateSet.candidates : []),
  ];

  return allCandidates.find((candidate: any) => candidate?.id === selectedCandidateId) ?? null;
}

function findBestMatchingAiLog(trade: any, aiLogs: any[]) {
  const expectedDecision = getExpectedDecisionForTrade(trade);
  let bestMatch: { log: any; score: number; deltaMs: number; matchReason: string } | null = null;

  for (const log of aiLogs) {
    const deltaMs = Math.abs((log?.createdAt ?? 0) - trade.executedAt);
    if (deltaMs > AI_LOG_MATCH_WINDOW_MS) {
      continue;
    }

    const parsedResponse = log?.parsedResponse as any;
    const logSymbol = getAiLogSymbol(log);
    let score = 0;
    let matchReason = "time_window";

    score -= deltaMs / 60_000;

    if (expectedDecision && log.decision === expectedDecision) {
      score += 6;
      matchReason = "decision_and_time";
    } else if (expectedDecision) {
      score -= 4;
    }

    if (logSymbol === trade.symbol) {
      score += 5;
      matchReason = expectedDecision && log.decision === expectedDecision
        ? "decision_symbol_time"
        : "symbol_and_time";
    } else if (logSymbol) {
      score -= 3;
    }

    if (log.reasoning && trade.aiReasoning && log.reasoning === trade.aiReasoning) {
      score += 12;
      matchReason = "exact_reasoning";
    }

    if (typeof log.confidence === "number" && typeof trade.confidence === "number") {
      const confidenceDelta = Math.abs(log.confidence - trade.confidence);
      if (confidenceDelta < 0.001) {
        score += 2;
      }
    }

    if (parsedResponse?.selectedCandidateId) {
      score += 0.5;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        log,
        score,
        deltaMs,
        matchReason,
      };
    }
  }

  if (!bestMatch || bestMatch.score < 2) {
    return null;
  }

  return bestMatch;
}

// Get user credentials (NEVER return private keys to frontend - use internal queries)
export const getUserCredentials = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const credentials = await ctx.db
      .query("userCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!credentials) {
      return null;
    }

    // Return sanitized version (no private keys exposed to frontend)
    return {
      _id: credentials._id,
      userId: credentials.userId,
      hasZhipuaiApiKey: !!credentials.zhipuaiApiKey,
      hasOpenrouterApiKey: !!credentials.openrouterApiKey,
      hasHyperliquidPrivateKey: !!credentials.hyperliquidPrivateKey,
      hyperliquidAddress: credentials.hyperliquidAddress,
      hyperliquidTestnet: credentials.hyperliquidTestnet,
      createdAt: credentials.createdAt,
      updatedAt: credentials.updatedAt,
    };
  },
});

// Check if user has set up credentials
export const hasCredentials = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const credentials = await ctx.db
      .query("userCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    return !!credentials;
  },
});

// Get bot configuration for current user
export const getBotConfig = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("botConfig")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

// Get all active bots (for cron jobs)
export const getActiveBots = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("botConfig")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

// Get current positions
export const getPositions = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("positions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

// Get recent trades
export const getRecentTrades = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    return await ctx.db
      .query("trades")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
  },
});

// Get recent AI logs
export const getRecentAILogs = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;
    return await ctx.db
      .query("aiLogs")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
  },
});

// Get recent filled/recorded trades with linked AI context for dashboard export/debugging
export const getRecentTradeDebugExport = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;

    const trades = await ctx.db
      .query("trades")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);

    const aiLogs = await ctx.db
      .query("aiLogs")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(Math.max(limit * 6, 120));

    return trades.map((trade) => {
      const matched = findBestMatchingAiLog(trade, aiLogs);
      const matchedLog = matched?.log ?? null;
      const parsedResponse = (matchedLog?.parsedResponse ?? null) as any;
      const candidateSet = getStoredCandidateSet(matchedLog);
      const selectedCandidateId = parsedResponse?.selectedCandidateId ?? null;
      const selectedCandidate = getMatchedCandidate(candidateSet, selectedCandidateId);

      return {
        trade: {
          _id: trade._id,
          symbol: trade.symbol,
          action: trade.action,
          side: trade.side,
          size: trade.size,
          sizeInCoins: trade.sizeInCoins ?? null,
          tradeValueUsd: trade.tradeValueUsd ?? null,
          leverage: trade.leverage,
          price: trade.price,
          pnl: trade.pnl ?? null,
          pnlPct: trade.pnlPct ?? null,
          orderId: trade.orderId ?? null,
          fillTime: trade.fillTime ?? null,
          fee: trade.fee ?? null,
          feeToken: trade.feeToken ?? null,
          grossPnl: trade.grossPnl ?? null,
          pnlSource: trade.pnlSource ?? null,
          txHash: trade.txHash ?? null,
          aiReasoning: trade.aiReasoning,
          aiModel: trade.aiModel,
          confidence: trade.confidence ?? null,
          executedAt: trade.executedAt,
        },
        aiLog: matchedLog ? {
          _id: matchedLog._id,
          createdAt: matchedLog.createdAt,
          decision: matchedLog.decision,
          reasoning: matchedLog.reasoning,
          confidence: matchedLog.confidence ?? null,
          modelName: matchedLog.modelName,
          selectionMode: parsedResponse?.selectionMode ?? null,
          selectedCandidateId,
          executionResult: parsedResponse?.executionResult ?? null,
          marketSnapshotSummary: parsedResponse?.marketSnapshotSummary ?? null,
          match: {
            deltaMs: matched?.deltaMs ?? null,
            score: matched?.score ?? null,
            reason: matched?.matchReason ?? null,
          },
        } : null,
        deterministicFilters: candidateSet ? {
          stored: true,
          scoreFloor: candidateSet.scoreFloor ?? null,
          forcedHold: candidateSet.forcedHold ?? null,
          holdReason: candidateSet.holdReason ?? null,
          topCandidates: candidateSet.topCandidates ?? [],
          blockedCandidates: candidateSet.blockedCandidates ?? [],
          closeCandidates: candidateSet.closeCandidates ?? [],
          selectedCandidate,
          candidateScoreBreakdown: parsedResponse?.candidateScoreBreakdown ?? null,
        } : null,
      };
    });
  },
});

// Get account snapshots
export const getAccountSnapshots = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
    since: v.optional(v.number()), // timestamp cutoff – return only snapshots >= this
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;

    if (args.since) {
      // Use the compound index to filter server-side by timestamp range
      return await ctx.db
        .query("accountSnapshots")
        .withIndex("by_userId_time", (q) =>
          q.eq("userId", args.userId).gte("timestamp", args.since!)
        )
        .order("asc")
        .collect();
    }

    return await ctx.db
      .query("accountSnapshots")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
  },
});

// Internal query to get full credentials (for trading loop only)
export const getFullUserCredentials = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("userCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

// Internal query to get all positions (for position sync cron)
export const getAllPositionsForSync = internalQuery({
  handler: async (ctx) => {
    return await ctx.db.query("positions").collect();
  },
});

/**
 * Get recent trading actions (OPEN/CLOSE only, skip HOLD)
 * Used for AI context to remember recent decisions and outcomes
 * Returns last N actions with concise info for prompt injection
 */
export const getRecentTradingActions = internalQuery({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 5;

    const actions = await ctx.db
      .query("aiLogs")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .filter((q) =>
        q.or(
          q.eq(q.field("decision"), "OPEN_LONG"),
          q.eq(q.field("decision"), "OPEN_SHORT"),
          q.eq(q.field("decision"), "CLOSE")
        )
      )
      .take(limit);

    // Get corresponding trades to find outcomes (P&L)
    const tradesMap = new Map();
    const trades = await ctx.db
      .query("trades")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit * 2); // Get more trades to ensure we find matches

    trades.forEach(trade => {
      const key = `${trade.symbol}_${trade.executedAt}`;
      tradesMap.set(key, trade);
    });

    return actions.map(action => {
      const timestamp = new Date(action.createdAt).toISOString().slice(11, 16); // HH:MM
      const parsedResponse = action.parsedResponse as any;
      const symbol = parsedResponse?.symbol || "";

      // Find matching trade for P&L info
      let pnl = null;
      let pnlPct = null;
      for (const trade of trades) {
        if (
          trade.symbol === symbol &&
          Math.abs(trade.executedAt - action.createdAt) < 5000 // Within 5 seconds
        ) {
          pnl = trade.pnl;
          pnlPct = trade.pnlPct;
          break;
        }
      }

      return {
        timestamp,
        decision: action.decision,
        symbol,
        reasoning: action.reasoning,
        confidence: action.confidence || 0,
        pnl,
        pnlPct,
      };
    });
  },
});


// Get latest market research/sentiment data
export const getLatestMarketResearch = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("marketResearch")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .first();
  },
});

// Internal: Get latest market research (for trading loop)
export const getLatestMarketResearchInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("marketResearch")
      .withIndex("by_userId_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .first();
  },
});

// Check if trading lock exists for user
export const getTradingLock = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Get active lock (not expired)
    const lock = await ctx.db
      .query("tradingLocks")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.gt(q.field("expiresAt"), now))
      .first();
    
    return lock;
  },
});
