"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  ReferenceLine,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PositionChartProps {
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  liquidationPrice?: number | null;
  side: "LONG" | "SHORT";
  testnet: boolean;
}

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatXTick(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatYTick(price: number) {
  if (price >= 10000) return `$${(price / 1000).toFixed(1)}k`;
  if (price >= 100) return `$${price.toFixed(0)}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(4)}`;
}

function fmtPrice(price: number) {
  if (price >= 1000)
    return `$${price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  if (price >= 1) return `$${price.toFixed(3)}`;
  return `$${price.toFixed(5)}`;
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const time = label as number;
  const d = payload[0]?.payload as CandleData | undefined;

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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Reference Line Label
// ---------------------------------------------------------------------------

function PriceLabel({
  viewBox,
  value,
  color,
  label,
}: {
  viewBox?: any;
  value: string;
  color: string;
  label: string;
}) {
  if (!viewBox) return null;
  return (
    <g>
      <rect
        x={viewBox.width + viewBox.x - 2}
        y={viewBox.y - 10}
        width={label.length * 6.5 + value.length * 7 + 16}
        height={20}
        rx={3}
        fill={color}
        fillOpacity={0.1}
        stroke={color}
        strokeOpacity={0.3}
        strokeWidth={1}
      />
      <text
        x={viewBox.width + viewBox.x + 6}
        y={viewBox.y + 4}
        fill={color}
        fontSize={10}
        fontFamily="monospace"
        fontWeight={600}
      >
        {label} {value}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function PositionChart({
  symbol,
  entryPrice,
  currentPrice,
  stopLoss,
  takeProfit,
  liquidationPrice,
  side,
  testnet,
}: PositionChartProps) {
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const fetchCandlesAction = useAction(
    api.hyperliquid.candles.fetchCandles
  );

  // Fetch initial historical candles
  const loadInitialCandles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await fetchCandlesAction({
        symbol,
        interval: "5m",
        limit: 100,
        testnet,
      });

      if (!raw || (Array.isArray(raw) && raw.length === 0)) {
        setCandles([]);
        setError("No price data available.");
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
      console.log("Failed to load candles:", err);
      setError("Failed to load price data.");
    } finally {
      setLoading(false);
    }
  }, [symbol, testnet, fetchCandlesAction]);

  // Connect to Hyperliquid WebSocket for real-time candle updates
  const connectWebSocket = useCallback(() => {
    const wsUrl = testnet
      ? "wss://api.hyperliquid-testnet.xyz/ws"
      : "wss://api.hyperliquid.xyz/ws";

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`[PositionChart] WebSocket connected for ${symbol}`);
        setWsConnected(true);
        reconnectAttemptsRef.current = 0;

        // Subscribe to candle data
        ws.send(
          JSON.stringify({
            method: "subscribe",
            subscription: {
              type: "candle",
              coin: symbol,
              interval: "5m",
            },
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Handle candle updates
          if (msg.channel === "candle" && msg.data) {
            const candleData = msg.data;

            // Could be a single candle or array
            const rawCandles = Array.isArray(candleData)
              ? candleData
              : [candleData];

            setCandles((prev) => {
              const updated = [...prev];

              for (const raw of rawCandles) {
                const newCandle: CandleData = {
                  time: typeof raw.t === "number" ? raw.t : parseInt(raw.t),
                  open: typeof raw.o === "number" ? raw.o : parseFloat(raw.o),
                  high: typeof raw.h === "number" ? raw.h : parseFloat(raw.h),
                  low: typeof raw.l === "number" ? raw.l : parseFloat(raw.l),
                  close: typeof raw.c === "number" ? raw.c : parseFloat(raw.c),
                };

                // Find if this candle timestamp already exists
                const existingIdx = updated.findIndex(
                  (c) => c.time === newCandle.time
                );
                if (existingIdx >= 0) {
                  // Update existing candle
                  updated[existingIdx] = newCandle;
                } else {
                  // Add new candle, keep last 100
                  updated.push(newCandle);
                  if (updated.length > 120) {
                    updated.splice(0, updated.length - 100);
                  }
                }
              }

              // Sort by time
              updated.sort((a, b) => a.time - b.time);
              return updated;
            });
          }
        } catch (err) {
          // Ignore parse errors for ping/pong messages
        }
      };

      ws.onclose = () => {
        console.log(`[PositionChart] WebSocket closed for ${symbol}`);
        setWsConnected(false);
        wsRef.current = null;

        // Reconnect with exponential backoff
        const delay = Math.min(
          1000 * Math.pow(2, reconnectAttemptsRef.current),
          30000
        );
        reconnectAttemptsRef.current++;
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
      };

      ws.onerror = (err) => {
        console.log(`[PositionChart] WebSocket error for ${symbol}`);
        ws.close();
      };
    } catch (err) {
      console.log("[PositionChart] Failed to create WebSocket:", err);
    }
  }, [symbol, testnet]);

  // Initialize: load candles then connect WebSocket
  useEffect(() => {
    loadInitialCandles();
    connectWebSocket();

    return () => {
      // Cleanup WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [loadInitialCandles, connectWebSocket]);

  // Compute Y-axis domain including SL/TP/entry/liq levels
  const yDomain = useMemo<[number, number]>(() => {
    if (candles.length === 0) return [0, 1];

    const prices = candles.flatMap((c) => [c.high, c.low]);
    // Also consider key price levels
    prices.push(entryPrice);
    if (stopLoss) prices.push(stopLoss);
    if (takeProfit) prices.push(takeProfit);
    if (liquidationPrice) prices.push(liquidationPrice);

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pad = (max - min) * 0.08 || max * 0.02;
    return [min - pad, max + pad];
  }, [candles, entryPrice, stopLoss, takeProfit, liquidationPrice]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 280 }}>
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">
          Loading chart for {symbol}...
        </span>
      </div>
    );
  }

  // Error state
  if (error || candles.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height: 280 }}>
        <p className="text-sm text-gray-400">
          {error || "No price data available."}
        </p>
      </div>
    );
  }

  return (
    <div className="pt-2 pb-1">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-semibold text-gray-900">
            {symbol} 5m
          </span>
          <span
            className={`inline-flex items-center gap-1 text-xs font-mono ${
              wsConnected ? "text-gray-900" : "text-gray-400"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                wsConnected ? "bg-gray-900" : "bg-gray-300"
              }`}
            />
            {wsConnected ? "Live" : "Connecting..."}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-gray-500">
          <span>Entry: {fmtPrice(entryPrice)}</span>
          {stopLoss && (
            <span className="text-red-600">SL: {fmtPrice(stopLoss)}</span>
          )}
          {takeProfit && (
            <span className="text-green-600">TP: {fmtPrice(takeProfit)}</span>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={candles}
          margin={{ top: 8, right: 12, bottom: 4, left: 12 }}
        >
          <defs>
            <linearGradient id={`priceGrad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4d4d4" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#d4d4d4" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            vertical={false}
            strokeDasharray="3 3"
            stroke="#f5f5f5"
          />

          <XAxis
            dataKey="time"
            tickFormatter={formatXTick}
            tick={{ fontSize: 10, fontFamily: "monospace", fill: "#a3a3a3" }}
            tickSize={6}
            axisLine={{ stroke: "#e5e5e5" }}
            tickLine={{ stroke: "#e5e5e5" }}
            minTickGap={40}
          />

          <YAxis
            dataKey="close"
            tickFormatter={formatYTick}
            tick={{ fontSize: 10, fontFamily: "monospace", fill: "#a3a3a3" }}
            domain={yDomain}
            axisLine={false}
            tickLine={false}
            width={56}
          />

          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: "#d4d4d4", strokeDasharray: "3 3" }}
          />

          {/* Close price line */}
          <Area
            type="monotone"
            dataKey="close"
            stroke="#000"
            strokeWidth={1.5}
            fill={`url(#priceGrad-${symbol})`}
            dot={false}
            activeDot={{ r: 3, fill: "#000", stroke: "#fff", strokeWidth: 1 }}
            isAnimationActive={false}
          />

          {/* Entry Price Reference Line */}
          <ReferenceLine
            y={entryPrice}
            stroke="#000"
            strokeDasharray="6 3"
            strokeWidth={1}
            label={{
              value: `Entry ${fmtPrice(entryPrice)}`,
              position: "right",
              fill: "#000",
              fontSize: 10,
              fontFamily: "monospace",
            }}
          />

          {/* Stop Loss Reference Line */}
          {stopLoss && (
            <ReferenceLine
              y={stopLoss}
              stroke="#dc2626"
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={{
                value: `SL ${fmtPrice(stopLoss)}`,
                position: "right",
                fill: "#dc2626",
                fontSize: 10,
                fontFamily: "monospace",
                fontWeight: 600,
              }}
            />
          )}

          {/* Take Profit Reference Line */}
          {takeProfit && (
            <ReferenceLine
              y={takeProfit}
              stroke="#16a34a"
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={{
                value: `TP ${fmtPrice(takeProfit)}`,
                position: "right",
                fill: "#16a34a",
                fontSize: 10,
                fontFamily: "monospace",
                fontWeight: 600,
              }}
            />
          )}

          {/* Liquidation Price Reference Line */}
          {liquidationPrice && (
            <ReferenceLine
              y={liquidationPrice}
              stroke="#a3a3a3"
              strokeDasharray="2 4"
              strokeWidth={1}
              label={{
                value: `Liq ${fmtPrice(liquidationPrice)}`,
                position: "right",
                fill: "#a3a3a3",
                fontSize: 9,
                fontFamily: "monospace",
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-1 flex items-center justify-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-4 bg-black" style={{ borderTop: "2px dashed #000" }} />
          Entry
        </span>
        {stopLoss && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-px w-4" style={{ borderTop: "2px dashed #dc2626" }} />
            Stop Loss
          </span>
        )}
        {takeProfit && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-px w-4" style={{ borderTop: "2px dashed #16a34a" }} />
            Take Profit
          </span>
        )}
        {liquidationPrice && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-px w-4" style={{ borderTop: "2px dashed #a3a3a3" }} />
            Liquidation
          </span>
        )}
      </div>
    </div>
  );
}
