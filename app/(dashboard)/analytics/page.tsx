"use client";

import { useState, useMemo } from "react";
import { useUser } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Target,
  Trophy,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Brain,
  Clock,
  Minus,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

type TimeframeKey = "7D" | "30D" | "90D" | "ALL";

interface Trade {
  _id: string;
  userId: string;
  symbol: string;
  action: string;
  side: string;
  size: number;
  leverage: number;
  price: number;
  pnl?: number;
  pnlPct?: number;
  aiReasoning: string;
  aiModel: string;
  confidence?: number;
  txHash?: string;
  executedAt: number;
}

interface AILog {
  _id: string;
  modelName: string;
  decision: string;
  reasoning: string;
  confidence?: number;
  accountValue: number;
  createdAt: number;
}

interface SymbolPerformanceData {
  symbol: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  bestTrade: number;
  worstTrade: number;
}

interface ConfidenceBin {
  range: string;
  count: number;
  minVal: number;
  maxVal: number;
}

interface ConfidenceOutcome {
  winningAvg: number | null;
  losingAvg: number | null;
  winCount: number;
  loseCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const formatPercent = (value: number): string =>
  `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const formatPercentShort = (value: number): string =>
  `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

const formatShortDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

const formatTooltipDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatTimestamp = (timestamp: number): string =>
  new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatTimestampFull = (timestamp: number): string =>
  new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + "...";
}

// ─── Timeframe filter ─────────────────────────────────────────────────────────

const TIMEFRAME_MS: Record<TimeframeKey, number> = {
  "7D": 7 * 24 * 60 * 60 * 1000,
  "30D": 30 * 24 * 60 * 60 * 1000,
  "90D": 90 * 24 * 60 * 60 * 1000,
  ALL: Infinity,
};

// ─── Animation variants ───────────────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: "easeOut" as const },
  },
};

// ─── Card styling constant ────────────────────────────────────────────────────

const cardClass =
  "border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden transition-all duration-300 hover:shadow-md";

// ─── Computation Functions ────────────────────────────────────────────────────

function computeSymbolPerformance(trades: Trade[]): SymbolPerformanceData[] {
  const closeTrades = trades.filter(
    (t) => t.action === "CLOSE" && t.pnl !== undefined
  );

  const grouped: Record<string, Trade[]> = {};
  for (const trade of closeTrades) {
    if (!grouped[trade.symbol]) grouped[trade.symbol] = [];
    grouped[trade.symbol].push(trade);
  }

  const results: SymbolPerformanceData[] = Object.entries(grouped).map(
    ([symbol, symbolTrades]) => {
      const pnls = symbolTrades.map((t) => t.pnl!);
      const wins = pnls.filter((p) => p > 0).length;
      const totalPnl = pnls.reduce((sum, p) => sum + p, 0);
      const avgPnl = totalPnl / pnls.length;
      const bestTrade = Math.max(...pnls);
      const worstTrade = Math.min(...pnls);

      return {
        symbol,
        trades: symbolTrades.length,
        wins,
        winRate: (wins / symbolTrades.length) * 100,
        totalPnl,
        avgPnl,
        bestTrade,
        worstTrade,
      };
    }
  );

  return results.sort((a, b) => b.totalPnl - a.totalPnl);
}

function buildConfidenceBins(aiLogs: AILog[]): ConfidenceBin[] {
  const bins: ConfidenceBin[] = [
    { range: "50-55%", count: 0, minVal: 0.5, maxVal: 0.55 },
    { range: "55-60%", count: 0, minVal: 0.55, maxVal: 0.6 },
    { range: "60-65%", count: 0, minVal: 0.6, maxVal: 0.65 },
    { range: "65-70%", count: 0, minVal: 0.65, maxVal: 0.7 },
    { range: "70-75%", count: 0, minVal: 0.7, maxVal: 0.75 },
    { range: "75-80%", count: 0, minVal: 0.75, maxVal: 0.8 },
    { range: "80%+", count: 0, minVal: 0.8, maxVal: 1.01 },
  ];

  for (const log of aiLogs) {
    if (log.confidence === undefined || log.confidence === null) continue;
    const c = log.confidence;
    for (const bin of bins) {
      if (c >= bin.minVal && c < bin.maxVal) {
        bin.count++;
        break;
      }
    }
  }

  return bins;
}

