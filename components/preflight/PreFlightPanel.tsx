"use client";

import { useState, useEffect, useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  RefreshCw,
  Loader2,
  Gauge,
  BarChart3,
  TrendingUp,
  Activity,
  Percent,
  Clock,
  AlertCircle,
  ChevronDown,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (mirroring the backend return shape)
// ---------------------------------------------------------------------------

interface PreFlightMetric {
  name: string;
  value: string;
  numericValue: number;
  status: "green" | "yellow" | "red";
  explanation: string;
  score: number;
}

interface PreFlightResult {
  overallScore: number;
  overallStatus: "green" | "yellow" | "red";
  metrics: {
    fearGreed: PreFlightMetric;
    volumeRatio: PreFlightMetric;
    btcRsi: PreFlightMetric;
    btcMacd: PreFlightMetric;
    fundingRate: PreFlightMetric;
    tradingSession: PreFlightMetric;
  };
  bestTimeHint: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PreFlightPanelProps {
  symbols: string[];
  testnet: boolean;
  botActive?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const METRIC_ICONS: Record<string, React.ElementType> = {
  fearGreed: Gauge,
  volumeRatio: BarChart3,
  btcRsi: TrendingUp,
  btcMacd: Activity,
  fundingRate: Percent,
  tradingSession: Clock,
};

const METRIC_ORDER = [
  "fearGreed",
  "volumeRatio",
  "btcRsi",
  "btcMacd",
  "fundingRate",
  "tradingSession",
] as const;

function statusLabel(status: "green" | "yellow" | "red"): string {
  if (status === "green") return "Good";
  if (status === "yellow") return "Fair";
  return "Poor";
}

function StatusBadge({ status }: { status: "green" | "yellow" | "red" }) {
  const label = statusLabel(status);

  if (status === "green") {
    return <Badge className="bg-gray-900 text-white">{label}</Badge>;
  }
  if (status === "yellow") {
    return (
      <Badge className="bg-gray-200 text-gray-700 border border-gray-300">
        {label}
      </Badge>
    );
  }
  return (
    <Badge className="bg-white text-gray-900 border-2 border-gray-900">
      {label}
    </Badge>
  );
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricRow({ metric, metricKey }: { metric: PreFlightMetric; metricKey: string }) {
  const Icon = METRIC_ICONS[metricKey] ?? Gauge;

  return (
    <div className="flex items-center gap-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-gray-500" />
      <span className="text-sm font-medium text-gray-900 min-w-[110px]">
        {metric.name}
      </span>
      <span className="text-sm font-mono tabular-nums text-gray-700 min-w-[90px]">
        {metric.value}
      </span>
      <StatusBadge status={metric.status} />
      <span className="text-xs text-gray-500 truncate ml-auto">
        {metric.explanation}
      </span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <Card className="border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-52" />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center gap-1">
              <Loader2 className="h-8 w-8 animate-spin text-gray-900" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              {i > 0 && <Separator />}
              <div className="flex items-center gap-3 py-2">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-12 rounded-md" />
                <Skeleton className="h-3 w-32 ml-auto" />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-48" />
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card className="border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <CardHeader>
        <CardTitle className="text-gray-900 font-semibold">
          Pre-Flight Check
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{message}</span>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PreFlightPanel({ symbols, testnet, botActive = false }: PreFlightPanelProps) {
  const runPreFlight = useAction(api.preflight.preflightCheck.runPreFlightCheck);

  const [result, setResult] = useState<PreFlightResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const fetchPreFlight = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await runPreFlight({ symbols, testnet });
      setResult(data as unknown as PreFlightResult);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to run pre-flight check";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [runPreFlight, symbols, testnet]);

  useEffect(() => {
    fetchPreFlight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Loading state ---
  if (isLoading && !result) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <LoadingSkeleton />
      </motion.div>
    );
  }

  // --- Error state (no prior result) ---
  if (error && !result) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <ErrorState message={error} onRetry={fetchPreFlight} />
      </motion.div>
    );
  }

  // --- No data yet ---
  if (!result) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Card className="border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        {/* Collapsible Header — always visible */}
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <div className="flex items-center justify-between">
            {/* Left: title, subtitle & chevron */}
            <div className="flex items-center gap-3">
              <motion.div
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown className="h-5 w-5 text-gray-400" />
              </motion.div>
              <div>
                <CardTitle className="text-gray-900 font-semibold">
                  {botActive ? "Market Status" : "Pre-Flight Check"}
                </CardTitle>
                <p className="text-sm text-gray-500 mt-1">
                  {isOpen ? "Market conditions assessment" : result.bestTimeHint}
                </p>
              </div>
            </div>

            {/* Right: score + refresh */}
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center">
                <span className="text-3xl font-mono font-bold tabular-nums text-gray-900">
                  {result.overallScore}
                </span>
                <StatusBadge status={result.overallStatus} />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  fetchPreFlight();
                }}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* Collapsible Content */}
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" as const }}
              style={{ overflow: "hidden" }}
            >
              <CardContent>
                <div className="space-y-0">
                  {METRIC_ORDER.map((key, idx) => {
                    const metric = result.metrics[key];
                    return (
                      <div key={key}>
                        {idx > 0 && <Separator />}
                        <MetricRow metric={metric} metricKey={key} />
                      </div>
                    );
                  })}
                </div>

                {/* Footer */}
                <Separator className="my-3" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-500" />
                    <span className="text-sm text-gray-500">
                      {result.bestTimeHint}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    Last check: {formatTimestamp(result.timestamp)}
                  </span>
                </div>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}
