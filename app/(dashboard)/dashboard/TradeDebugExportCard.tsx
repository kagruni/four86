"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { format, endOfDay, startOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import { api } from "@/convex/_generated/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CalendarIcon, Copy, Download, Loader2 } from "lucide-react";

const DECISION_SCOPE_OPTIONS = [
  { value: "tradesOnly", label: "Trades only" },
  { value: "all", label: "All decisions" },
] as const;
const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 1000;

type DecisionScope = (typeof DECISION_SCOPE_OPTIONS)[number]["value"];
type DateFilterMode = "today" | "single" | "range";

function createTodayRange(): DateRange {
  const today = new Date();
  return {
    from: today,
    to: today,
  };
}

function getSafeRange(range: DateRange | undefined): { from: Date; to: Date } {
  const fallback = createTodayRange();
  return {
    from: range?.from ?? fallback.from!,
    to: range?.to ?? range?.from ?? fallback.to!,
  };
}

function formatDateFilterLabel(mode: DateFilterMode, range: DateRange | undefined) {
  if (mode === "today") {
    return "Today";
  }

  if (!range?.from) {
    return mode === "single" ? "Select date" : "Select range";
  }

  if (mode === "single" || !range.to) {
    return format(range.from, "PPP");
  }

  return `${format(range.from, "PPP")} - ${format(range.to, "PPP")}`;
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function truncateText(value: string | null | undefined, limit = 160) {
  if (!value) {
    return "No reasoning stored";
  }

  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function escapeCsv(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = typeof value === "string" ? value : JSON.stringify(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function buildCsv(rows: any[]) {
  const header = [
    "record_type",
    "activity_at",
    "executed_at",
    "decision_logged_at",
    "decision",
    "symbol",
    "action",
    "side",
    "price",
    "size_usd",
    "size_in_coins",
    "trade_value_usd",
    "leverage",
    "pnl",
    "pnl_pct",
    "trade_ai_model",
    "trade_ai_reasoning",
    "trade_confidence",
    "matched_ai_log_at",
    "matched_ai_decision",
    "matched_ai_model",
    "matched_ai_reasoning",
    "matched_ai_confidence",
    "match_delta_ms",
    "selection_mode",
    "selected_candidate_id",
    "deterministic_context_stored",
    "deterministic_score_floor",
    "deterministic_forced_hold",
    "deterministic_hold_reason",
    "top_candidates",
    "blocked_candidate_count",
    "close_candidates",
    "selected_candidate",
    "execution_result",
  ];

  const body = rows.map((row) => {
    const trade = row.trade;
    const aiLog = row.aiLog;
    const deterministic = row.deterministicFilters;

    return [
      row.recordType ?? null,
      row.activityAt ?? aiLog?.createdAt ?? trade?.executedAt ?? null,
      trade?.executedAt ?? null,
      aiLog?.createdAt ?? null,
      aiLog?.decision ?? null,
      trade?.symbol ??
        aiLog?.parsedResponse?.symbol ??
        aiLog?.parsedResponse?.close_symbol ??
        null,
      trade?.action ?? null,
      trade?.side ?? null,
      trade?.price ?? null,
      trade?.size ?? null,
      trade?.sizeInCoins ?? null,
      trade?.tradeValueUsd ?? null,
      trade?.leverage ?? null,
      trade?.pnl ?? null,
      trade?.pnlPct ?? null,
      trade?.aiModel ?? null,
      trade?.aiReasoning ?? null,
      trade?.confidence ?? null,
      aiLog?.createdAt ?? null,
      aiLog?.decision ?? null,
      aiLog?.modelName ?? null,
      aiLog?.reasoning ?? null,
      aiLog?.confidence ?? null,
      aiLog?.match?.deltaMs ?? null,
      aiLog?.selectionMode ?? null,
      aiLog?.selectedCandidateId ?? null,
      deterministic?.stored ?? false,
      deterministic?.scoreFloor ?? null,
      deterministic?.forcedHold ?? null,
      deterministic?.holdReason ?? null,
      deterministic?.topCandidates ?? [],
      deterministic?.blockedCandidates?.length ?? 0,
      deterministic?.closeCandidates ?? [],
      deterministic?.selectedCandidate ?? null,
      aiLog?.executionResult ?? null,
    ].map(escapeCsv).join(",");
  });

  return [header.join(","), ...body].join("\n");
}

function downloadFile(filename: string, contents: string, contentType: string) {
  const blob = new Blob([contents], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function TradeDebugExportCard({ userId }: { userId: string }) {
  const [limitInput, setLimitInput] = useState(String(DEFAULT_LIMIT));
  const [decisionScope, setDecisionScope] = useState<DecisionScope>("tradesOnly");
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>("today");
  const [selectedRange, setSelectedRange] = useState<DateRange | undefined>(() => createTodayRange());
  const { toast } = useToast();
  const limit = useMemo(() => {
    const parsed = Number.parseInt(limitInput, 10);
    if (Number.isNaN(parsed)) {
      return DEFAULT_LIMIT;
    }

    return Math.min(Math.max(parsed, MIN_LIMIT), MAX_LIMIT);
  }, [limitInput]);
  const dateBounds = useMemo(() => {
    const activeRange =
      dateFilterMode === "today"
        ? getSafeRange(createTodayRange())
        : selectedRange?.from
          ? getSafeRange(selectedRange)
          : getSafeRange(undefined);
    const fromDate = activeRange.from;
    const toDate = activeRange.to;

    return {
      since: startOfDay(fromDate).getTime(),
      until: endOfDay(toDate).getTime(),
      exportLabel: formatDateFilterLabel(dateFilterMode, activeRange),
    };
  }, [dateFilterMode, selectedRange]);
  const rows = useQuery(
    api.queries.getRecentTradeDebugExport,
    userId
      ? {
          userId,
          limit,
          decisionScope,
          since: dateBounds.since,
          until: dateBounds.until,
        }
      : "skip"
  );

  const matchedAiCount = rows?.filter((row) => row.aiLog).length ?? 0;
  const deterministicCount =
    rows?.filter((row) => row.deterministicFilters?.stored).length ?? 0;
  const holdCount = rows?.filter((row) => row.aiLog?.decision === "HOLD").length ?? 0;
  const tradeRowCount = rows?.filter((row) => row.trade).length ?? 0;

  const handleExportJson = () => {
    if (!rows) {
      return;
    }

    downloadFile(
      `trade-debug-export-${new Date().toISOString()}.json`,
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          limit,
          decisionScope,
          dateFilterMode,
          dateRange: {
            since: dateBounds.since,
            until: dateBounds.until,
            label: dateBounds.exportLabel,
          },
          records: rows,
        },
        null,
        2
      ),
      "application/json"
    );
  };

  const handleExportCsv = () => {
    if (!rows) {
      return;
    }

    downloadFile(
      `trade-debug-export-${new Date().toISOString()}.csv`,
      buildCsv(rows),
      "text/csv;charset=utf-8"
    );
  };

  const handleCopyJson = async () => {
    if (!rows) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            limit,
            decisionScope,
            dateFilterMode,
            dateRange: {
              since: dateBounds.since,
              until: dateBounds.until,
              label: dateBounds.exportLabel,
            },
            records: rows,
          },
          null,
          2
        )
      );
      toast({
        title: "Copied",
        description: "Trade debug export copied as JSON.",
      });
    } catch (error) {
      console.log(
        "Failed to copy trade debug export:",
        error instanceof Error ? error.message : String(error)
      );
      toast({
        title: "Error",
        description: "Could not copy JSON export.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="border border-border overflow-hidden">
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-foreground">Trade Debug Export</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Export recent trading decisions with AI reasoning, including optional HOLD-only evaluations.
            </p>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex flex-wrap items-center gap-2">
              {DECISION_SCOPE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant={decisionScope === option.value ? "default" : "outline"}
                  size="sm"
                  className={
                    decisionScope === option.value
                      ? "bg-foreground text-background hover:bg-foreground/80"
                      : "border-border text-foreground"
                  }
                  onClick={() => setDecisionScope(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {([
                { value: "today", label: "Today" },
                { value: "single", label: "Single date" },
                { value: "range", label: "Date range" },
              ] as const).map((option) => (
                <Button
                  key={option.value}
                  variant={dateFilterMode === option.value ? "default" : "outline"}
                  size="sm"
                  className={
                    dateFilterMode === option.value
                      ? "bg-foreground text-background hover:bg-foreground/80"
                      : "border-border text-foreground"
                  }
                  onClick={() => {
                    setDateFilterMode(option.value);
                    if (option.value === "today") {
                      setSelectedRange(createTodayRange());
                    }
                  }}
                >
                  {option.label}
                </Button>
              ))}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-w-[180px] justify-start border-border text-left font-mono text-foreground"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                    {formatDateFilterLabel(dateFilterMode, selectedRange)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  {dateFilterMode === "range" ? (
                    <Calendar
                      mode="range"
                      selected={selectedRange}
                      onSelect={setSelectedRange}
                      disabled={(date) => date > new Date()}
                      defaultMonth={selectedRange?.from ?? new Date()}
                      numberOfMonths={2}
                    />
                  ) : (
                    <Calendar
                      mode="single"
                      selected={selectedRange?.from}
                      onSelect={(value) => {
                        if (!value) {
                          return;
                        }

                        if (dateFilterMode === "today") {
                          setDateFilterMode("single");
                        }

                        setSelectedRange({ from: value, to: value });
                      }}
                      disabled={(date) => date > new Date()}
                      defaultMonth={selectedRange?.from ?? new Date()}
                    />
                  )}
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-foreground">Window</Label>
                <Badge variant="outline" className="border-foreground text-foreground">
                  {dateBounds.exportLabel}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="trade-debug-limit" className="text-sm text-foreground">
                    Records
                  </Label>
                  <Input
                    id="trade-debug-limit"
                    type="number"
                    inputMode="numeric"
                    min={MIN_LIMIT}
                    max={MAX_LIMIT}
                    step={1}
                    value={limitInput}
                    onChange={(event) => setLimitInput(event.target.value)}
                    onBlur={() => setLimitInput(String(limit))}
                    className="h-9 w-24 border-border font-mono text-sm text-foreground"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-border text-foreground"
                  onClick={handleCopyJson}
                  disabled={!rows}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-border text-foreground"
                  onClick={handleExportCsv}
                  disabled={!rows}
                >
                  <Download className="mr-2 h-4 w-4" />
                  CSV
                </Button>
                <Button
                  size="sm"
                  className="bg-foreground text-background hover:bg-foreground/80"
                  onClick={handleExportJson}
                  disabled={!rows}
                >
                  <Download className="mr-2 h-4 w-4" />
                  JSON
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows === undefined ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading recent trade debug data...
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm font-mono text-muted-foreground">
            No matching debug activity for the selected filters
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-foreground text-foreground">
                {rows.length} records
              </Badge>
              <Badge variant="outline" className="border-foreground text-foreground">
                {matchedAiCount} linked AI logs
              </Badge>
              <Badge variant="outline" className="border-foreground text-foreground">
                {deterministicCount} with deterministic context
              </Badge>
              <Badge variant="outline" className="border-foreground text-foreground">
                {tradeRowCount} trade-backed
              </Badge>
              {decisionScope === "all" && (
                <Badge variant="outline" className="border-foreground text-foreground">
                  {holdCount} HOLD decisions
                </Badge>
              )}
            </div>

            <ScrollArea className="h-[420px]">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-muted">
                      <TableHead className="text-foreground font-semibold">Time</TableHead>
                      <TableHead className="text-foreground font-semibold">Trade</TableHead>
                      <TableHead className="text-foreground font-semibold">AI Reasoning</TableHead>
                      <TableHead className="text-foreground font-semibold">Deterministic</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const trade = row.trade;
                      const aiLog = row.aiLog;
                      const deterministic = row.deterministicFilters;
                      const reasoningPreview =
                        aiLog?.reasoning && !aiLog.reasoning.trim().startsWith("{")
                          ? aiLog.reasoning
                          : trade?.aiReasoning;
                      const timeLabel = trade?.executedAt ?? aiLog?.createdAt ?? row.activityAt;

                      return (
                        <TableRow
                          key={trade?._id ?? aiLog?._id ?? `${row.recordType}-${row.activityAt}`}
                          className="border-border even:bg-muted/40 hover:bg-muted/30 align-top"
                        >
                          <TableCell className="min-w-[120px] text-xs text-muted-foreground">
                            <div>{formatTimestamp(timeLabel)}</div>
                            {trade?.fillTime && (
                              <div className="mt-1 font-mono text-[11px]">
                                Fill: {formatTimestamp(trade.fillTime)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="min-w-[240px]">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="border-foreground text-foreground">
                                {trade?.action ?? aiLog?.decision ?? row.recordType}
                              </Badge>
                              <span className="font-mono font-semibold text-foreground">
                                {trade?.symbol ?? aiLog?.parsedResponse?.symbol ?? aiLog?.parsedResponse?.close_symbol ?? "-"}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {trade?.side ?? (aiLog?.decision === "OPEN_SHORT" ? "SHORT" : aiLog?.decision === "OPEN_LONG" ? "LONG" : "No fill")}
                              </span>
                            </div>
                            <div className="mt-2 space-y-1 text-xs font-mono text-muted-foreground">
                              {trade ? (
                                <>
                                  <div>
                                    {formatCurrency(trade.size)} @ {formatCurrency(trade.price)}
                                  </div>
                                  <div>
                                    Lev {trade.leverage}x
                                    {trade.pnl !== null ? ` • PnL ${formatCurrency(trade.pnl)} (${formatPercent(trade.pnlPct)})` : ""}
                                  </div>
                                  <div>
                                    Model {trade.aiModel}
                                    {typeof trade.confidence === "number"
                                      ? ` • ${(trade.confidence * 100).toFixed(0)}%`
                                      : ""}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div>No executed trade linked</div>
                                  <div>
                                    Decision {aiLog?.decision ?? "-"}
                                    {typeof aiLog?.confidence === "number"
                                      ? ` • ${(aiLog.confidence * 100).toFixed(0)}%`
                                      : ""}
                                  </div>
                                  <div>Model {aiLog?.modelName ?? "-"}</div>
                                </>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[320px]">
                            <p className="text-sm text-foreground leading-relaxed">
                              {truncateText(reasoningPreview)}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              {aiLog ? (
                                <>
                                  <Badge variant="outline" className="border-foreground text-foreground">
                                    {aiLog.decision}
                                  </Badge>
                                  <span className="font-mono text-muted-foreground">
                                    {aiLog.modelName}
                                  </span>
                                  {typeof aiLog.confidence === "number" && (
                                    <span className="font-mono text-muted-foreground">
                                      {(aiLog.confidence * 100).toFixed(0)}%
                                    </span>
                                  )}
                                  {aiLog.match?.deltaMs !== null && aiLog.match?.deltaMs !== undefined && (
                                    <span className="font-mono text-muted-foreground">
                                      {Math.round(aiLog.match.deltaMs / 1000)}s offset
                                    </span>
                                  )}
                                  {!trade && (
                                    <span className="font-mono text-muted-foreground">
                                      No fill recorded
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="font-mono text-muted-foreground">
                                  No matching AI log found. Export still includes trade-level reasoning.
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[300px]">
                            {deterministic ? (
                              <div className="space-y-2 text-xs">
                                <div className="flex flex-wrap gap-2">
                                  <Badge variant="outline" className="border-foreground text-foreground">
                                    {aiLog?.selectionMode ?? "stored"}
                                  </Badge>
                                  <Badge variant="outline" className="border-foreground text-foreground">
                                    {deterministic.topCandidates?.length ?? 0} top
                                  </Badge>
                                  <Badge variant="outline" className="border-foreground text-foreground">
                                    {deterministic.blockedCandidates?.length ?? 0} blocked
                                  </Badge>
                                </div>
                                <div className="font-mono text-muted-foreground">
                                  Floor {deterministic.scoreFloor ?? "-"}
                                  {typeof deterministic.forcedHold === "boolean"
                                    ? ` • Forced hold ${deterministic.forcedHold ? "yes" : "no"}`
                                    : ""}
                                  {typeof deterministic.belowScoreFloor === "boolean"
                                    ? ` • Below floor ${deterministic.belowScoreFloor ? "yes" : "no"}`
                                    : ""}
                                </div>
                                {typeof deterministic.scoreGapToFloor === "number" &&
                                deterministic.scoreGapToFloor > 0 ? (
                                  <div className="font-mono text-muted-foreground">
                                    Gap to floor {deterministic.scoreGapToFloor.toFixed(1)}
                                  </div>
                                ) : null}
                                {deterministic.selectedCandidate ? (
                                  <div className="rounded border border-border bg-muted/50 p-2 font-mono text-[11px] text-foreground">
                                    Selected: {deterministic.selectedCandidate.id} • Score{" "}
                                    {deterministic.selectedCandidate.score?.toFixed?.(1) ?? "-"}
                                  </div>
                                ) : deterministic.holdReason ? (
                                  <div className="rounded border border-border bg-muted/50 p-2 text-[11px] text-foreground">
                                    {truncateText(deterministic.holdReason, 120)}
                                  </div>
                                ) : (
                                  <div className="font-mono text-muted-foreground">
                                    Stored, but no selected candidate on this trade.
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">
                                No deterministic shortlist stored for this record.
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
          </>
        )}
      </CardContent>
    </Card>
  );
}
