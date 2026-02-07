"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Loader2 } from "lucide-react";
import {
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  Customized,
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
  if (price >= 1000) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  return `$${price.toFixed(2)}`;
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
// Candlestick layer (rendered via Customized)
// ---------------------------------------------------------------------------

function createCandlestickLayer(candles: CandleData[]) {
  return function CandlestickLayer(props: any) {
    const { xAxisMap, yAxisMap } = props;
    if (!xAxisMap || !yAxisMap) return null;

    const xAxis = Object.values(xAxisMap)[0] as any;
    const yAxis = Object.values(yAxisMap)[0] as any;
    if (!xAxis?.scale || !yAxis?.scale) return null;

    const chartWidth = xAxis.width || 600;
    const barW = Math.max(1, Math.min(8, (chartWidth / candles.length) * 0.6));

    return (
      <g>
        {candles.map((d, i) => {
          const x = xAxis.scale(d.time);
          if (x === undefined || isNaN(x)) return null;
          const yO = yAxis.scale(d.open);
          const yC = yAxis.scale(d.close);
          const yH = yAxis.scale(d.high);
          const yL = yAxis.scale(d.low);
          const up = d.close >= d.open;
          const bodyTop = Math.min(yO, yC);
          const bodyH = Math.max(Math.abs(yC - yO), 1);

          return (
            <g key={i}>
              <line
                x1={x}
                x2={x}
                y1={yH}
                y2={yL}
                stroke={up ? "#000" : "#000"}
                strokeWidth={1}
              />
              <rect
                x={x - barW / 2}
                y={bodyTop}
                width={barW}
                height={bodyH}
                fill={up ? "#fff" : "#000"}
                stroke="#000"
                strokeWidth={1}
              />
            </g>
          );
        })}
      </g>
    );
  };
}

// ---------------------------------------------------------------------------
// Trade overlay layer — connecting lines, markers, labels
// ---------------------------------------------------------------------------

function createTradeOverlay(
  markers: TradeMarker[],
  opts: { showLines: boolean; showLabels: boolean }
) {
  return function TradeOverlay(props: any) {
    const { xAxisMap, yAxisMap } = props;
    if (!xAxisMap || !yAxisMap) return null;

    const xAxis = Object.values(xAxisMap)[0] as any;
    const yAxis = Object.values(yAxisMap)[0] as any;
    if (!xAxis?.scale || !yAxis?.scale) return null;

    return (
      <g>
        {markers.map((t, i) => {
          const x1 = xAxis.scale(t.entryTime);
          const y1 = yAxis.scale(t.entryPrice);
          const x2 = xAxis.scale(t.exitTime);
          const y2 = yAxis.scale(t.exitPrice);
          if ([x1, y1, x2, y2].some((v) => v === undefined || isNaN(v)))
            return null;

          const profit = t.pnl >= 0;
          const lineColor = profit ? "#000" : "#dc2626";

          return (
            <g key={i}>
              {/* Connecting dashed line */}
              {opts.showLines && (
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={lineColor}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  opacity={0.4}
                />
              )}

              {/* Entry marker */}
              {t.side === "LONG" ? (
                <polygon
                  points={`${x1},${y1 - 9} ${x1 - 7},${y1 + 3} ${x1 + 7},${y1 + 3}`}
                  fill="#000"
                  stroke="#fff"
                  strokeWidth={1.5}
                />
              ) : (
                <polygon
                  points={`${x1},${y1 + 9} ${x1 - 7},${y1 - 3} ${x1 + 7},${y1 - 3}`}
                  fill="#737373"
                  stroke="#fff"
                  strokeWidth={1.5}
                />
              )}

              {/* Entry price label */}
              {opts.showLabels && (
                <text
                  x={x1}
                  y={t.side === "LONG" ? y1 - 14 : y1 + 18}
                  textAnchor="middle"
                  fill="#525252"
                  fontSize={9}
                  fontFamily="monospace"
                >
                  {fmtPrice(t.entryPrice)}
                </text>
              )}

              {/* Exit marker */}
              <circle
                cx={x2}
                cy={y2}
                r={5}
                fill={profit ? "#000" : "#dc2626"}
                stroke="#fff"
                strokeWidth={1.5}
              />

              {/* P&L label at exit */}
              {opts.showLabels && (
                <text
                  x={x2 + 9}
                  y={y2 + 4}
                  textAnchor="start"
                  fill={profit ? "#000" : "#dc2626"}
                  fontSize={10}
                  fontWeight="600"
                  fontFamily="monospace"
                >
                  {profit ? "+" : ""}${t.pnl.toFixed(2)}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  };
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
  const [showCandlesticks, setShowCandlesticks] = useState(true);
  const [showTradeZones, setShowTradeZones] = useState(true);
  const [showConnectors, setShowConnectors] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

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

      const data: CandleData[] = (raw as any[]).map((c: any) => ({
        time: c.t,
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
      }));

      setCandles(data);
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

  // Build trade markers
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
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          side: t.side,
          pnl: t.pnl ?? 0,
        })),
    [trades]
  );

  // Memoize custom layers
  const CandlestickLayer = useMemo(
    () => createCandlestickLayer(candles),
    [candles]
  );
  const TradeOverlayLayer = useMemo(
    () =>
      createTradeOverlay(tradeMarkers, {
        showLines: showConnectors,
        showLabels,
      }),
    [tradeMarkers, showConnectors, showLabels]
  );

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

  // Y-axis domain from high/low
  const allPrices = candles.flatMap((c) => [c.high, c.low]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const padding = (maxPrice - minPrice) * 0.08 || maxPrice * 0.02;

  return (
    <div className="border-t border-gray-200 pt-3 pb-2">
      {/* View toggles */}
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-xs text-gray-400 mr-1">View:</span>
        <ToggleBtn
          active={showCandlesticks}
          onClick={() => setShowCandlesticks((v) => !v)}
        >
          Candlesticks
        </ToggleBtn>
        <ToggleBtn
          active={showTradeZones}
          onClick={() => setShowTradeZones((v) => !v)}
        >
          Trade Zones
        </ToggleBtn>
        <ToggleBtn
          active={showConnectors}
          onClick={() => setShowConnectors((v) => !v)}
        >
          Connectors
        </ToggleBtn>
        <ToggleBtn
          active={showLabels}
          onClick={() => setShowLabels((v) => !v)}
        >
          Labels
        </ToggleBtn>
      </div>

      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart
          data={candles}
          margin={{ top: 16, right: 64, bottom: 4, left: 12 }}
        >
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
            domain={[minPrice - padding, maxPrice + padding]}
            axisLine={false}
            tickLine={false}
            width={64}
          />

          <Tooltip
            content={<ChartTooltip trades={trades} />}
            cursor={{ stroke: "#d4d4d4", strokeDasharray: "3 3" }}
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
                    ? "rgba(0,0,0,0.04)"
                    : "rgba(220,38,38,0.06)"
                }
                stroke={
                  t.pnl >= 0
                    ? "rgba(0,0,0,0.12)"
                    : "rgba(220,38,38,0.18)"
                }
                strokeDasharray="3 3"
                ifOverflow="hidden"
              />
            ))}

          {/* Candlesticks */}
          {showCandlesticks && (
            <Customized component={CandlestickLayer} />
          )}

          {/* Trade markers, connectors, labels */}
          {tradeMarkers.length > 0 && (
            <Customized component={TradeOverlayLayer} />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-1 flex items-center justify-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="3" y="2" width="6" height="8" fill="#fff" stroke="#000" strokeWidth="1" />
            <line x1="6" y1="0" x2="6" y2="12" stroke="#000" strokeWidth="1" />
          </svg>
          Up
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="3" y="2" width="6" height="8" fill="#000" stroke="#000" strokeWidth="1" />
            <line x1="6" y1="0" x2="6" y2="12" stroke="#000" strokeWidth="1" />
          </svg>
          Down
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <polygon points="6,1 1,10 11,10" fill="#000" stroke="#fff" strokeWidth="0.5" />
          </svg>
          Long
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <polygon points="6,11 1,2 11,2" fill="#737373" stroke="#fff" strokeWidth="0.5" />
          </svg>
          Short
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="4" fill="#000" stroke="#fff" strokeWidth="1" />
          </svg>
          Profit
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="4" fill="#dc2626" stroke="#fff" strokeWidth="1" />
          </svg>
          Loss
        </span>
      </div>
    </div>
  );
}