function computeConfidenceVsOutcome(trades: Trade[]): ConfidenceOutcome {
  const closedWithConfidence = trades.filter(
    (t) =>
      t.action === "CLOSE" &&
      t.pnl !== undefined &&
      t.confidence !== undefined &&
      t.confidence !== null
  );

  const winners = closedWithConfidence.filter((t) => t.pnl! > 0);
  const losers = closedWithConfidence.filter((t) => t.pnl! <= 0);

  const winningAvg =
    winners.length > 0
      ? winners.reduce((s, t) => s + t.confidence!, 0) / winners.length
      : null;

  const losingAvg =
    losers.length > 0
      ? losers.reduce((s, t) => s + t.confidence!, 0) / losers.length
      : null;

  return { winningAvg, losingAvg, winCount: winners.length, loseCount: losers.length };
}

// ─── Decision Timeline Config ─────────────────────────────────────────────────

const decisionConfig: Record<
  string,
  { label: string; borderClass: string; textClass: string; icon: typeof Minus }
> = {
  OPEN_LONG: {
    label: "OPEN LONG",
    borderClass: "border-black",
    textClass: "text-black",
    icon: ArrowUpRight,
  },
  OPEN_SHORT: {
    label: "OPEN SHORT",
    borderClass: "border-gray-600",
    textClass: "text-gray-600",
    icon: ArrowDownRight,
  },
  CLOSE: {
    label: "CLOSE",
    borderClass: "border-gray-400",
    textClass: "text-gray-500",
    icon: Minus,
  },
  HOLD: {
    label: "HOLD",
    borderClass: "border-gray-300",
    textClass: "text-gray-400",
    icon: Minus,
  },
};

function getDecisionConfig(decision: string) {
  return (
    decisionConfig[decision] || {
      label: decision,
      borderClass: "border-gray-300",
      textClass: "text-gray-500",
      icon: Minus,
    }
  );
}

// ─── Custom Tooltip Components ────────────────────────────────────────────────

function EquityCurveTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 shadow-md">
      <p className="text-xs text-gray-500">{formatTooltipDate(d.timestamp)}</p>
      <p className="font-mono text-sm font-bold tabular-nums text-gray-900">
        {formatCurrency(d.accountValue)}
      </p>
    </div>
  );
}

function TradeBarTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-gray-900">
        {d.symbol} &middot; {d.side}
      </p>
      <p className="text-xs text-gray-500">{formatTooltipDate(d.executedAt)}</p>
      <p
        className={`font-mono text-sm font-bold tabular-nums ${
          d.pnl >= 0 ? "text-gray-900" : "text-gray-500"
        }`}
      >
        {formatCurrency(d.pnl)}
      </p>
    </div>
  );
}

function ConfidenceTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 shadow-md">
      <p className="text-xs font-semibold text-black">{label}</p>
      <p className="text-xs font-mono tabular-nums text-gray-600">
        {payload[0].value} decisions
      </p>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN PAGE COMPONENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function AnalyticsPage() {
  const { user } = useUser();
  const userId = user?.id || "";

  // ── Data fetching ─────────────────────────────────────────────────────────
  const botConfig = useQuery(api.queries.getBotConfig, { userId });
  const rawTrades = useQuery(api.queries.getRecentTrades, {
    userId,
    limit: 200,
  }) as Trade[] | undefined;
  const rawSnapshots = useQuery(api.queries.getAccountSnapshots, {
    userId,
    limit: 200,
  });
  const rawAiLogs = useQuery(api.queries.getRecentAILogs, {
    userId,
    limit: 100,
  }) as AILog[] | undefined;

  // ── Local state ───────────────────────────────────────────────────────────
  const [timeframe, setTimeframe] = useState<TimeframeKey>("30D");

  // ── Loading guard ─────────────────────────────────────────────────────────
  const isLoading =
    botConfig === undefined ||
    rawTrades === undefined ||
    rawSnapshots === undefined ||
    rawAiLogs === undefined;

  // ── Computed: closed trades ───────────────────────────────────────────────
  const closedTrades = useMemo(
    () =>
      (rawTrades || []).filter(
        (t) => t.action === "CLOSE" && t.pnl !== undefined
      ),
    [rawTrades]
  );

  const allTrades = useMemo(() => rawTrades || [], [rawTrades]);
  const allAiLogs = useMemo(() => rawAiLogs || [], [rawAiLogs]);

  // ── Section 1: Hero metrics ───────────────────────────────────────────────
  const heroMetrics = useMemo(() => {
    if (!closedTrades.length) {
      return {
        totalReturnPct: 0,
        sharpeRatio: null as number | null,
        winRate: 0,
        totalTrades: 0,
        bestTrade: 0,
        worstTrade: 0,
      };
    }

    const startingCapital = botConfig?.startingCapital || 1;
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalReturnPct = (totalPnl / startingCapital) * 100;

    const wins = closedTrades.filter((t) => (t.pnl || 0) > 0).length;
    const winRate = (wins / closedTrades.length) * 100;

    const pnls = closedTrades.map((t) => t.pnl || 0);
    const bestTrade = Math.max(...pnls);
    const worstTrade = Math.min(...pnls);

    // Sharpe ratio (simplified annualized)
    let sharpeRatio: number | null = null;
    if (pnls.length >= 2) {
      const returns = pnls.map((p) => p / startingCapital);
      const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
      const variance =
        returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev > 0) {
        sharpeRatio = (mean / stdDev) * Math.sqrt(252);
      }
    }

    return {
      totalReturnPct,
      sharpeRatio,
      winRate,
      totalTrades: closedTrades.length,
      bestTrade,
      worstTrade,
    };
  }, [closedTrades, botConfig]);

  // ── Section 2: Equity curve data ──────────────────────────────────────────
  const equityCurveData = useMemo(() => {
    if (!rawSnapshots || rawSnapshots.length === 0) return [];

    const now = Date.now();
    const cutoff = TIMEFRAME_MS[timeframe];
    const sorted = [...rawSnapshots]
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((s) => cutoff === Infinity || now - s.timestamp <= cutoff);

    return sorted.map((s) => ({
      timestamp: s.timestamp,
      accountValue: s.accountValue,
    }));
  }, [rawSnapshots, timeframe]);

  // ── Section 3: Trade performance bars ─────────────────────────────────────
  const tradeBarData = useMemo(() => {
    if (!closedTrades.length) return [];

    return [...closedTrades]
      .sort((a, b) => a.executedAt - b.executedAt)
      .map((t, i) => ({
        index: i,
        symbol: t.symbol,
        side: t.side,
        pnl: t.pnl || 0,
        executedAt: t.executedAt,
      }));
  }, [closedTrades]);

  // ── Section 4: Symbol performance ─────────────────────────────────────────
  const symbolData = useMemo(
    () => computeSymbolPerformance(allTrades),
    [allTrades]
  );

  // ── Section 5: AI confidence ──────────────────────────────────────────────
  const confidenceBins = useMemo(
    () => buildConfidenceBins(allAiLogs),
    [allAiLogs]
  );
  const confidenceOutcome = useMemo(
    () => computeConfidenceVsOutcome(allTrades),
    [allTrades]
  );
  const hasHistogramData = confidenceBins.some((b) => b.count > 0);
  const hasOutcomeData =
    confidenceOutcome.winningAvg !== null ||
    confidenceOutcome.losingAvg !== null;

  // ── Section 6: Decision timeline ──────────────────────────────────────────
  const recentDecisions = useMemo(
    () =>
      [...allAiLogs]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20),
    [allAiLogs]
  );

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-200px)] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-black" />
          <p className="mt-4 font-mono text-sm tracking-wide text-gray-500">
            Loading analytics...
          </p>
        </div>
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  return (
    <motion.div
      className="space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <div>
          <h1 className="text-3xl font-bold text-black">Analytics</h1>
          <p className="mt-2 text-sm text-gray-500">
            Performance analytics and trading insights
          </p>
        </div>
      </motion.div>

      {/* ━━━ Section 1: Performance Hero Strip ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <motion.div variants={itemVariants}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {/* Total Return – dark treatment */}
          <div className="rounded-lg bg-gray-950 px-4 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-gray-400" />
              <p className="text-xs text-gray-400">Total Return</p>
            </div>
            <p
              className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                heroMetrics.totalReturnPct >= 0
                  ? "text-white"
                  : "text-gray-400"
              }`}
            >
              {formatPercent(heroMetrics.totalReturnPct)}
            </p>
          </div>

          {/* Sharpe Ratio */}
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <div className="flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-gray-400" />
              <p className="text-xs text-gray-500">Sharpe Ratio</p>
            </div>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-gray-900">
              {heroMetrics.sharpeRatio !== null
                ? heroMetrics.sharpeRatio.toFixed(2)
                : "--"}
            </p>
          </div>

          {/* Win Rate */}
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <div className="flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-gray-400" />
              <p className="text-xs text-gray-500">Win Rate</p>
            </div>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-gray-900">
              {heroMetrics.totalTrades > 0
                ? `${heroMetrics.winRate.toFixed(1)}%`
                : "--"}
            </p>
          </div>

          {/* Total Trades */}
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <div className="flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-gray-400" />
              <p className="text-xs text-gray-500">Total Trades</p>
            </div>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-gray-900">
              {heroMetrics.totalTrades}
            </p>
          </div>

          {/* Best Trade */}
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <div className="flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-gray-400" />
              <p className="text-xs text-gray-500">Best Trade</p>
            </div>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-gray-900">
              {heroMetrics.totalTrades > 0
                ? formatCurrency(heroMetrics.bestTrade)
                : "--"}
            </p>
          </div>

          {/* Worst Trade */}
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-gray-400" />
              <p className="text-xs text-gray-500">Worst Trade</p>
            </div>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-gray-500">
              {heroMetrics.totalTrades > 0
                ? formatCurrency(heroMetrics.worstTrade)
                : "--"}
            </p>
          </div>
        </div>
      </motion.div>

      {/* ━━━ Section 2: Equity Curve ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <motion.div variants={itemVariants}>
        <Card className={cardClass}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-black">
                Equity Curve
              </CardTitle>
              <div className="flex gap-1">
                {(["7D", "30D", "90D", "ALL"] as TimeframeKey[]).map((tf) => (
                  <Button
                    key={tf}
                    variant="ghost"
                    size="sm"
                    onClick={() => setTimeframe(tf)}
                    className={`h-7 px-2.5 font-mono text-xs ${
                      timeframe === tf
                        ? "bg-gray-900 text-white hover:bg-gray-800 hover:text-white"
                        : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    {tf}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {equityCurveData.length === 0 ? (
              <div className="flex h-64 items-center justify-center">
                <p className="font-mono text-sm text-gray-400">No data yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart
                  data={equityCurveData}
                  margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="equityFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#000000"
                        stopOpacity={0.08}
                      />
                      <stop
                        offset="100%"
                        stopColor="#000000"
                        stopOpacity={0.01}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="#e5e5e5"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={formatShortDate}
                    tick={{
                      fontSize: 11,
                      fontFamily: "monospace",
                      fill: "#737373",
                    }}
                    axisLine={{ stroke: "#e5e5e5" }}
                    tickLine={false}
                    minTickGap={40}
                  />
                  <YAxis
                    tickFormatter={(v: number) =>
                      `$${(v / 1000).toFixed(v >= 1000 ? 1 : 0)}${
                        v >= 1000 ? "k" : ""
                      }`
                    }
                    tick={{
                      fontSize: 11,
                      fontFamily: "monospace",
                      fill: "#737373",
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={55}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip content={<EquityCurveTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="accountValue"
                    stroke="#000000"
                    strokeWidth={1.5}
                    fill="url(#equityFill)"
                    dot={false}
                    activeDot={{
                      r: 4,
                      fill: "#000000",
                      stroke: "#ffffff",
                      strokeWidth: 2,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ━━━ Section 3: Trade Performance Bars ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <motion.div variants={itemVariants}>
        <Card className={cardClass}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-black">
              Trade Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {tradeBarData.length === 0 ? (
              <div className="flex h-64 items-center justify-center">
                <p className="font-mono text-sm text-gray-400">
                  No closed trades yet
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={tradeBarData}
                  margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
                >
                  <CartesianGrid
                    stroke="#e5e5e5"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="index"
                    tick={{
                      fontSize: 11,
                      fontFamily: "monospace",
                      fill: "#737373",
                    }}
                    axisLine={{ stroke: "#e5e5e5" }}
                    tickLine={false}
                    label={{
                      value: "Trade #",
                      position: "insideBottomRight",
                      offset: -5,
                      style: {
                        fontSize: 10,
                        fontFamily: "monospace",
                        fill: "#a3a3a3",
                      },
                    }}
                  />
                  <YAxis
                    tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                    tick={{
                      fontSize: 11,
                      fontFamily: "monospace",
                      fill: "#737373",
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={55}
                  />
                  <Tooltip content={<TradeBarTooltip />} />
                  <ReferenceLine y={0} stroke="#d4d4d4" strokeWidth={1} />
                  <Bar dataKey="pnl" radius={[2, 2, 0, 0]} maxBarSize={24}>
                    {tradeBarData.map((entry, idx) => (
                      <Cell
                        key={`bar-${idx}`}
                        fill={entry.pnl >= 0 ? "#171717" : "#d4d4d4"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ━━━ Section 4: Symbol Performance Grid ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <motion.div variants={itemVariants}>
        <Card className={cardClass}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-black">Symbol Performance</CardTitle>
                <p className="text-xs text-gray-500 mt-1">
                  Breakdown by trading pair (closed trades only)
                </p>
              </div>
              <BarChart3 className="h-4 w-4 text-gray-500" />
            </div>
          </CardHeader>
          <CardContent>
            {symbolData.length === 0 ? (
              <div className="py-12 text-center text-sm font-mono text-gray-500">
                No closed trades yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-black hover:bg-gray-50">
                      <TableHead className="text-black font-semibold">
                        Symbol
                      </TableHead>
                      <TableHead className="text-black font-semibold text-right">
                        Trades
                      </TableHead>
                      <TableHead className="text-black font-semibold text-right">
                        Win Rate
                      </TableHead>
                      <TableHead className="text-black font-semibold text-right">
                        Total P&L
                      </TableHead>
                      <TableHead className="text-black font-semibold text-right">
                        Avg P&L
                      </TableHead>
                      <TableHead className="text-black font-semibold text-right">
                        Best
                      </TableHead>
                      <TableHead className="text-black font-semibold text-right">
                        Worst
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {symbolData.map((row) => (
                      <TableRow
                        key={row.symbol}
                        className="border-gray-300 even:bg-gray-50/50 hover:bg-black/[0.02] transition-colors duration-150"
                      >
                        <TableCell className="font-mono font-semibold text-black">
                          {row.symbol}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-black">
                          {row.trades}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          <span
                            className={
                              row.winRate >= 50
                                ? "text-black font-medium"
                                : "text-gray-600"
                            }
                          >
                            {row.winRate.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono tabular-nums font-medium ${
                            row.totalPnl >= 0 ? "text-black" : "text-gray-600"
                          }`}
                        >
                          {formatCurrency(row.totalPnl)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono tabular-nums ${
                            row.avgPnl >= 0 ? "text-black" : "text-gray-600"
                          }`}
                        >
                          {formatCurrency(row.avgPnl)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-black">
                          {formatCurrency(row.bestTrade)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-gray-600">
                          {formatCurrency(row.worstTrade)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Totals row */}
                <div className="mt-3 flex items-center justify-between border-t border-gray-900 pt-3 px-4">
                  <span className="text-xs font-semibold text-black uppercase tracking-wider">
                    Total
                  </span>
                  <div className="flex items-center gap-6">
                    <span className="text-xs font-mono tabular-nums text-gray-500">
                      {symbolData.reduce((s, r) => s + r.trades, 0)} trades
                    </span>
                    <span
                      className={`text-sm font-mono tabular-nums font-bold ${
                        symbolData.reduce((s, r) => s + r.totalPnl, 0) >= 0
                          ? "text-black"
                          : "text-gray-600"
                      }`}
                    >
                      {formatCurrency(
                        symbolData.reduce((s, r) => s + r.totalPnl, 0)
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ━━━ Section 5: AI Confidence Analysis ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <motion.div variants={itemVariants}>
        <Card className={cardClass}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-black">
                  AI Confidence Analysis
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1">
                  Decision confidence distribution and trade outcomes
                </p>
              </div>
              <Brain className="h-4 w-4 text-gray-500" />
            </div>
          </CardHeader>
          <CardContent>
            {!hasHistogramData && !hasOutcomeData ? (
              <div className="py-12 text-center text-sm font-mono text-gray-500">
                No confidence data yet
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                {/* Left: Confidence Distribution Histogram */}
                <div>
                  <h4 className="text-xs font-semibold text-black uppercase tracking-wider mb-4">
                    Confidence Distribution
                  </h4>
                  {!hasHistogramData ? (
                    <div className="flex h-[200px] items-center justify-center text-sm font-mono text-gray-500">
                      No data yet
                    </div>
                  ) : (
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={confidenceBins}
                          margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#e5e5e5"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="range"
                            tick={{ fontSize: 10, fill: "#737373" }}
                            tickLine={false}
                            axisLine={{ stroke: "#e5e5e5" }}
                          />
                          <YAxis
                            tick={{ fontSize: 10, fill: "#737373" }}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                          />
                          <Tooltip content={<ConfidenceTooltip />} />
                          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                            {confidenceBins.map((_, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={index >= 5 ? "#171717" : "#a3a3a3"}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* Right: Confidence vs Outcome */}
                <div>
                  <h4 className="text-xs font-semibold text-black uppercase tracking-wider mb-4">
                    Confidence vs Outcome
                  </h4>
                  {!hasOutcomeData ? (
                    <div className="flex h-[200px] items-center justify-center text-sm font-mono text-gray-500">
                      No data yet
                    </div>
                  ) : (
                    <div className="space-y-6 pt-2">
                      {/* Winning trades avg confidence */}
                      <div className="rounded-lg border border-gray-200 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="h-4 w-4 text-black" />
                          <span className="text-xs font-semibold text-black uppercase tracking-wider">
                            Winning Trades
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="text-3xl font-mono font-bold tabular-nums text-black">
                            {confidenceOutcome.winningAvg !== null
                              ? `${(confidenceOutcome.winningAvg * 100).toFixed(1)}%`
                              : "--"}
                          </span>
                          <span className="text-xs font-mono tabular-nums text-gray-500">
                            {confidenceOutcome.winCount} trades
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Avg confidence
                        </p>
                      </div>

                      {/* Losing trades avg confidence */}
                      <div className="rounded-lg border border-gray-200 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingDown className="h-4 w-4 text-gray-500" />
                          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                            Losing Trades
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="text-3xl font-mono font-bold tabular-nums text-gray-600">
                            {confidenceOutcome.losingAvg !== null
                              ? `${(confidenceOutcome.losingAvg * 100).toFixed(1)}%`
                              : "--"}
                          </span>
                          <span className="text-xs font-mono tabular-nums text-gray-500">
                            {confidenceOutcome.loseCount} trades
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Avg confidence
                        </p>
                      </div>

                      {/* Confidence delta */}
                      {confidenceOutcome.winningAvg !== null &&
                        confidenceOutcome.losingAvg !== null && (
                          <div className="flex items-center justify-between border-t border-gray-200 pt-3">
                            <span className="text-xs text-gray-500">
                              Confidence Delta
                            </span>
                            <span
                              className={`text-sm font-mono font-bold tabular-nums ${
                                confidenceOutcome.winningAvg -
                                  confidenceOutcome.losingAvg >
                                0
                                  ? "text-black"
                                  : "text-gray-600"
                              }`}
                            >
                              {formatPercentShort(
                                (confidenceOutcome.winningAvg -
                                  confidenceOutcome.losingAvg) *
                                  100
                              )}
                            </span>
                          </div>
                        )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ━━━ Section 6: Decision Activity Timeline ━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <motion.div variants={itemVariants}>
        <Card className={cardClass}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-black">Decision Activity</CardTitle>
                <p className="text-xs text-gray-500 mt-1">
                  Recent AI trading decisions (last 20)
                </p>
              </div>
              <Clock className="h-4 w-4 text-gray-500" />
            </div>
          </CardHeader>
          <CardContent>
            {recentDecisions.length === 0 ? (
              <div className="py-12 text-center text-sm font-mono text-gray-500">
                No AI decisions yet
              </div>
            ) : (
              <ScrollArea className="h-[500px] pr-4">
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-200" />

                  <div className="space-y-0">
                    {recentDecisions.map((log, index) => {
                      const config = getDecisionConfig(log.decision);
                      const Icon = config.icon;

                      return (
                        <motion.div
                          key={log._id || index}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{
                            duration: 0.3,
                            delay: index * 0.04,
                          }}
                          className="relative pl-7 pb-5 last:pb-0"
                        >
                          {/* Timeline dot */}
                          <div
                            className={`absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 bg-white ${config.borderClass}`}
                          />

                          {/* Content */}
                          <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 hover:bg-gray-50 transition-colors duration-150">
                            {/* Top row: badge + timestamp */}
                            <div className="flex items-center justify-between mb-2">
                              <Badge
                                variant="outline"
                                className={`${config.borderClass} ${config.textClass} bg-white text-xs`}
                              >
                                <Icon className="mr-1 h-3 w-3" />
                                {config.label}
                              </Badge>
                              <span className="text-xs font-mono tabular-nums text-gray-400">
                                {formatTimestampFull(log.createdAt)}
                              </span>
                            </div>

                            {/* Confidence */}
                            {log.confidence !== undefined &&
                              log.confidence !== null && (
                                <div className="mb-2">
                                  <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-mono tabular-nums text-gray-700">
                                    Confidence:{" "}
                                    {(log.confidence * 100).toFixed(0)}%
                                  </span>
                                </div>
                              )}

                            {/* Reasoning */}
                            <p className="text-xs text-gray-600 leading-relaxed">
                              {truncateText(log.reasoning, 200)}
                            </p>

                            {/* Footer: model name + account value */}
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                              <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">
                                {log.modelName}
                              </span>
                              <span className="text-[10px] font-mono tabular-nums text-gray-400">
                                Account: {formatCurrency(log.accountValue)}
                              </span>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
