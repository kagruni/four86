"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const BacktestChart = dynamic(() => import("./BacktestChart"), { ssr: false });
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Play,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Square,
  Trash2,
} from "lucide-react";

const SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];
const MODELS = [
  { value: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { value: "openai/gpt-5", label: "GPT-5" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  { value: "openai/gpt-4.1", label: "GPT-4.1" },
  { value: "google/gemini-3-pro", label: "Gemini 3 Pro" },
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "deepseek/deepseek-chat-v3.1", label: "DeepSeek Chat V3.1" },
  { value: "deepseek/deepseek-v3.2-speciale", label: "DeepSeek V3.2 Speciale" },
  { value: "deepseek/deepseek-r1", label: "DeepSeek R1" },
  { value: "x-ai/grok-4.1-fast", label: "Grok 4.1 Fast" },
  { value: "x-ai/grok-4-fast", label: "Grok 4 Fast" },
  { value: "x-ai/grok-code-fast-1", label: "Grok Code Fast 1" },
  { value: "z-ai/glm-4.7", label: "GLM-4.7" },
  { value: "z-ai/glm-4.6", label: "GLM-4.6" },
  { value: "moonshotai/kimi-k2.5", label: "Kimi K2.5" },
  { value: "moonshotai/kimi-k2-thinking", label: "Kimi K2 Thinking" },
  { value: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick" },
  { value: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
];
const PROMPT_MODES = [
  { value: "alpha_arena", label: "Alpha Arena" },
  { value: "compact", label: "Compact" },
  { value: "detailed", label: "Detailed" },
];

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function defaultStartDate() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split("T")[0];
}

function defaultEndDate() {
  return new Date().toISOString().split("T")[0];
}

export default function BacktestPage() {
  const { user } = useUser();
  const userId = user?.id || "";

  // Form state
  const [symbol, setSymbol] = useState("BTC");
  const [startDate, setStartDate] = useState(defaultStartDate());
  const [endDate, setEndDate] = useState(defaultEndDate());
  const [modelName, setModelName] = useState(MODELS[0].value);
  const [promptMode, setPromptMode] = useState("alpha_arena");
  const [initialCapital, setInitialCapital] = useState("1000");
  const [maxLeverage, setMaxLeverage] = useState("10");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  // Data
  const backtestRuns = useQuery(
    api.backtesting.backtestActions.getBacktestRuns,
    userId ? { userId } : "skip"
  );
  const startBacktest = useAction(
    api.backtesting.backtestActions.startBacktest
  );
  const cancelBacktest = useMutation(
    api.backtesting.backtestActions.cancelBacktest
  );
  const deleteBacktest = useMutation(
    api.backtesting.backtestActions.deleteBacktest
  );

  // Get detailed results for expanded row
  const expandedResults = useQuery(
    api.backtesting.backtestActions.getBacktestResults,
    expandedRunId
      ? { runId: expandedRunId as Id<"backtestRuns"> }
      : "skip"
  );

  const handleStartBacktest = async () => {
    if (!userId) return;
    setIsSubmitting(true);
    try {
      await startBacktest({
        userId,
        symbol,
        startDate: new Date(startDate).getTime(),
        endDate: new Date(endDate).getTime(),
        modelName,
        tradingPromptMode: promptMode,
        initialCapital: parseFloat(initialCapital),
        maxLeverage: parseFloat(maxLeverage),
      });
    } catch (err) {
      console.error("Failed to start backtest:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleExpand = (runId: string) => {
    setExpandedRunId(expandedRunId === runId ? null : runId);
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-900" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold text-gray-900">Backtesting</h1>

      {/* Configuration Form */}
      <Card className="border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <CardHeader>
          <CardTitle className="text-lg text-gray-900">
            New Backtest
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {/* Symbol */}
            <div className="space-y-1.5">
              <Label className="text-sm text-gray-600">Symbol</Label>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SYMBOLS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Start Date */}
            <div className="space-y-1.5">
              <Label className="text-sm text-gray-600">Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="text-gray-900"
              />
            </div>

            {/* End Date */}
            <div className="space-y-1.5">
              <Label className="text-sm text-gray-600">End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="text-gray-900"
              />
            </div>

            {/* Model */}
            <div className="space-y-1.5">
              <Label className="text-sm text-gray-600">AI Model</Label>
              <Select value={modelName} onValueChange={setModelName}>
                <SelectTrigger className="text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Prompt Mode */}
            <div className="space-y-1.5">
              <Label className="text-sm text-gray-600">Prompt Mode</Label>
              <Select value={promptMode} onValueChange={setPromptMode}>
                <SelectTrigger className="text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROMPT_MODES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Initial Capital */}
            <div className="space-y-1.5">
              <Label className="text-sm text-gray-600">
                Initial Capital ($)
              </Label>
              <Input
                type="number"
                value={initialCapital}
                onChange={(e) => setInitialCapital(e.target.value)}
                className="text-gray-900 placeholder:text-gray-400 font-mono"
                placeholder="1000"
                min="100"
              />
            </div>

            {/* Max Leverage */}
            <div className="space-y-1.5">
              <Label className="text-sm text-gray-600">Max Leverage</Label>
              <Input
                type="number"
                value={maxLeverage}
                onChange={(e) => setMaxLeverage(e.target.value)}
                className="text-gray-900 placeholder:text-gray-400 font-mono"
                placeholder="10"
                min="1"
                max="50"
              />
            </div>

            {/* Submit */}
            <div className="flex items-end">
              <Button
                onClick={handleStartBacktest}
                disabled={isSubmitting}
                className="w-full bg-gray-900 text-white hover:bg-gray-800"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {isSubmitting ? "Starting..." : "Run Backtest"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Table */}
      <Card className="border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <CardHeader>
          <CardTitle className="text-lg text-gray-900">
            Backtest History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!backtestRuns ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-900" />
            </div>
          ) : backtestRuns.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">
              No backtests yet. Configure and run one above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                  <TableHead className="text-right">Win Rate</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Sharpe</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backtestRuns.map((run: any) => {
                  const isExpanded = expandedRunId === run._id;
                  return (
                    <BacktestRow
                      key={run._id}
                      run={run}
                      isExpanded={isExpanded}
                      testnet={true}
                      onToggle={() => toggleExpand(run._id)}
                      expandedResults={
                        isExpanded ? expandedResults : undefined
                      }
                      onCancel={async () => {
                        await cancelBacktest({ runId: run._id });
                      }}
                      onDelete={async () => {
                        if (expandedRunId === run._id) setExpandedRunId(null);
                        await deleteBacktest({ runId: run._id });
                      }}
                    />
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BacktestRow({
  run,
  isExpanded,
  testnet,
  onToggle,
  expandedResults,
  onCancel,
  onDelete,
}: {
  run: any;
  isExpanded: boolean;
  testnet: boolean;
  onToggle: () => void;
  expandedResults: any;
  onCancel: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const isRunning = run.status === "running";
  const isCancelled = run.status === "cancelled";
  const isFailed = run.status === "failed";
  const pnl = run.totalPnl ?? 0;
  const pnlPct = run.totalPnlPct ?? 0;
  const isPositive = pnl >= 0;

  // Extract short model name
  const modelShort = run.modelName.split("/").pop() || run.modelName;

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-gray-50"
        onClick={onToggle}
      >
        <TableCell>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </TableCell>
        <TableCell>
          {isRunning ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
              <Loader2 className="h-3 w-3 animate-spin" />
              Running{run.progressPct != null ? ` ${run.progressPct}%` : ""}
            </span>
          ) : isCancelled ? (
            <span className="text-xs text-gray-500">Cancelled</span>
          ) : isFailed ? (
            <span className="text-xs text-red-600">Failed</span>
          ) : (
            <span className="text-xs text-gray-900">Done</span>
          )}
        </TableCell>
        <TableCell className="font-mono text-sm font-medium text-gray-900">
          {run.symbol}
        </TableCell>
        <TableCell className="text-xs text-gray-600">
          {formatDate(run.startDate)} - {formatDate(run.endDate)}
        </TableCell>
        <TableCell className="text-xs text-gray-600">{modelShort}</TableCell>
        <TableCell className="text-right font-mono text-sm tabular-nums">
          {isRunning ? (
            run.currentCapital != null ? (
              <span className={run.currentCapital >= run.initialCapital ? "text-gray-900" : "text-red-600"}>
                ${run.currentCapital.toFixed(2)}
                <span className="ml-1 text-xs text-gray-500">
                  ({run.currentCapital >= run.initialCapital ? "+" : ""}
                  {((run.currentCapital - run.initialCapital) / run.initialCapital * 100).toFixed(1)}%)
                </span>
              </span>
            ) : (
              <span className="text-xs text-gray-400">calculating...</span>
            )
          ) : (
            <span className={isPositive ? "text-gray-900" : "text-red-600"}>
              {isPositive ? "+" : ""}${pnl.toFixed(2)}{" "}
              <span className="text-xs text-gray-500">
                ({isPositive ? "+" : ""}
                {pnlPct.toFixed(1)}%)
              </span>
            </span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono text-sm tabular-nums text-gray-900">
          {isRunning ? "-" : `${(run.winRate ?? 0).toFixed(1)}%`}
        </TableCell>
        <TableCell className="text-right font-mono text-sm tabular-nums text-gray-900">
          {isRunning ? (
            run.currentTrades != null ? (
              <span className="text-gray-600">{run.currentTrades}</span>
            ) : "-"
          ) : run.totalTrades ?? 0}
        </TableCell>
        <TableCell className="text-right font-mono text-sm tabular-nums text-gray-900">
          {isRunning ? "-" : (run.sharpeRatio ?? 0).toFixed(2)}
        </TableCell>
        <TableCell className="text-right text-xs text-gray-500">
          {run.durationMs ? formatDuration(run.durationMs) : "-"}
        </TableCell>
        <TableCell>
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {isRunning && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancel}
                className="h-7 w-7 p-0 text-gray-500 hover:text-gray-900"
                title="Cancel backtest"
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            )}
            {!isRunning && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDelete}
                className="h-7 w-7 p-0 text-gray-400 hover:text-red-600"
                title="Delete backtest"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded trade details */}
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={11} className="bg-gray-50 p-0">
            <TradeDetails
              run={run}
              results={expandedResults}
              testnet={testnet}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TradeRow({ trade }: { trade: any }) {
  const [expanded, setExpanded] = useState(false);
  const tradePnl = trade.pnl ?? 0;
  const isPos = tradePnl >= 0;
  const reasoning = trade.reasoning || "-";
  const isLong = reasoning.length > 60;

  return (
    <>
      <TableRow
        className={isLong ? "cursor-pointer hover:bg-gray-50/50" : ""}
        onClick={() => isLong && setExpanded(!expanded)}
      >
        <TableCell className="text-xs">
          <span className="inline-flex items-center gap-1">
            {trade.side === "LONG" ? (
              <TrendingUp className="h-3 w-3 text-gray-700" />
            ) : (
              <TrendingDown className="h-3 w-3 text-gray-500" />
            )}
            {trade.side}
          </span>
        </TableCell>
        <TableCell className="font-mono text-xs tabular-nums">
          ${trade.entryPrice?.toFixed(2)}
        </TableCell>
        <TableCell className="font-mono text-xs tabular-nums">
          ${trade.exitPrice?.toFixed(2)}
        </TableCell>
        <TableCell className="font-mono text-xs tabular-nums">
          ${trade.size?.toFixed(0)}
        </TableCell>
        <TableCell className="font-mono text-xs tabular-nums">
          {trade.leverage}x
        </TableCell>
        <TableCell
          className={`text-right font-mono text-xs tabular-nums ${isPos ? "text-gray-900" : "text-red-600"}`}
        >
          {isPos ? "+" : ""}${tradePnl.toFixed(2)}
        </TableCell>
        <TableCell className="text-xs text-gray-600">
          {trade.exitReason?.replace("_", " ")}
        </TableCell>
        <TableCell className="text-xs text-gray-500">
          {expanded ? (
            <span className="inline-flex items-center gap-1 text-gray-600">
              <ChevronUp className="h-3 w-3 flex-shrink-0" />
              collapse
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <span className="max-w-[200px] truncate inline-block align-bottom">
                {reasoning}
              </span>
              {isLong && (
                <ChevronDown className="h-3 w-3 flex-shrink-0 text-gray-400" />
              )}
            </span>
          )}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-gray-50/70 px-4 py-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-700">AI Reasoning</p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-600">
                {reasoning}
              </p>
              {trade.confidence != null && (
                <p className="pt-1 text-xs text-gray-400">
                  Confidence: {(trade.confidence * 100).toFixed(0)}%
                  {trade.entryTime && (
                    <> &middot; Entry: {new Date(trade.entryTime).toLocaleString()}</>
                  )}
                  {trade.exitTime && (
                    <> &middot; Exit: {new Date(trade.exitTime).toLocaleString()}</>
                  )}
                </p>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TradeDetails({ run, results, testnet }: { run: any; results: any; testnet: boolean }) {
  if (!results) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-gray-900" />
      </div>
    );
  }

  if (run.status === "failed") {
    return (
      <div className="p-4 text-sm text-red-600">
        Error: {run.error || "Unknown error"}
      </div>
    );
  }

  const trades = results.trades || [];
  const closeTrades = trades.filter((t: any) => t.action === "CLOSE");

  if (closeTrades.length === 0) {
    return (
      <p className="p-4 text-sm text-gray-500">No completed trades.</p>
    );
  }

  return (
    <div className="p-4">
      {/* Summary stats */}
      <div className="mb-4 grid grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-gray-500">Max Drawdown</p>
          <p className="font-mono text-sm tabular-nums text-gray-900">
            ${(run.maxDrawdown ?? 0).toFixed(2)}{" "}
            <span className="text-xs text-gray-500">
              ({(run.maxDrawdownPct ?? 0).toFixed(1)}%)
            </span>
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Final Capital</p>
          <p className="font-mono text-sm tabular-nums text-gray-900">
            ${(run.finalCapital ?? run.initialCapital).toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Initial Capital</p>
          <p className="font-mono text-sm tabular-nums text-gray-900">
            ${run.initialCapital.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Prompt Mode</p>
          <p className="text-sm text-gray-900">{run.tradingPromptMode}</p>
        </div>
      </div>

      {/* Price chart with trade markers */}
      {run.status === "completed" && (
        <BacktestChart
          symbol={run.symbol}
          startDate={run.startDate}
          endDate={run.endDate}
          trades={closeTrades}
          testnet={testnet}
        />
      )}

      {/* Trade list */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Side</TableHead>
            <TableHead className="text-xs">Entry</TableHead>
            <TableHead className="text-xs">Exit</TableHead>
            <TableHead className="text-xs">Size</TableHead>
            <TableHead className="text-xs">Lev</TableHead>
            <TableHead className="text-xs text-right">P&L</TableHead>
            <TableHead className="text-xs">Exit Reason</TableHead>
            <TableHead className="text-xs">Reasoning</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {closeTrades.map((trade: any, i: number) => (
            <TradeRow key={i} trade={trade} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
