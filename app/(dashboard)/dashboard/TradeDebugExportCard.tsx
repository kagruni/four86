"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToast } from "@/hooks/use-toast";
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
import { Copy, Download, Loader2 } from "lucide-react";

const LIMIT_OPTIONS = [25, 50, 100];

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
    "executed_at",
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
      trade.executedAt,
      trade.symbol,
      trade.action,
      trade.side,
      trade.price,
      trade.size,
      trade.sizeInCoins,
      trade.tradeValueUsd,
      trade.leverage,
      trade.pnl,
      trade.pnlPct,
      trade.aiModel,
      trade.aiReasoning,
      trade.confidence,
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
  const [limit, setLimit] = useState(50);
  const { toast } = useToast();
  const rows = useQuery(
    api.queries.getRecentTradeDebugExport,
    userId ? { userId, limit } : "skip"
  );

  const matchedAiCount = rows?.filter((row) => row.aiLog).length ?? 0;
  const deterministicCount =
    rows?.filter((row) => row.deterministicFilters?.stored).length ?? 0;

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
              Recent recorded fills with linked AI reasoning and stored deterministic shortlist context.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {LIMIT_OPTIONS.map((option) => (
              <Button
                key={option}
                variant={limit === option ? "default" : "outline"}
                size="sm"
                className={
                  limit === option
                    ? "bg-foreground text-background hover:bg-foreground/80"
                    : "border-border text-foreground"
                }
                onClick={() => setLimit(option)}
              >
                {option}
              </Button>
            ))}
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
      </CardHeader>
      <CardContent className="space-y-4">
        {rows === undefined ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading recent trade debug data...
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm font-mono text-muted-foreground">
            No recorded trades yet
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-foreground text-foreground">
                {rows.length} fills
              </Badge>
              <Badge variant="outline" className="border-foreground text-foreground">
                {matchedAiCount} linked AI logs
              </Badge>
              <Badge variant="outline" className="border-foreground text-foreground">
                {deterministicCount} with deterministic context
              </Badge>
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
                          : trade.aiReasoning;

                      return (
                        <TableRow
                          key={trade._id}
                          className="border-border even:bg-muted/40 hover:bg-muted/30 align-top"
                        >
                          <TableCell className="min-w-[120px] text-xs text-muted-foreground">
                            <div>{formatTimestamp(trade.executedAt)}</div>
                            {trade.fillTime && (
                              <div className="mt-1 font-mono text-[11px]">
                                Fill: {formatTimestamp(trade.fillTime)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="min-w-[240px]">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="border-foreground text-foreground">
                                {trade.action}
                              </Badge>
                              <span className="font-mono font-semibold text-foreground">
                                {trade.symbol}
                              </span>
                              <span className="text-xs text-muted-foreground">{trade.side}</span>
                            </div>
                            <div className="mt-2 space-y-1 text-xs font-mono text-muted-foreground">
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
                                </div>
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
                                No deterministic shortlist stored for this trade.
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
