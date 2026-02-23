/**
 * Four86 Trading Data Analysis Script
 * Queries Convex database and provides a comprehensive trading report
 *
 * Usage: bunx tsx scripts/analyze-trades.ts
 */

const CONVEX_URL = "https://grateful-butterfly-323.convex.cloud";

async function convexQuery(functionName: string, args: Record<string, any> = {}) {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: functionName,
      args,
      format: "json",
    }),
  });

  const data = await res.json();
  if (data.status === "error") {
    console.error(`Error querying ${functionName}:`, data.errorMessage);
    return null;
  }
  return data.value;
}

// ═══════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════

function formatUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function formatDateShort(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short", day: "numeric"
  });
}

// ═══════════════════════════════════════════════════
// Main Analysis
// ═══════════════════════════════════════════════════

async function main() {
  console.log("\n══════════════════════════════════════════════════");
  console.log("  FOUR86 TRADING DATA ANALYSIS");
  console.log("══════════════════════════════════════════════════\n");

  // Step 1: Find all bot configs to get user IDs
  const activeBots = await convexQuery("queries:getActiveBots");

  // Also try to get all bot configs (including inactive)
  // We'll need to find user IDs from the data
  // Let's try a direct table scan approach - query with a known user pattern

  console.log("Active bots found:", activeBots?.length || 0);

  if (activeBots && activeBots.length > 0) {
    for (const bot of activeBots) {
      console.log(`  Bot: userId=${bot.userId}, model=${bot.modelName}, active=${bot.isActive}`);
    }
  }

  // Try common Clerk user ID patterns or get from the first bot
  let userId = activeBots?.[0]?.userId;

  if (!userId) {
    // Let's try to find users by querying trades directly
    console.log("\nNo active bots. Searching for historical data...\n");

    // We need to find the userId. Let's query recent trades with a broader approach.
    // Since we can't list all users, let's check if there's a way to get any data.

    // Try querying the botConfig table for any config
    const allBots = await convexQuery("queries:getActiveBots");

    if (!allBots || allBots.length === 0) {
      console.log("No bot configs found via getActiveBots.");
      console.log("\nLet's try querying with known Clerk user ID patterns...");

      // Typical Clerk user IDs start with "user_"
      // We'll need the user to provide their ID or check Clerk
      console.log("\n⚠️  Could not auto-detect user ID.");
      console.log("   Please provide your Clerk User ID as an argument:");
      console.log("   bunx tsx scripts/analyze-trades.ts user_xxxxx\n");

      // Check if provided as argument
      const argUserId = process.argv[2];
      if (argUserId) {
        userId = argUserId;
        console.log(`Using provided userId: ${userId}\n`);
      } else {
        // Try to read from .env.local for any clue
        try {
          const envContent = require('fs').readFileSync('.env.local', 'utf8');
          const addressMatch = envContent.match(/HYPERLIQUID_ADDRESS=(\S+)/);
          if (addressMatch) {
            console.log(`Found Hyperliquid address in .env.local: ${addressMatch[1]}`);
          }
        } catch {}

        console.log("\nAttempting to query with empty results...");
        console.log("Tip: You can find your Clerk User ID in the Clerk dashboard\n");
        return;
      }
    }
  }

  if (!userId) {
    console.log("No userId found. Exiting.");
    return;
  }

  console.log(`\n📊 Analyzing data for user: ${userId}`);
  console.log("─────────────────────────────────────────────────\n");

  // ─── Fetch all data in parallel ───
  const [botConfig, trades, snapshots, aiLogs] = await Promise.all([
    convexQuery("queries:getBotConfig", { userId }),
    convexQuery("queries:getRecentTrades", { userId, limit: 500 }),
    convexQuery("queries:getAccountSnapshots", { userId, limit: 500 }),
    convexQuery("queries:getRecentAILogs", { userId, limit: 200 }),
  ]);

  // ═══════════════════════════════════════════════════
  // 1. BOT CONFIGURATION
  // ═══════════════════════════════════════════════════
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║  BOT CONFIGURATION                           ║");
  console.log("╚═══════════════════════════════════════════════╝\n");

  if (botConfig) {
    console.log(`  Status:           ${botConfig.isActive ? "🟢 ACTIVE" : "🔴 INACTIVE"}`);
    console.log(`  Model:            ${botConfig.modelName}`);
    console.log(`  Starting Capital: ${formatUSD(botConfig.startingCapital)}`);
    console.log(`  Current Capital:  ${formatUSD(botConfig.currentCapital)}`);
    console.log(`  Symbols:          ${botConfig.symbols?.join(", ") || "N/A"}`);
    console.log(`  Max Leverage:     ${botConfig.maxLeverage}x`);
    console.log(`  Max Position:     ${formatUSD(botConfig.maxPositionSize)}`);
    console.log(`  Trading Mode:     ${botConfig.tradingMode || "balanced"}`);
    console.log(`  Prompt Mode:      ${botConfig.tradingPromptMode || "alpha_arena"}`);
    console.log(`  Circuit Breaker:  ${botConfig.circuitBreakerState || "active"}`);
    console.log(`  Consecutive Losses: ${botConfig.consecutiveLosses || 0}`);
    console.log(`  Created:          ${formatDate(botConfig.createdAt)}`);
  } else {
    console.log("  No bot configuration found for this user.");
  }

  // ═══════════════════════════════════════════════════
  // 2. TRADE HISTORY ANALYSIS
  // ═══════════════════════════════════════════════════
  console.log("\n╔═══════════════════════════════════════════════╗");
  console.log("║  TRADE HISTORY                               ║");
  console.log("╚═══════════════════════════════════════════════╝\n");

  if (!trades || trades.length === 0) {
    console.log("  No trades found.\n");
  } else {
    // Sort by executedAt
    const sortedTrades = [...trades].sort((a: any, b: any) => a.executedAt - b.executedAt);

    const openTrades = sortedTrades.filter((t: any) => t.action === "OPEN");
    const closeTrades = sortedTrades.filter((t: any) => t.action === "CLOSE");

    // Only closed trades have P&L
    const tradesWithPnl = closeTrades.filter((t: any) => t.pnl !== undefined && t.pnl !== null);
    const wins = tradesWithPnl.filter((t: any) => t.pnl > 0);
    const losses = tradesWithPnl.filter((t: any) => t.pnl <= 0);

    const totalPnl = tradesWithPnl.reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);
    const avgWin = wins.length > 0 ? wins.reduce((sum: number, t: any) => sum + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((sum: number, t: any) => sum + t.pnl, 0) / losses.length : 0;
    const maxWin = wins.length > 0 ? Math.max(...wins.map((t: any) => t.pnl)) : 0;
    const maxLoss = losses.length > 0 ? Math.min(...losses.map((t: any) => t.pnl)) : 0;
    const winRate = tradesWithPnl.length > 0 ? (wins.length / tradesWithPnl.length * 100) : 0;

    // Profit factor
    const grossProfit = wins.reduce((sum: number, t: any) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum: number, t: any) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Date range
    const firstTrade = sortedTrades[0];
    const lastTrade = sortedTrades[sortedTrades.length - 1];

    console.log(`  Total Trades:      ${sortedTrades.length} (${openTrades.length} opens, ${closeTrades.length} closes)`);
    console.log(`  Date Range:        ${formatDate(firstTrade.executedAt)} → ${formatDate(lastTrade.executedAt)}`);
    console.log(`  Closed with P&L:   ${tradesWithPnl.length}`);
    console.log("");
    console.log(`  Win Rate:          ${winRate.toFixed(1)}% (${wins.length}W / ${losses.length}L)`);
    console.log(`  Total P&L:         ${formatUSD(totalPnl)} ${totalPnl >= 0 ? "✓" : "✗"}`);
    console.log(`  Avg Win:           ${formatUSD(avgWin)}`);
    console.log(`  Avg Loss:          ${formatUSD(avgLoss)}`);
    console.log(`  Largest Win:       ${formatUSD(maxWin)}`);
    console.log(`  Largest Loss:      ${formatUSD(maxLoss)}`);
    console.log(`  Profit Factor:     ${profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)}`);

    // ─── Per-Symbol Breakdown ───
    console.log("\n  ─── Per-Symbol Performance ───\n");

    const symbolStats: Record<string, { trades: number; pnl: number; wins: number; losses: number }> = {};
    for (const trade of tradesWithPnl) {
      if (!symbolStats[trade.symbol]) {
        symbolStats[trade.symbol] = { trades: 0, pnl: 0, wins: 0, losses: 0 };
      }
      symbolStats[trade.symbol].trades++;
      symbolStats[trade.symbol].pnl += trade.pnl;
      if (trade.pnl > 0) symbolStats[trade.symbol].wins++;
      else symbolStats[trade.symbol].losses++;
    }

    const symbolHeader = "  Symbol     Trades   Win Rate    P&L";
    console.log(symbolHeader);
    console.log("  " + "─".repeat(symbolHeader.length - 2));

    for (const [symbol, stats] of Object.entries(symbolStats).sort((a, b) => b[1].pnl - a[1].pnl)) {
      const wr = stats.trades > 0 ? (stats.wins / stats.trades * 100).toFixed(0) : "0";
      console.log(
        `  ${symbol.padEnd(10)} ${String(stats.trades).padEnd(8)} ${(wr + "%").padEnd(11)} ${formatUSD(stats.pnl)}`
      );
    }

    // ─── Side Analysis (LONG vs SHORT) ───
    console.log("\n  ─── Long vs Short Performance ───\n");

    const longTrades = tradesWithPnl.filter((t: any) => t.side === "LONG");
    const shortTrades = tradesWithPnl.filter((t: any) => t.side === "SHORT");

    const longPnl = longTrades.reduce((s: number, t: any) => s + t.pnl, 0);
    const shortPnl = shortTrades.reduce((s: number, t: any) => s + t.pnl, 0);
    const longWins = longTrades.filter((t: any) => t.pnl > 0).length;
    const shortWins = shortTrades.filter((t: any) => t.pnl > 0).length;

    console.log(`  LONG:   ${longTrades.length} trades, WR ${longTrades.length > 0 ? (longWins / longTrades.length * 100).toFixed(0) : 0}%, P&L ${formatUSD(longPnl)}`);
    console.log(`  SHORT:  ${shortTrades.length} trades, WR ${shortTrades.length > 0 ? (shortWins / shortTrades.length * 100).toFixed(0) : 0}%, P&L ${formatUSD(shortPnl)}`);

    // ─── Recent Trades (last 10) ───
    console.log("\n  ─── Recent Trades (Last 10) ───\n");

    const recentTrades = [...sortedTrades].reverse().slice(0, 10);
    console.log("  Date            Action  Symbol  Side    Leverage  Price         P&L");
    console.log("  " + "─".repeat(75));

    for (const t of recentTrades) {
      const pnlStr = t.pnl !== undefined ? formatUSD(t.pnl) : "-";
      console.log(
        `  ${formatDate(t.executedAt).padEnd(16)} ${t.action.padEnd(7)} ${t.symbol.padEnd(7)} ${t.side.padEnd(7)} ${(t.leverage + "x").padEnd(9)} ${formatUSD(t.price).padEnd(13)} ${pnlStr}`
      );
    }

    // ─── Streak Analysis ───
    console.log("\n  ─── Streak Analysis ───\n");

    let currentStreak = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let tempWinStreak = 0;
    let tempLossStreak = 0;

    for (const t of tradesWithPnl.sort((a: any, b: any) => a.executedAt - b.executedAt)) {
      if (t.pnl > 0) {
        tempWinStreak++;
        tempLossStreak = 0;
        if (tempWinStreak > maxWinStreak) maxWinStreak = tempWinStreak;
      } else {
        tempLossStreak++;
        tempWinStreak = 0;
        if (tempLossStreak > maxLossStreak) maxLossStreak = tempLossStreak;
      }
    }

    // Current streak
    const recentClosed = [...tradesWithPnl].sort((a: any, b: any) => b.executedAt - a.executedAt);
    let streakCount = 0;
    let streakType = recentClosed[0]?.pnl > 0 ? "WIN" : "LOSS";
    for (const t of recentClosed) {
      if ((t.pnl > 0 && streakType === "WIN") || (t.pnl <= 0 && streakType === "LOSS")) {
        streakCount++;
      } else break;
    }

    console.log(`  Max Win Streak:    ${maxWinStreak}`);
    console.log(`  Max Loss Streak:   ${maxLossStreak}`);
    console.log(`  Current Streak:    ${streakCount} ${streakType}${streakCount !== 1 ? "S" : ""}`);

    // ─── Hourly Performance ───
    console.log("\n  ─── Hourly Distribution (trades by hour) ───\n");

    const hourlyDist: Record<number, { count: number; pnl: number }> = {};
    for (const t of tradesWithPnl) {
      const hour = new Date(t.executedAt).getHours();
      if (!hourlyDist[hour]) hourlyDist[hour] = { count: 0, pnl: 0 };
      hourlyDist[hour].count++;
      hourlyDist[hour].pnl += t.pnl;
    }

    for (let h = 0; h < 24; h++) {
      const data = hourlyDist[h];
      if (data) {
        const bar = "█".repeat(Math.min(data.count, 30));
        console.log(`  ${String(h).padStart(2, "0")}:00  ${bar} ${data.count} trades (${formatUSD(data.pnl)})`);
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // 3. EQUITY CURVE (Account Snapshots)
  // ═══════════════════════════════════════════════════
  console.log("\n╔═══════════════════════════════════════════════╗");
  console.log("║  EQUITY CURVE (Account Snapshots)            ║");
  console.log("╚═══════════════════════════════════════════════╝\n");

  if (!snapshots || snapshots.length === 0) {
    console.log("  No account snapshots found.\n");
  } else {
    const sortedSnapshots = [...snapshots].sort((a: any, b: any) => a.timestamp - b.timestamp);

    const firstSnap = sortedSnapshots[0];
    const lastSnap = sortedSnapshots[sortedSnapshots.length - 1];

    // Max drawdown
    let peak = -Infinity;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;

    for (const snap of sortedSnapshots) {
      if (snap.accountValue > peak) peak = snap.accountValue;
      const dd = peak - snap.accountValue;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownPct = ddPct;
      }
    }

    console.log(`  Snapshots:         ${sortedSnapshots.length}`);
    console.log(`  Date Range:        ${formatDate(firstSnap.timestamp)} → ${formatDate(lastSnap.timestamp)}`);
    console.log(`  Starting Value:    ${formatUSD(firstSnap.accountValue)}`);
    console.log(`  Current Value:     ${formatUSD(lastSnap.accountValue)}`);
    console.log(`  Peak Value:        ${formatUSD(peak)}`);
    console.log(`  Total Return:      ${formatPct(lastSnap.totalPnlPct)}`);
    console.log(`  Max Drawdown:      ${formatUSD(maxDrawdown)} (${formatPct(-maxDrawdownPct)})`);
    console.log(`  Win Rate (latest): ${(lastSnap.winRate * 100).toFixed(1)}%`);
    console.log(`  Total Trades:      ${lastSnap.numTrades}`);

    // Mini equity curve (ASCII)
    console.log("\n  ─── Equity Curve (ASCII) ───\n");

    // Sample ~40 points for ASCII chart
    const sampleSize = Math.min(40, sortedSnapshots.length);
    const step = Math.max(1, Math.floor(sortedSnapshots.length / sampleSize));
    const sampled = sortedSnapshots.filter((_: any, i: number) => i % step === 0 || i === sortedSnapshots.length - 1);

    const values = sampled.map((s: any) => s.accountValue);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const chartHeight = 15;

    // Create the chart
    for (let row = chartHeight; row >= 0; row--) {
      const threshold = min + (row / chartHeight) * range;
      let line = `  ${formatUSD(threshold).padStart(10)} │`;

      for (const val of values) {
        const normalizedVal = min + (Math.round(((val - min) / range) * chartHeight) / chartHeight) * range;
        if (Math.abs(normalizedVal - threshold) < range / chartHeight / 2) {
          line += "●";
        } else if (val >= threshold) {
          line += " ";
        } else {
          line += " ";
        }
      }
      console.log(line);
    }

    console.log(`  ${"".padStart(10)} └${"─".repeat(values.length)}`);
    console.log(`  ${"".padStart(11)}${formatDateShort(sampled[0].timestamp).padEnd(Math.floor(values.length / 2))}${formatDateShort(sampled[sampled.length - 1].timestamp)}`);

    // Daily P&L summary
    console.log("\n  ─── Daily P&L Summary ───\n");

    const dailyPnl: Record<string, { start: number; end: number; trades: number }> = {};
    for (const snap of sortedSnapshots) {
      const day = new Date(snap.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (!dailyPnl[day]) {
        dailyPnl[day] = { start: snap.accountValue, end: snap.accountValue, trades: snap.numTrades };
      }
      dailyPnl[day].end = snap.accountValue;
      dailyPnl[day].trades = snap.numTrades;
    }

    console.log("  Date          Start         End           Change");
    console.log("  " + "─".repeat(55));

    let prevEnd = 0;
    for (const [day, data] of Object.entries(dailyPnl)) {
      const start = prevEnd || data.start;
      const change = data.end - start;
      const bar = change >= 0 ? "▲" : "▼";
      console.log(
        `  ${day.padEnd(14)} ${formatUSD(start).padEnd(13)} ${formatUSD(data.end).padEnd(13)} ${bar} ${formatUSD(change)}`
      );
      prevEnd = data.end;
    }
  }

  // ═══════════════════════════════════════════════════
  // 4. AI DECISION ANALYSIS
  // ═══════════════════════════════════════════════════
  console.log("\n╔═══════════════════════════════════════════════╗");
  console.log("║  AI DECISION ANALYSIS                        ║");
  console.log("╚═══════════════════════════════════════════════╝\n");

  if (!aiLogs || aiLogs.length === 0) {
    console.log("  No AI logs found.\n");
  } else {
    const decisions = aiLogs.reduce((acc: Record<string, number>, log: any) => {
      acc[log.decision] = (acc[log.decision] || 0) + 1;
      return acc;
    }, {});

    const avgConfidence = aiLogs
      .filter((l: any) => l.confidence !== undefined)
      .reduce((sum: number, l: any, _: number, arr: any[]) => sum + l.confidence / arr.length, 0);

    const avgProcessingTime = aiLogs
      .reduce((sum: number, l: any, _: number, arr: any[]) => sum + l.processingTimeMs / arr.length, 0);

    const models = [...new Set(aiLogs.map((l: any) => l.modelName))];

    console.log(`  Total AI Decisions: ${aiLogs.length}`);
    console.log(`  Models Used:        ${models.join(", ")}`);
    console.log(`  Avg Confidence:     ${(avgConfidence * 100).toFixed(1)}%`);
    console.log(`  Avg Processing:     ${avgProcessingTime.toFixed(0)}ms`);
    console.log("");

    console.log("  Decision Distribution:");
    const total = aiLogs.length;
    for (const [decision, count] of Object.entries(decisions).sort((a: any, b: any) => b[1] - a[1])) {
      const pct = ((count as number) / total * 100).toFixed(1);
      const bar = "█".repeat(Math.round((count as number) / total * 30));
      console.log(`    ${decision.padEnd(15)} ${bar} ${count} (${pct}%)`);
    }

    // Confidence distribution
    console.log("\n  Confidence Distribution:");
    const confBuckets: Record<string, number> = {
      "0-20%": 0, "20-40%": 0, "40-60%": 0, "60-80%": 0, "80-100%": 0
    };
    for (const log of aiLogs) {
      const c = (log.confidence || 0) * 100;
      if (c < 20) confBuckets["0-20%"]++;
      else if (c < 40) confBuckets["20-40%"]++;
      else if (c < 60) confBuckets["40-60%"]++;
      else if (c < 80) confBuckets["60-80%"]++;
      else confBuckets["80-100%"]++;
    }

    for (const [bucket, count] of Object.entries(confBuckets)) {
      const bar = "█".repeat(Math.round(count / total * 40));
      console.log(`    ${bucket.padEnd(10)} ${bar} ${count}`);
    }
  }

  console.log("\n══════════════════════════════════════════════════");
  console.log("  END OF REPORT");
  console.log("══════════════════════════════════════════════════\n");
}

main().catch(console.error);
