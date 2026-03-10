"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useUser } from "@clerk/nextjs";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { DEFAULT_HYBRID_SELECTION_RULES } from "@/convex/trading/hybridSelectionConfig";

const BacktestChart = dynamic(() => import("./BacktestChart"), { ssr: false });
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { endOfDay, format, startOfDay } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CalendarIcon,
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
  return d;
}

function defaultEndDate() {
  return new Date();
}

export default function BacktestPage() {
  const { user } = useUser();
  const userId = user?.id || "";

  // Form state
  const [startDate, setStartDate] = useState<Date>(defaultStartDate());
  const [endDate, setEndDate] = useState<Date>(defaultEndDate());
  const [disableHybridSelection, setDisableHybridSelection] = useState(false);
  const [hybridScoreFloorOverride, setHybridScoreFloorOverride] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  // Data
  const botConfig = useQuery(
    api.queries.getBotConfig,
    userId ? { userId } : "skip"
  );
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

  const configuredSymbols =
    botConfig?.symbols && botConfig.symbols.length > 0
      ? botConfig.symbols
      : SYMBOLS;
  const effectiveModelName = botConfig?.modelName ?? "Not configured";
  const effectivePromptMode = botConfig?.tradingPromptMode ?? "alpha_arena";
  const effectiveInitialCapital =
    botConfig?.currentCapital ?? botConfig?.startingCapital ?? 0;
  const effectiveMaxLeverage = botConfig?.maxLeverage ?? 0;
  const effectiveTradingIntervalMinutes = botConfig?.tradingIntervalMinutes ?? 5;
  const effectiveHybridScoreFloor =
    botConfig?.hybridScoreFloor ??
    DEFAULT_HYBRID_SELECTION_RULES.hybridScoreFloor;
  const configuredSymbolsLabel = configuredSymbols.join(", ");

  const handleStartBacktest = async () => {
    await handleStartBacktestWithOverrides({
      disableHybridSelection,
      hybridScoreFloorOverride:
        !disableHybridSelection && hybridScoreFloorOverride.trim() !== ""
          ? Number(hybridScoreFloorOverride)
          : undefined,
    });
  };

  const handleStartBacktestWithOverrides = async ({
    disableHybridSelection,
    hybridScoreFloorOverride,
  }: {
    disableHybridSelection: boolean;
    hybridScoreFloorOverride?: number;
  }) => {
    if (!userId || !botConfig) return;
    setIsSubmitting(true);
    try {
      const normalizedStartDate = startOfDay(startDate).getTime();
      const normalizedEndDate = Math.min(endOfDay(endDate).getTime(), Date.now());

      await startBacktest({
        userId,
        symbol: configuredSymbols[0] ?? "BTC",
        startDate: normalizedStartDate,
        endDate: normalizedEndDate,
        modelName: botConfig.modelName,
        tradingPromptMode: botConfig.tradingPromptMode ?? "alpha_arena",
        initialCapital: effectiveInitialCapital,
        maxLeverage: botConfig.maxLeverage,
        disableHybridSelection,
        hybridScoreFloorOverride,
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
        <Loader2 className="h-8 w-8 animate-spin text-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold text-foreground">Backtesting</h1>

      {/* Configuration Form */}
      <Card className="border border-border">
        <CardHeader>
          <CardTitle className="text-lg text-foreground">
            New Backtest
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {/* Configured Basket */}
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">Live Symbols</Label>
              <div className="flex min-h-10 items-center rounded-md border border-input px-3 text-sm text-foreground">
                {configuredSymbolsLabel}
              </div>
            </div>

            {/* Start Date */}
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-mono text-sm text-foreground"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                    {format(startDate, "PPP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => date && setStartDate(date)}
                    disabled={(date) => date > endDate || date > new Date()}
                    defaultMonth={startDate}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* End Date */}
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-mono text-sm text-foreground"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                    {format(endDate, "PPP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={(date) => date && setEndDate(date)}
                    disabled={(date) => date < startDate || date > new Date()}
                    defaultMonth={endDate}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">
                Live Model
              </Label>
              <div className="flex h-10 items-center rounded-md border border-input px-3 text-sm text-foreground">
                {effectiveModelName}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">
                Live Prompt Mode
              </Label>
              <div className="flex h-10 items-center rounded-md border border-input px-3 text-sm text-foreground">
                {effectivePromptMode}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">
                Live Initial Capital ($)
              </Label>
              <div className="flex h-10 items-center rounded-md border border-input px-3 font-mono text-sm text-foreground">
                {effectiveInitialCapital.toFixed(2)}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">
                Live Max Leverage
              </Label>
              <div className="flex h-10 items-center rounded-md border border-input px-3 font-mono text-sm text-foreground">
                {effectiveMaxLeverage > 0 ? `${effectiveMaxLeverage}x` : "N/A"}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">
                Live Trading Interval
              </Label>
              <div className="flex h-10 items-center rounded-md border border-input px-3 font-mono text-sm text-foreground">
                Every {effectiveTradingIntervalMinutes} minute{effectiveTradingIntervalMinutes === 1 ? "" : "s"}
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-input p-3 sm:col-span-2 lg:col-span-2">
              <Label className="text-sm text-muted-foreground">
                Backtest Overrides
              </Label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={disableHybridSelection}
                  onCheckedChange={(checked) =>
                    setDisableHybridSelection(checked === true)
                  }
                />
                Disable hybrid selection for this run
              </label>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Custom Hybrid Floor
                </Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="100"
                  step="1"
                  value={hybridScoreFloorOverride}
                  onChange={(e) => setHybridScoreFloorOverride(e.target.value)}
                  disabled={disableHybridSelection}
                  placeholder={`${effectiveHybridScoreFloor}`}
                  className="font-mono text-sm"
                />
              </div>
            </div>

            {/* Submit */}
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-2">
              <Button
                onClick={handleStartBacktest}
                disabled={isSubmitting || !botConfig}
                className="w-full bg-foreground text-background hover:bg-foreground/80"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {isSubmitting ? "Starting..." : "Run Backtest"}
              </Button>
              {botConfig?.useHybridSelection && (
                <Button
                  variant="outline"
                  onClick={() =>
                    handleStartBacktestWithOverrides({
                      disableHybridSelection: true,
                    })
                  }
                  disabled={isSubmitting || !botConfig}
                  className="w-full"
                >
                  Run Without Hybrid Gate
                </Button>
              )}
            </div>
          </div>
          {!botConfig && (
            <p className="mt-4 text-sm text-muted-foreground">
              Configure the live bot on the settings page first. Backtests now
              run from the saved bot configuration instead of local form
              overrides.
            </p>
          )}
          {botConfig && (
            <div className="mt-4 space-y-1 text-sm text-muted-foreground">
              {!botConfig.isActive && (
                <p>
                  The live bot is currently inactive. The live trading loop will
                  not place orders until it is turned back on.
                </p>
              )}
              <p>
                Backtest decision checkpoints mirror the saved live cadence of{" "}
                <span className="font-mono text-foreground">
                  every {effectiveTradingIntervalMinutes} minute{effectiveTradingIntervalMinutes === 1 ? "" : "s"}
                </span>
                .
              </p>
              {botConfig.useHybridSelection && (
                <p>
                  Hybrid selection is enabled. The model is only called when the
                  best deterministic setup meets the current score floor of{" "}
                  <span className="font-mono text-foreground">
                    {effectiveHybridScoreFloor}
                  </span>
                  .
                </p>
              )}
              {disableHybridSelection && (
                <p className="text-foreground">
                  This run will ignore hybrid selection and call the model directly.
                </p>
              )}
              {!disableHybridSelection && hybridScoreFloorOverride.trim() !== "" && (
                <p className="text-foreground">
                  This run will use a backtest-only hybrid floor of{" "}
                  <span className="font-mono">
                    {hybridScoreFloorOverride}
                  </span>
                  .
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results Table */}
      <Card className="border border-border">
        <CardHeader>
          <CardTitle className="text-lg text-foreground">
            Backtest History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!backtestRuns ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-foreground" />
            </div>
          ) : backtestRuns.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
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
  const runSymbols =
    Array.isArray(run.symbols) && run.symbols.length > 0
      ? run.symbols
      : [run.symbol];
  const rowDiagnostic =
    !isRunning && (run.totalTrades ?? 0) === 0 && run.diagnosticSummary
      ? run.diagnosticSummary
      : null;
  const runHybridFloor =
    run.effectiveHybridScoreFloor ?? run.hybridScoreFloor ?? null;
  const overrideSummary = run.overrideSummary ?? null;

  // Extract short model name
  const modelShort = run.modelName.split("/").pop() || run.modelName;

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted"
        onClick={onToggle}
      >
        <TableCell>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell>
          {isRunning ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Running{run.progressPct != null ? ` ${run.progressPct}%` : ""}
            </span>
          ) : isCancelled ? (
            <span className="text-xs text-muted-foreground">Cancelled</span>
          ) : isFailed ? (
            <span className="text-xs text-red-600">Failed</span>
          ) : (
            <span className="text-xs text-foreground">Done</span>
          )}
        </TableCell>
        <TableCell className="font-mono text-sm font-medium text-foreground">
          <div>{run.symbol}</div>
          {runSymbols.length > 1 && (
            <div className="mt-0.5 text-xs font-normal text-muted-foreground">
              {runSymbols.join(", ")}
            </div>
          )}
          {rowDiagnostic && (
            <div
              className="mt-0.5 max-w-[320px] truncate text-xs font-normal text-muted-foreground"
              title={rowDiagnostic}
            >
              {rowDiagnostic}
            </div>
          )}
          {overrideSummary && (
            <div className="mt-0.5 text-xs font-normal text-foreground">
              {overrideSummary}
            </div>
          )}
          {!isRunning && run.botIsActive === false && (
            <div className="mt-0.5 text-xs font-normal text-muted-foreground">
              Saved live bot status: inactive (informational only)
            </div>
          )}
          {!isRunning && run.useHybridSelection && runHybridFloor != null && (
            <div className="mt-0.5 text-xs font-normal text-muted-foreground">
              Hybrid floor: {runHybridFloor}
            </div>
          )}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {formatDate(run.startDate)} - {formatDate(run.endDate)}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">{modelShort}</TableCell>
        <TableCell className="text-right font-mono text-sm tabular-nums">
          {isRunning ? (
            run.currentCapital != null ? (
              <span className={run.currentCapital >= run.initialCapital ? "text-foreground" : "text-red-600"}>
                ${run.currentCapital.toFixed(2)}
                <span className="ml-1 text-xs text-muted-foreground">
                  ({run.currentCapital >= run.initialCapital ? "+" : ""}
                  {((run.currentCapital - run.initialCapital) / run.initialCapital * 100).toFixed(1)}%)
                </span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">calculating...</span>
            )
          ) : (
            <span className={isPositive ? "text-foreground" : "text-red-600"}>
              {isPositive ? "+" : ""}${pnl.toFixed(2)}{" "}
              <span className="text-xs text-muted-foreground">
                ({isPositive ? "+" : ""}
                {pnlPct.toFixed(1)}%)
              </span>
            </span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono text-sm tabular-nums text-foreground">
          {isRunning ? "-" : `${(run.winRate ?? 0).toFixed(1)}%`}
        </TableCell>
        <TableCell className="text-right font-mono text-sm tabular-nums text-foreground">
          {isRunning ? (
            run.currentTrades != null ? (
              <span className="text-muted-foreground">{run.currentTrades}</span>
            ) : "-"
          ) : run.totalTrades ?? 0}
        </TableCell>
        <TableCell className="text-right font-mono text-sm tabular-nums text-foreground">
          {isRunning ? "-" : (run.sharpeRatio ?? 0).toFixed(2)}
        </TableCell>
        <TableCell className="text-right text-xs text-muted-foreground">
          {run.durationMs ? formatDuration(run.durationMs) : "-"}
        </TableCell>
        <TableCell>
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {isRunning && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancel}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
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
                className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
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
          <TableCell colSpan={11} className="bg-muted p-0">
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
        className={isLong ? "cursor-pointer hover:bg-muted/50" : ""}
        onClick={() => isLong && setExpanded(!expanded)}
      >
        <TableCell className="font-mono text-xs text-muted-foreground">
          {trade.symbol}
        </TableCell>
        <TableCell className="text-xs">
          <span className="inline-flex items-center gap-1">
            {trade.side === "LONG" ? (
              <TrendingUp className="h-3 w-3 text-gray-700" />
            ) : (
              <TrendingDown className="h-3 w-3 text-muted-foreground" />
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
          className={`text-right font-mono text-xs tabular-nums ${isPos ? "text-foreground" : "text-red-600"}`}
        >
          {isPos ? "+" : ""}${tradePnl.toFixed(2)}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {trade.exitReason?.replace("_", " ")}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {expanded ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <ChevronUp className="h-3 w-3 flex-shrink-0" />
              collapse
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <span className="max-w-[200px] truncate inline-block align-bottom">
                {reasoning}
              </span>
              {isLong && (
                <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              )}
            </span>
          )}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={9} className="bg-muted/70 px-4 py-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">AI Reasoning</p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {reasoning}
              </p>
              {trade.confidence != null && (
                <p className="pt-1 text-xs text-muted-foreground">
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
        <Loader2 className="h-5 w-5 animate-spin text-foreground" />
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
  const closeTradesBySymbol = closeTrades.reduce(
    (acc: Record<string, any[]>, trade: any) => {
      if (!acc[trade.symbol]) {
        acc[trade.symbol] = [];
      }
      acc[trade.symbol].push(trade);
      return acc;
    },
    {}
  );
  const chartSymbols = Object.keys(closeTradesBySymbol);

  if (closeTrades.length === 0) {
    return (
      <div className="space-y-2 p-4">
        <p className="text-sm text-muted-foreground">No completed trades.</p>
        {run.botIsActive === false && (
          <p className="text-sm text-muted-foreground">
            Saved live bot status at run start: inactive. This does not block backtests; it only stops the live trading loop.
          </p>
        )}
        {run.overrideSummary && (
          <p className="text-sm text-foreground">{run.overrideSummary}</p>
        )}
        {run.useHybridSelection && (
          <p className="text-sm text-muted-foreground">
            Hybrid score floor at run start:{" "}
            {run.effectiveHybridScoreFloor ??
              run.hybridScoreFloor ??
              DEFAULT_HYBRID_SELECTION_RULES.hybridScoreFloor}
          </p>
        )}
        {run.diagnosticSummary && (
          <p className="text-sm text-muted-foreground">{run.diagnosticSummary}</p>
        )}
        {run.aiInvocationCount != null && run.forcedHoldCount != null && (
          <p className="text-xs text-muted-foreground">
            AI calls: {run.aiInvocationCount} · Hybrid forced holds: {run.forcedHoldCount}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Summary stats */}
      <div className="mb-4 grid grid-cols-4 gap-4 sm:grid-cols-7">
        <div>
          <p className="text-xs text-muted-foreground">Max Drawdown</p>
          <p className="font-mono text-sm tabular-nums text-foreground">
            ${(run.maxDrawdown ?? 0).toFixed(2)}{" "}
            <span className="text-xs text-muted-foreground">
              ({(run.maxDrawdownPct ?? 0).toFixed(1)}%)
            </span>
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Final Capital</p>
          <p className="font-mono text-sm tabular-nums text-foreground">
            ${(run.finalCapital ?? run.initialCapital).toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Initial Capital</p>
          <p className="font-mono text-sm tabular-nums text-foreground">
            ${run.initialCapital.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Trading Fees</p>
          <p className="font-mono text-sm tabular-nums text-red-600">
            -${(run.totalFees ?? 0).toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Funding Paid</p>
          <p className={`font-mono text-sm tabular-nums ${(run.totalFunding ?? 0) > 0 ? "text-red-600" : "text-foreground"}`}>
            {(run.totalFunding ?? 0) > 0 ? "-" : "+"}${Math.abs(run.totalFunding ?? 0).toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Liquidations</p>
          <p className={`font-mono text-sm tabular-nums ${(run.liquidationCount ?? 0) > 0 ? "text-red-600" : "text-foreground"}`}>
            {run.liquidationCount ?? 0}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Prompt Mode</p>
          <p className="text-sm text-foreground">{run.tradingPromptMode}</p>
        </div>
      </div>

      {/* Price charts with trade markers */}
      {run.status === "completed" && chartSymbols.length > 0 && (
        <div className="space-y-5">
          {chartSymbols.map((symbol) => (
            <div key={symbol}>
              <p className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                {symbol}
              </p>
              <BacktestChart
                symbol={symbol}
                startDate={run.startDate}
                endDate={run.endDate}
                trades={closeTradesBySymbol[symbol]}
                testnet={testnet}
              />
            </div>
          ))}
        </div>
      )}

      {/* Trade list */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Symbol</TableHead>
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
