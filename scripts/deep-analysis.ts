/**
 * Deep trade-by-trade breakdown for Four86
 * Usage: bunx tsx scripts/deep-analysis.ts <userId>
 */

const CONVEX_URL = "https://grateful-butterfly-323.convex.cloud";
const USER_ID = process.argv[2] || "";

async function convexQuery(fn: string, args: Record<string, any> = {}) {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: fn, args, format: "json" }),
  });
  const data = await res.json();
  if (data.status === "error") { console.error(`Error [${fn}]:`, data.errorMessage); return null; }
  return data.value;
}

function fmtUSD(n: number) { return `$${n.toFixed(2)}`; }
function fmtPct(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`; }
function fmtDate(ts: number) {
  return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function main() {
  if (!USER_ID) { console.log("Usage: bunx tsx scripts/deep-analysis.ts <userId>"); return; }

  // Fetch everything
  const [trades, snapshots, aiLogs, botConfig] = await Promise.all([
    convexQuery("queries:getRecentTrades", { userId: USER_ID, limit: 1000 }),
    convexQuery("queries:getAccountSnapshots", { userId: USER_ID, limit: 1000 }),
    convexQuery("queries:getRecentAILogs", { userId: USER_ID, limit: 1000 }),
    convexQuery("queries:getBotConfig", { userId: USER_ID }),
  ]);

  const allTrades = [...(trades || [])].sort((a: any, b: any) => a.executedAt - b.executedAt);
  const allSnaps = [...(snapshots || [])].sort((a: any, b: any) => a.timestamp - b.timestamp);
  const allAI = [...(aiLogs || [])].sort((a: any, b: any) => a.createdAt - b.createdAt);

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log("  FOUR86 DEEP TRADE BREAKDOWN");
  console.log("══════════════════════════════════════════════════════════════════\n");

  // ────────────────────────────────────────────────────
  // 1. TIMELINE — When was the bot actually trading?
  // ────────────────────────────────────────────────────
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  1. TRADING ACTIVITY TIMELINE                              │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Group trades by day
  const tradesByDay: Record<string, any[]> = {};
  for (const t of allTrades) {
    const day = new Date(t.executedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    if (!tradesByDay[day]) tradesByDay[day] = [];
    tradesByDay[day].push(t);
  }

  console.log("  Date              Opens  Closes  Total  Symbols Traded");
  console.log("  " + "─".repeat(62));

  for (const [day, dayTrades] of Object.entries(tradesByDay)) {
    const opens = dayTrades.filter((t: any) => t.action === "OPEN").length;
    const closes = dayTrades.filter((t: any) => t.action === "CLOSE").length;
    const symbols = [...new Set(dayTrades.map((t: any) => t.symbol))].join(", ");
    const bar = "█".repeat(Math.min(dayTrades.length, 40));
    console.log(
      `  ${day.padEnd(18)} ${String(opens).padEnd(6)} ${String(closes).padEnd(7)} ${String(dayTrades.length).padEnd(6)} ${symbols}`
    );
    console.log(`  ${"".padEnd(18)} ${bar}`);
  }

  // ────────────────────────────────────────────────────
  // 2. PAIR OPEN/CLOSE TRADES — Match entries to exits
  // ────────────────────────────────────────────────────
  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│  2. MATCHED TRADE PAIRS (Entry → Exit)                     │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  // Try to match OPEN trades to their CLOSE trades for the same symbol
  const openStack: Record<string, any[]> = {};
  const matchedPairs: any[] = [];
  const unmatchedOpens: any[] = [];

  for (const t of allTrades) {
    if (t.action === "OPEN") {
      const key = `${t.symbol}_${t.side}`;
      if (!openStack[key]) openStack[key] = [];
      openStack[key].push(t);
    } else if (t.action === "CLOSE") {
      // Find matching open - try symbol match first
      // Close trades have side = the original side, or sometimes "CLOSE"
      let matchKey = `${t.symbol}_${t.side}`;
      if (t.side === "CLOSE") {
        // Try both
        matchKey = `${t.symbol}_LONG`;
        if (!openStack[matchKey]?.length) matchKey = `${t.symbol}_SHORT`;
      }

      const stack = openStack[matchKey];
      if (stack && stack.length > 0) {
        const openTrade = stack.shift()!;
        const holdTimeMs = t.executedAt - openTrade.executedAt;
        const holdTimeMin = Math.round(holdTimeMs / 60000);
        const holdTimeStr = holdTimeMin >= 60
          ? `${Math.floor(holdTimeMin / 60)}h ${holdTimeMin % 60}m`
          : `${holdTimeMin}m`;

        matchedPairs.push({
          symbol: t.symbol,
          side: openTrade.side,
          entryPrice: openTrade.price,
          exitPrice: t.price,
          leverage: openTrade.leverage,
          size: openTrade.size,
          pnl: t.pnl || 0,
          pnlPct: t.pnlPct || 0,
          entryTime: openTrade.executedAt,
          exitTime: t.executedAt,
          holdTime: holdTimeStr,
          holdTimeMin,
          entryReasoning: openTrade.aiReasoning?.substring(0, 80) || "",
          exitReasoning: t.aiReasoning?.substring(0, 80) || "",
          confidence: openTrade.confidence,
        });
      }
    }
  }

  // Count unmatched opens
  for (const [key, stack] of Object.entries(openStack)) {
    unmatchedOpens.push(...stack);
  }

  console.log(`  Matched pairs: ${matchedPairs.length}`);
  console.log(`  Unmatched opens (still open or no close recorded): ${unmatchedOpens.length}\n`);

  if (matchedPairs.length > 0) {
    console.log("  #   Symbol  Side    Lev  Entry Price    Exit Price     P&L          Hold Time   Conf");
    console.log("  " + "─".repeat(95));

    for (let i = 0; i < matchedPairs.length; i++) {
      const p = matchedPairs[i];
      const pnlStr = p.pnl !== 0 ? fmtUSD(p.pnl) : "$0.00";
      const pnlColor = p.pnl > 0 ? " ✓" : p.pnl < 0 ? " ✗" : "  ";
      const confStr = p.confidence ? `${(p.confidence * 100).toFixed(0)}%` : "-";
      console.log(
        `  ${String(i + 1).padStart(3)}  ${p.symbol.padEnd(7)} ${p.side.padEnd(7)} ${(p.leverage + "x").padEnd(4)} ${fmtUSD(p.entryPrice).padEnd(14)} ${fmtUSD(p.exitPrice).padEnd(14)} ${(pnlStr + pnlColor).padEnd(12)} ${p.holdTime.padEnd(11)} ${confStr}`
      );
    }

    // Summarize matched pairs
    const pairsWithPnl = matchedPairs.filter(p => p.pnl !== 0);
    const pairWins = pairsWithPnl.filter(p => p.pnl > 0);
    const pairLosses = pairsWithPnl.filter(p => p.pnl < 0);
    const breakEven = matchedPairs.filter(p => p.pnl === 0);

    console.log(`\n  Summary: ${pairWins.length} wins, ${pairLosses.length} losses, ${breakEven.length} break-even`);

    // Hold time analysis
    const avgHoldWin = pairWins.length > 0 ? pairWins.reduce((s, p) => s + p.holdTimeMin, 0) / pairWins.length : 0;
    const avgHoldLoss = pairLosses.length > 0 ? pairLosses.reduce((s, p) => s + p.holdTimeMin, 0) / pairLosses.length : 0;
    const avgHoldAll = matchedPairs.length > 0 ? matchedPairs.reduce((s, p) => s + p.holdTimeMin, 0) / matchedPairs.length : 0;

    console.log(`\n  Avg Hold Time (all):    ${avgHoldAll.toFixed(0)} min`);
    console.log(`  Avg Hold Time (wins):   ${avgHoldWin.toFixed(0)} min`);
    console.log(`  Avg Hold Time (losses): ${avgHoldLoss.toFixed(0)} min`);
  }

  // ────────────────────────────────────────────────────
  // 3. FULL TRADE LOG (chronological)
  // ────────────────────────────────────────────────────
  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│  3. COMPLETE TRADE LOG (Chronological)                     │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  console.log("  #    Date              Action  Symbol  Side    Lev  Size        Price          P&L         Model");
  console.log("  " + "─".repeat(110));

  for (let i = 0; i < allTrades.length; i++) {
    const t = allTrades[i];
    const pnlStr = t.pnl !== undefined && t.pnl !== null ? fmtUSD(t.pnl) : "-";
    const model = t.aiModel ? t.aiModel.split("/").pop()?.substring(0, 15) : "-";
    console.log(
      `  ${String(i + 1).padStart(4)} ${fmtDate(t.executedAt).padEnd(18)} ${t.action.padEnd(7)} ${t.symbol.padEnd(7)} ${t.side.padEnd(7)} ${(t.leverage + "x").padEnd(4)} ${fmtUSD(t.size).padEnd(11)} ${fmtUSD(t.price).padEnd(14)} ${pnlStr.padEnd(11)} ${model}`
    );
  }

  // ────────────────────────────────────────────────────
  // 4. LEVERAGE ANALYSIS
  // ────────────────────────────────────────────────────
  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│  4. LEVERAGE & SIZE ANALYSIS                               │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  const closedTrades = allTrades.filter((t: any) => t.action === "CLOSE" && t.pnl !== undefined);

  // By leverage
  const leverageStats: Record<number, { count: number; pnl: number; wins: number }> = {};
  for (const t of closedTrades) {
    const lev = t.leverage;
    if (!leverageStats[lev]) leverageStats[lev] = { count: 0, pnl: 0, wins: 0 };
    leverageStats[lev].count++;
    leverageStats[lev].pnl += t.pnl;
    if (t.pnl > 0) leverageStats[lev].wins++;
  }

  console.log("  Leverage   Trades   Win Rate    Total P&L");
  console.log("  " + "─".repeat(45));
  for (const [lev, stats] of Object.entries(leverageStats).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const wr = stats.count > 0 ? (stats.wins / stats.count * 100).toFixed(0) : "0";
    console.log(`  ${(lev + "x").padEnd(10)} ${String(stats.count).padEnd(8)} ${(wr + "%").padEnd(11)} ${fmtUSD(stats.pnl)}`);
  }

  // Position size distribution
  const openTrades = allTrades.filter((t: any) => t.action === "OPEN");
  const sizes = openTrades.map((t: any) => t.size);
  const avgSize = sizes.reduce((s: number, v: number) => s + v, 0) / sizes.length || 0;
  const minSize = Math.min(...sizes);
  const maxSize = Math.max(...sizes);

  console.log(`\n  Position Size Stats (on opens):`);
  console.log(`    Average: ${fmtUSD(avgSize)}`);
  console.log(`    Min:     ${fmtUSD(minSize)}`);
  console.log(`    Max:     ${fmtUSD(maxSize)}`);

  // ────────────────────────────────────────────────────
  // 5. EQUITY CURVE DETAIL
  // ────────────────────────────────────────────────────
  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│  5. EQUITY CURVE — DAY-BY-DAY                              │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  if (allSnaps.length > 0) {
    // Group snapshots by day, take first and last per day
    const snapsByDay: Record<string, { first: any; last: any; count: number; min: number; max: number }> = {};
    for (const s of allSnaps) {
      const day = new Date(s.timestamp).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      if (!snapsByDay[day]) {
        snapsByDay[day] = { first: s, last: s, count: 0, min: s.accountValue, max: s.accountValue };
      }
      snapsByDay[day].last = s;
      snapsByDay[day].count++;
      if (s.accountValue < snapsByDay[day].min) snapsByDay[day].min = s.accountValue;
      if (s.accountValue > snapsByDay[day].max) snapsByDay[day].max = s.accountValue;
    }

    console.log("  Date              Open        Close       Low         High        Change      Snapshots");
    console.log("  " + "─".repeat(85));

    for (const [day, data] of Object.entries(snapsByDay)) {
      const change = data.last.accountValue - data.first.accountValue;
      const arrow = change >= 0 ? "▲" : "▼";
      console.log(
        `  ${day.padEnd(18)} ${fmtUSD(data.first.accountValue).padEnd(11)} ${fmtUSD(data.last.accountValue).padEnd(11)} ${fmtUSD(data.min).padEnd(11)} ${fmtUSD(data.max).padEnd(11)} ${arrow} ${fmtUSD(Math.abs(change)).padEnd(11)} ${data.count}`
      );
    }

    // Drawdown analysis
    console.log("\n  ─── Drawdown Periods ───\n");

    let peak = allSnaps[0].accountValue;
    let peakTime = allSnaps[0].timestamp;
    let inDrawdown = false;
    let ddStart = 0;
    let ddPeak = 0;
    const drawdowns: { start: number; trough: number; troughTime: number; peakVal: number; troughVal: number; depth: number; depthPct: number }[] = [];
    let currentTrough = allSnaps[0].accountValue;
    let currentTroughTime = allSnaps[0].timestamp;

    for (const s of allSnaps) {
      if (s.accountValue >= peak) {
        if (inDrawdown) {
          drawdowns.push({
            start: ddStart,
            trough: currentTroughTime,
            troughTime: currentTroughTime,
            peakVal: ddPeak,
            troughVal: currentTrough,
            depth: ddPeak - currentTrough,
            depthPct: ((ddPeak - currentTrough) / ddPeak) * 100,
          });
        }
        peak = s.accountValue;
        peakTime = s.timestamp;
        inDrawdown = false;
      } else {
        if (!inDrawdown) {
          inDrawdown = true;
          ddStart = peakTime;
          ddPeak = peak;
          currentTrough = s.accountValue;
          currentTroughTime = s.timestamp;
        }
        if (s.accountValue < currentTrough) {
          currentTrough = s.accountValue;
          currentTroughTime = s.timestamp;
        }
      }
    }

    // Still in drawdown
    if (inDrawdown) {
      drawdowns.push({
        start: ddStart,
        trough: currentTroughTime,
        troughTime: currentTroughTime,
        peakVal: ddPeak,
        troughVal: currentTrough,
        depth: ddPeak - currentTrough,
        depthPct: ((ddPeak - currentTrough) / ddPeak) * 100,
      });
    }

    if (drawdowns.length > 0) {
      console.log("  #   Peak Date          Peak Value   Trough Date       Trough Value  Drawdown");
      console.log("  " + "─".repeat(80));
      for (let i = 0; i < drawdowns.length; i++) {
        const dd = drawdowns[i];
        console.log(
          `  ${String(i + 1).padStart(3)}  ${fmtDate(dd.start).padEnd(18)} ${fmtUSD(dd.peakVal).padEnd(12)} ${fmtDate(dd.troughTime).padEnd(18)} ${fmtUSD(dd.troughVal).padEnd(13)} -${fmtUSD(dd.depth)} (${fmtPct(-dd.depthPct)})`
        );
      }
    }
  }

  // ────────────────────────────────────────────────────
  // 6. AI REASONING — What is the AI actually saying?
  // ────────────────────────────────────────────────────
  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│  6. AI DECISION REASONING (Recent non-HOLD decisions)      │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  const nonHold = allAI.filter((l: any) => l.decision !== "HOLD");
  const holdCount = allAI.filter((l: any) => l.decision === "HOLD").length;

  console.log(`  Total AI calls: ${allAI.length}`);
  console.log(`  HOLD decisions: ${holdCount} (${(holdCount / allAI.length * 100).toFixed(1)}%)`);
  console.log(`  Action decisions: ${nonHold.length} (${(nonHold.length / allAI.length * 100).toFixed(1)}%)\n`);

  if (nonHold.length > 0) {
    console.log("  ─── Recent Action Decisions ───\n");
    for (const log of nonHold.slice(-20)) {
      console.log(`  [${fmtDate(log.createdAt)}] ${log.decision} | Confidence: ${log.confidence ? (log.confidence * 100).toFixed(0) + "%" : "N/A"}`);
      console.log(`    Model: ${log.modelName}`);
      console.log(`    Reasoning: ${log.reasoning.substring(0, 200)}${log.reasoning.length > 200 ? "..." : ""}`);
      console.log("");
    }
  }

  // Sample some HOLD reasons
  console.log("  ─── Sample HOLD Reasons (last 5) ───\n");
  const recentHolds = allAI.filter((l: any) => l.decision === "HOLD").slice(-5);
  for (const log of recentHolds) {
    console.log(`  [${fmtDate(log.createdAt)}] HOLD | Confidence: ${log.confidence ? (log.confidence * 100).toFixed(0) + "%" : "N/A"}`);
    const reason = log.reasoning.startsWith("{") ? "(JSON blob — no readable reasoning)" : log.reasoning.substring(0, 150);
    console.log(`    ${reason}`);
    console.log("");
  }

  // ────────────────────────────────────────────────────
  // 7. PHASE ANALYSIS — break by time period
  // ────────────────────────────────────────────────────
  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│  7. TRADING PHASES (by week)                               │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  const tradesByWeek: Record<string, any[]> = {};
  for (const t of allTrades) {
    const d = new Date(t.executedAt);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const weekKey = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (!tradesByWeek[weekKey]) tradesByWeek[weekKey] = [];
    tradesByWeek[weekKey].push(t);
  }

  console.log("  Week of        Total  Opens  Closes  Realized P&L  Symbols");
  console.log("  " + "─".repeat(65));

  for (const [week, wTrades] of Object.entries(tradesByWeek)) {
    const opens = wTrades.filter((t: any) => t.action === "OPEN").length;
    const closes = wTrades.filter((t: any) => t.action === "CLOSE").length;
    const pnl = wTrades
      .filter((t: any) => t.action === "CLOSE" && t.pnl !== undefined)
      .reduce((s: number, t: any) => s + (t.pnl || 0), 0);
    const symbols = [...new Set(wTrades.map((t: any) => t.symbol))].join(", ");
    console.log(
      `  ${week.padEnd(14)} ${String(wTrades.length).padEnd(6)} ${String(opens).padEnd(6)} ${String(closes).padEnd(7)} ${fmtUSD(pnl).padEnd(13)} ${symbols}`
    );
  }

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log("  END OF DEEP ANALYSIS");
  console.log("══════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
