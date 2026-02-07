"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Loader2 } from "lucide-react";
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceDot,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BacktestChartProps {
  symbol: string;
  startDate: number;
  endDate: number;
  trades: any[];
  testnet?: boolean;
}

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface TradeMarker {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  side: string;
  pnl: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectInterval(startMs: number, endMs: number): string {
  const durationMs = endMs - startMs;
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (durationMs <= ONE_DAY) return "5m";
  if (durationMs <= 3 * ONE_DAY) return "15m";
  if (durationMs <= 14 * ONE_DAY) return "1h";
  return "4h";
}

function formatXTick(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatYTick(price: number) {
  if (price >= 10000) return `$${(price / 1000).toFixed(1)}k`;
  if (price >= 1) return `$${price.toFixed(0)}`;
  return `$${price.toFixed(4)}`;
}

function fmtPrice(price: number) {
  if (price >= 1000)
    return `$${price.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  return `$${price.toFixed(2)}`;
}

function snapToNearest(target: number, candles: CandleData[]): number {
  if (candles.length === 0) return target;
  let best = candles[0].time;
  let bestDist = Math.abs(target - best);
  for (const c of candles) {
    const dist = Math.abs(target - c.time);
    if (dist < bestDist) {
      bestDist = dist;
      best = c.time;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Custom ReferenceDot shapes
// ---------------------------------------------------------------------------

function LongEntryShape(props: any) {
  const { cx = 0, cy = 0 } = props;
  return (
    <g>
      <polygon
        points={`${cx},${cy - 10} ${cx - 8},${cy + 4} ${cx + 8},${cy + 4}`}
        fill="#000"
        stroke="#fff"
        strokeWidth={1.5}
      />
    </g>
  );
}

function ShortEntryShape(props: any) {
  const { cx = 0, cy = 0 } = props;
  return (
    <g>
      <polygon
        points={`${cx},${cy + 10} ${cx - 8},${cy - 4} ${cx + 8},${cy - 4}`}
        fill="#737373"
        stroke="#fff"
        strokeWidth={1.5}
      />
    </g>
  );
}

function ProfitExitShape(props: any) {
  const { cx = 0, cy = 0 } = props;
  return (
    <circle cx={cx} cy={cy} r={6} fill="#000" stroke="#fff" strokeWidth={1.5} />
  );
}

function LossExitShape(props: any) {
  const { cx = 0, cy = 0 } = props;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill="#dc2626"
        stroke="#fff"
        strokeWidth={1.5}
      />
      <line
        x1={cx - 3}
        y1={cy - 3}
        x2={cx + 3}
        y2={cy + 3}
        stroke="#fff"
        strokeWidth={1.5}
      />
      <line
        x1={cx + 3}
        y1={cy - 3}
        x2={cx - 3}
        y2={cy + 3}
        stroke="#fff"
        strokeWidth={1.5}
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({ active, payload, label, trades }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const time = label as number;
  const d = payload[0]?.payload as CandleData | undefined;

  const nearTrades = (trades || []).filter((t: any) => {
    const threshold = 60 * 60 * 1000;
    return (
      Math.abs((t.entryTime ?? 0) - time) < threshold ||
      Math.abs((t.exitTime ?? 0) - time) < threshold
    );
  });

  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <p className="font-mono text-xs tabular-nums text-gray-500">
        {new Date(time).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
      {d && (
        <div className="mt-0.5 grid grid-cols-4 gap-x-2 font-mono text-xs tabular-nums">
          <span className="text-gray-400">O</span>
          <span className="text-gray-400">H</span>
          <span className="text-gray-400">L</span>
          <span className="text-gray-400">C</span>
          <span className="text-gray-900">{fmtPrice(d.open)}</span>
          <span className="text-gray-900">{fmtPrice(d.high)}</span>
          <span className="text-gray-900">{fmtPrice(d.low)}</span>
          <span className="text-gray-900">{fmtPrice(d.close)}</span>
        </div>
      )}
      {nearTrades.map((t: any, i: number) => (
        <div key={i} className="mt-1 border-t border-gray-100 pt-1">
          <p className="text-xs text-gray-600">
            {t.side}{" "}
            <span
              className={
                (t.pnl ?? 0) >= 0 ? "text-gray-900" : "text-red-600"
              }
            >
              {(t.pnl ?? 0) >= 0 ? "+" : ""}${(t.pnl ?? 0).toFixed(2)}
            </span>
          </p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle button
// ---------------------------------------------------------------------------

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-xs transition-colors ${
        active
          ? "bg-gray-900 text-white"
          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function BacktestChart({
  symbol,
  startDate,
  endDate,
  trades,
  testnet = true,
}: BacktestChartProps) {
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View toggles
  const [showTradeZones, setShowTradeZones] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showHighLow, setShowHighLow] = useState(false);

  const fetchCandlesAction = useAction(
    api.hyperliquid.candles.fetchHistoricalCandles
  );

  const loadCandles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const interval = selectInterval(startDate, endDate);
      const raw = await fetchCandlesAction({
        symbol,
        interval,
        startTime: startDate,
        endTime: endDate,
        testnet,
      });

      if (!raw || (Array.isArray(raw) && raw.length === 0)) {
        setCandles([]);
        setError("No price data available for this period.");
        return;
      }

      setCandles(
        (raw as any[]).map((c: any) => ({
          time: c.t,
          open: c.o,
          high: c.h,
          low: c.l,
          close: c.c,
        }))
      );
    } catch (err) {
      console.error("Failed to load candles:", err);
      setError("Failed to load price data.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, startDate, endDate, testnet]);

  useEffect(() => {
    loadCandles();
  }, [loadCandles]);

  // Build trade markers snapped to candle times
  const tradeMarkers = useMemo<TradeMarker[]>(
    () =>
      trades
        .filter(
          (t: any) =>
            t.entryTime &&
            t.exitTime &&
            t.entryPrice != null &&
            t.exitPrice != null
        )
        .map((t: any) => ({
          entryTime: snapToNearest(t.entryTime, candles),
          exitTime: snapToNearest(t.exitTime, candles),
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          side: t.side,
          pnl: t.pnl ?? 0,
        })),
    [trades, candles]
  );

  // Compute Y-axis domain
  const yDomain = useMemo<[number, number]>(() => {
    if (candles.length === 0) return [0, 1];
    const prices = candles.flatMap((c) => [c.high, c.low]);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pad = (max - min) * 0.06 || max * 0.02;
    return [min - pad, max + pad];
  }, [candles]);

  // ---- Loading ----
  if (loading) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: 360 }}
      >
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">
          Loading price data...
        </span>
      </div>
    );
  }

  // ---- Error / empty ----
  if (error || candles.length === 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: 360 }}
      >
        <p className="text-sm text-gray-400">
          {error || "No price data available."}
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-200 pt-3 pb-2">
      {/* View toggles */}
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-xs text-gray-400 mr-1">View:</span>
        <ToggleBtn
          active={showTradeZones}
          onClick={() => setShowTradeZones((v) => !v)}
        >
          Trade Zones
        </ToggleBtn>
        <ToggleBtn
          active={showLabels}
          onClick={() => setShowLabels((v) => !v)}
        >
          P&L Labels
        </ToggleBtn>
        <ToggleBtn
          active={showHighLow}
          onClick={() => setShowHighLow((v) => !v)}
        >
          High/Low Band
        </ToggleBtn>
      </div>

      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart
          data={candles}
          margin={{ top: 16, right: 48, bottom: 4, left: 12 }}
        >
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4d4d4" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#d4d4d4" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e5e5e5" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#e5e5e5" stopOpacity={0.1} />
            </linearGradient>
          </defs>

          <CartesianGrid
            vertical={false}
            strokeDasharray="3 3"
            stroke="#e5e5e5"
          />

          <XAxis
            dataKey="time"
            tickFormatter={formatXTick}
            tick={{ fontSize: 11, fontFamily: "monospace", fill: "#737373" }}
            tickSize={10}
            axisLine={{ stroke: "#e5e5e5" }}
            tickLine={{ stroke: "#e5e5e5" }}
          />

          <YAxis
            dataKey="close"
            tickFormatter={formatYTick}
            tick={{ fontSize: 11, fontFamily: "monospace", fill: "#737373" }}
            domain={yDomain}
            axisLine={false}
            tickLine={false}
            width={64}
          />

          <Tooltip
            content={<ChartTooltip trades={trades} />}
            cursor={{ stroke: "#d4d4d4", strokeDasharray: "3 3" }}
          />

          {/* High/Low band — shows price range */}
          {showHighLow && (
            <Area
              type="monotone"
              dataKey="high"
              stroke="none"
              fill="url(#bandGrad)"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          )}

          {/* Close price line */}
          <Area
            type="monotone"
            dataKey="close"
            stroke="#000"
            strokeWidth={1.5}
            fill="url(#priceGrad)"
            dot={false}
            activeDot={{ r: 3, fill: "#000", stroke: "#fff", strokeWidth: 1 }}
            isAnimationActive={false}
          />

          {/* Trade zones — shaded regions between entry and exit */}
          {showTradeZones &&
            tradeMarkers.map((t, i) => (
              <ReferenceArea
                key={`zone-${i}`}
                x1={t.entryTime}
                x2={t.exitTime}
                fill={
                  t.pnl >= 0
                    ? "rgba(0,0,0,0.05)"
                    : "rgba(220,38,38,0.07)"
                }
                stroke={
                  t.pnl >= 0
                    ? "rgba(0,0,0,0.15)"
                    : "rgba(220,38,38,0.2)"
                }
                strokeDasharray="3 3"
                ifOverflow="hidden"
              />
            ))}

          {/* Entry markers */}
          {tradeMarkers.map((m, i) => (
            <ReferenceDot
              key={`entry-${i}`}
              x={m.entryTime}
              y={m.entryPrice}
              shape={m.side === "LONG" ? LongEntryShape : ShortEntryShape}
              ifOverflow="extendDomain"
              label={
                showLabels
                  ? {
                      value: fmtPrice(m.entryPrice),
                      position: m.side === "LONG" ? "top" : "bottom",
                      fill: "#525252",
                      fontSize: 9,
                      fontFamily: "monospace",
                      offset: 12,
                    }
                  : undefined
              }
            />
          ))}

          {/* Exit markers */}
          {tradeMarkers.map((m, i) => (
            <ReferenceDot
              key={`exit-${i}`}
              x={m.exitTime}
              y={m.exitPrice}
              shape={m.pnl >= 0 ? ProfitExitShape : LossExitShape}
              ifOverflow="extendDomain"
              label={
                showLabels
                  ? {
                      value: `${m.pnl >= 0 ? "+" : ""}$${m.pnl.toFixed(2)}`,
                      position: "right",
                      fill: m.pnl >= 0 ? "#000" : "#dc2626",
                      fontSize: 10,
                      fontFamily: "monospace",
                      offset: 8,
                    }
                  : undefined
              }
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-1 flex items-center justify-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <polygon
              points="6,1 1,10 11,10"
              fill="#000"
              stroke="#fff"
              strokeWidth="0.5"
            />
          </svg>
          Long Entry
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <polygon
              points="6,11 1,2 11,2"
              fill="#737373"
              stroke="#fff"
              strokeWidth="0.5"
            />
          </svg>
          Short Entry
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="4" fill="#000" stroke="#fff" strokeWidth="1" />
          </svg>
          Profit Exit
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="4" fill="#dc2626" stroke="#fff" strokeWidth="1" />
          </svg>
          Loss Exit
        </span>
      </div>
    </div>
  );
}
