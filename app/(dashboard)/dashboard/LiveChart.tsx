"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  LineStyle,
  CrosshairMode,
} from "lightweight-charts";
import type {
  IChartApi,
  ISeriesApi,
  IPriceLine,
  UTCTimestamp,
  CandlestickData,
  LineData,
  HistogramData,
} from "lightweight-charts";
import {
  Loader2,
  Maximize2,
  CandlestickChart,
  LineChart,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChartType = "candles" | "line";
type Interval = "1m" | "5m" | "15m" | "1h" | "4h";
type ChartSize = "S" | "M" | "L";

interface Position {
  _id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  size: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  liquidationPrice?: number | null;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

interface LiveChartProps {
  positions: Position[];
  testnet: boolean;
}

interface CandleRaw {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "4h"];
const SIZES: ChartSize[] = ["S", "M", "L"];
const SIZE_MAP: Record<ChartSize, number> = { S: 240, M: 380, L: 520 };

const CANDLE_LIMITS: Record<Interval, number> = {
  "1m": 200,
  "5m": 150,
  "15m": 120,
  "1h": 100,
  "4h": 80,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(price: number) {
  if (price >= 1000)
    return `$${price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  if (price >= 1) return `$${price.toFixed(3)}`;
  return `$${price.toFixed(5)}`;
}

function fmtPnl(val: number) {
  const sign = val >= 0 ? "+" : "";
  return `${sign}$${val.toFixed(2)}`;
}

function fmtPct(val: number) {
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val.toFixed(2)}%`;
}

function toTimestamp(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function LiveChart({ positions, testnet }: LiveChartProps) {
  // State
  const [selectedSymbol, setSelectedSymbol] = useState<string>(
    positions[0]?.symbol || ""
  );
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [interval, setActiveInterval] = useState<Interval>("5m");
  const [chartSize, setChartSize] = useState<ChartSize>("M");
  const [showVolume, setShowVolume] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  // Refs — keep mutable state that shouldn't trigger re-renders
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Stable refs for values used inside WebSocket/callbacks to avoid stale closures
  const chartTypeRef = useRef<ChartType>(chartType);
  const intervalRef = useRef<Interval>(interval);
  const symbolRef = useRef<string>(selectedSymbol);
  const showVolumeRef = useRef(showVolume);
  const testnetRef = useRef(testnet);
  const positionsRef = useRef(positions);

  const fetchCandlesAction = useAction(api.hyperliquid.candles.fetchCandles);

  // Keep refs in sync
  useEffect(() => { chartTypeRef.current = chartType; }, [chartType]);
  useEffect(() => { intervalRef.current = interval; }, [interval]);
  useEffect(() => { symbolRef.current = selectedSymbol; }, [selectedSymbol]);
  useEffect(() => { showVolumeRef.current = showVolume; }, [showVolume]);
  useEffect(() => { testnetRef.current = testnet; }, [testnet]);
  useEffect(() => { positionsRef.current = positions; }, [positions]);

  // Derived — uses ref for positions to avoid recalc on every 10s poll
  const selectedPosition = useMemo(
    () => positions.find((p) => p.symbol === selectedSymbol),
    [positions, selectedSymbol]
  );

  // Auto-select first position if current becomes invalid
  useEffect(() => {
    if (positions.length > 0 && !positions.find((p) => p.symbol === selectedSymbol)) {
      setSelectedSymbol(positions[0].symbol);
    }
  }, [positions, selectedSymbol]);

  // -----------------------------------------------------------------------
  // Price lines — standalone, only depends on selectedPosition changing
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!seriesRef.current || !selectedPosition) return;

    // Remove old
    for (const line of priceLinesRef.current) {
      try { seriesRef.current.removePriceLine(line); } catch { /* */ }
    }
    priceLinesRef.current = [];

    // Entry
    priceLinesRef.current.push(
      seriesRef.current.createPriceLine({
        price: selectedPosition.entryPrice,
        color: "#171717",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Entry",
      })
    );

    // SL
    if (selectedPosition.stopLoss) {
      priceLinesRef.current.push(
        seriesRef.current.createPriceLine({
          price: selectedPosition.stopLoss,
          color: "#dc2626",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "SL",
        })
      );
    }

    // TP
    if (selectedPosition.takeProfit) {
      priceLinesRef.current.push(
        seriesRef.current.createPriceLine({
          price: selectedPosition.takeProfit,
          color: "#16a34a",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "TP",
        })
      );
    }

    // Liq
    if (selectedPosition.liquidationPrice) {
      priceLinesRef.current.push(
        seriesRef.current.createPriceLine({
          price: selectedPosition.liquidationPrice,
          color: "#a3a3a3",
          lineWidth: 1,
          lineStyle: LineStyle.SparseDotted,
          axisLabelVisible: true,
          title: "Liq",
        })
      );
    }
  }, [selectedPosition]);

  // -----------------------------------------------------------------------
  // Build chart + series (imperative, not in a dependency chain)
  // -----------------------------------------------------------------------

  const buildChart = useCallback((type: ChartType, vol: boolean) => {
    if (!containerRef.current) return;

    // Tear down previous
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesRef.current = [];
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: SIZE_MAP[chartSize],
      layout: {
        background: { color: "#ffffff" },
        textColor: "#737373",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#f5f5f5" },
        horzLines: { color: "#f5f5f5" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#d4d4d4", style: LineStyle.Dashed, labelBackgroundColor: "#171717" },
        horzLine: { color: "#d4d4d4", style: LineStyle.Dashed, labelBackgroundColor: "#171717" },
      },
      rightPriceScale: {
        borderColor: "#e5e5e5",
        scaleMargins: { top: 0.08, bottom: vol ? 0.25 : 0.08 },
      },
      timeScale: {
        borderColor: "#e5e5e5",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: type === "candles" ? 8 : 4,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
    });

    chartRef.current = chart;

    // Price series
    if (type === "candles") {
      seriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: "#171717",
        downColor: "#d4d4d4",
        borderUpColor: "#171717",
        borderDownColor: "#a3a3a3",
        wickUpColor: "#404040",
        wickDownColor: "#a3a3a3",
      });
    } else {
      seriesRef.current = chart.addSeries(LineSeries, {
        color: "#000000",
        lineWidth: 2,
        crosshairMarkerBackgroundColor: "#000000",
        crosshairMarkerBorderColor: "#ffffff",
        crosshairMarkerRadius: 4,
      });
    }

    // Volume series
    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      visible: vol,
    });
    volSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volumeSeriesRef.current = volSeries;

    return chart;
  }, [chartSize]);

  // -----------------------------------------------------------------------
  // Fetch candles and populate series (pure data, no side effects on chart)
  // -----------------------------------------------------------------------

  const fetchAndSetData = useCallback(async (
    symbol: string,
    tf: Interval,
    type: ChartType,
    fitAfter: boolean
  ) => {
    try {
      const raw = await fetchCandlesAction({
        symbol,
        interval: tf,
        limit: CANDLE_LIMITS[tf],
        testnet: testnetRef.current,
      });

      if (!raw || !Array.isArray(raw) || raw.length === 0) return;

      const candles = (raw as CandleRaw[]).sort((a, b) => a.t - b.t);

      if (!seriesRef.current) return;

      if (type === "candles") {
        (seriesRef.current as ISeriesApi<"Candlestick">).setData(
          candles.map((c) => ({
            time: toTimestamp(c.t),
            open: c.o,
            high: c.h,
            low: c.l,
            close: c.c,
          }))
        );
      } else {
        (seriesRef.current as ISeriesApi<"Line">).setData(
          candles.map((c) => ({
            time: toTimestamp(c.t),
            value: c.c,
          }))
        );
      }

      if (volumeSeriesRef.current) {
        volumeSeriesRef.current.setData(
          candles.map((c) => ({
            time: toTimestamp(c.t),
            value: c.v || 0,
            color: c.c >= c.o ? "rgba(23,23,23,0.3)" : "rgba(163,163,163,0.4)",
          }))
        );
      }

      if (fitAfter && chartRef.current) {
        // Reset price scale auto-scaling (user zoom/pan disables it)
        // so the Y-axis snaps to the new symbol's price range
        chartRef.current.priceScale("right").applyOptions({ autoScale: true });
        chartRef.current.timeScale().fitContent();
      }
    } catch (err) {
      console.log("[LiveChart] Failed to load candles:", err);
    }
  }, [fetchCandlesAction]);

  // -----------------------------------------------------------------------
  // WebSocket — stable, reads from refs
  // -----------------------------------------------------------------------

  const startWebSocket = useCallback((symbol: string, tf: Interval) => {
    // Teardown previous
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const wsUrl = testnetRef.current
      ? "wss://api.hyperliquid-testnet.xyz/ws"
      : "wss://api.hyperliquid.xyz/ws";

    const connect = () => {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsConnected(true);
          reconnectAttemptsRef.current = 0;
          ws.send(JSON.stringify({
            method: "subscribe",
            subscription: { type: "candle", coin: symbol, interval: tf },
          }));
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.channel !== "candle" || !msg.data) return;

            const rawCandles = Array.isArray(msg.data) ? msg.data : [msg.data];
            const series = seriesRef.current;
            const volSeries = volumeSeriesRef.current;
            if (!series) return;

            for (const raw of rawCandles) {
              const ts = toTimestamp(typeof raw.t === "number" ? raw.t : parseInt(raw.t));
              const o = typeof raw.o === "number" ? raw.o : parseFloat(raw.o);
              const h = typeof raw.h === "number" ? raw.h : parseFloat(raw.h);
              const l = typeof raw.l === "number" ? raw.l : parseFloat(raw.l);
              const c = typeof raw.c === "number" ? raw.c : parseFloat(raw.c);
              const v = typeof raw.v === "number" ? raw.v : parseFloat(raw.v || "0");

              // Read current chart type from ref (no stale closure)
              if (chartTypeRef.current === "candles") {
                (series as ISeriesApi<"Candlestick">).update({ time: ts, open: o, high: h, low: l, close: c });
              } else {
                (series as ISeriesApi<"Line">).update({ time: ts, value: c });
              }

              if (volSeries) {
                volSeries.update({
                  time: ts,
                  value: v,
                  color: c >= o ? "rgba(23,23,23,0.3)" : "rgba(163,163,163,0.4)",
                });
              }
            }
          } catch { /* ignore */ }
        };

        ws.onclose = () => {
          setWsConnected(false);
          wsRef.current = null;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        };

        ws.onerror = () => { ws.close(); };
      } catch {
        console.log("[LiveChart] WS create failed");
      }
    };

    connect();
  }, []);

  const stopWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setWsConnected(false);
  }, []);

  // -----------------------------------------------------------------------
  // EFFECT: Mount — create chart, load data, start WS (once)
  // -----------------------------------------------------------------------

  useEffect(() => {
    buildChart(chartType, showVolume);

    fetchAndSetData(selectedSymbol, interval, chartType, true).then(() => {
      setInitialLoading(false);
    });

    startWebSocket(selectedSymbol, interval);

    // Resize observer
    const container = containerRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (container) {
      resizeObserver = new ResizeObserver((entries) => {
        if (entries[0] && chartRef.current) {
          chartRef.current.resize(entries[0].contentRect.width, SIZE_MAP[chartSize]);
        }
      });
      resizeObserver.observe(container);
    }

    return () => {
      resizeObserver?.disconnect();
      stopWebSocket();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
        volumeSeriesRef.current = null;
        priceLinesRef.current = [];
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Mount only

  // -----------------------------------------------------------------------
  // EFFECT: Symbol or Interval change — swap data + reconnect WS
  // -----------------------------------------------------------------------

  const prevSymbolRef = useRef(selectedSymbol);
  const prevIntervalRef = useRef(interval);

  useEffect(() => {
    const symbolChanged = prevSymbolRef.current !== selectedSymbol;
    const intervalChanged = prevIntervalRef.current !== interval;
    if (!symbolChanged && !intervalChanged) return;

    prevSymbolRef.current = selectedSymbol;
    prevIntervalRef.current = interval;

    // Show brief loading only for symbol switch
    if (symbolChanged) {
      setInitialLoading(true);

      // Clear old price lines BEFORE loading new data — otherwise the old
      // entry/SL/TP prices (e.g. BTC at $69k) keep the Y-axis stretched
      // and the new symbol's data (e.g. SOL at $87) is invisible.
      if (seriesRef.current) {
        for (const line of priceLinesRef.current) {
          try { seriesRef.current.removePriceLine(line); } catch { /* */ }
        }
        priceLinesRef.current = [];
      }
    }

    fetchAndSetData(selectedSymbol, interval, chartTypeRef.current, true).then(() => {
      setInitialLoading(false);
      // After price lines effect has run, force auto-scale again
      requestAnimationFrame(() => {
        if (chartRef.current) {
          chartRef.current.priceScale("right").applyOptions({ autoScale: true });
          chartRef.current.timeScale().fitContent();
        }
      });
    });

    // Reconnect WS with new subscription
    stopWebSocket();
    startWebSocket(selectedSymbol, interval);
  }, [selectedSymbol, interval, fetchAndSetData, startWebSocket, stopWebSocket]);

  // -----------------------------------------------------------------------
  // EFFECT: Chart type change — rebuild series, reload data (no WS reconnect)
  // -----------------------------------------------------------------------

  const prevChartTypeRef = useRef(chartType);

  useEffect(() => {
    if (prevChartTypeRef.current === chartType) return;
    prevChartTypeRef.current = chartType;

    // Rebuild chart with new series type
    buildChart(chartType, showVolumeRef.current);

    // Reload data into the new series
    fetchAndSetData(symbolRef.current, intervalRef.current, chartType, true);
  }, [chartType, buildChart, fetchAndSetData]);

  // -----------------------------------------------------------------------
  // EFFECT: Chart size change — just resize, no data reload
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (chartRef.current && containerRef.current) {
      chartRef.current.resize(containerRef.current.clientWidth, SIZE_MAP[chartSize]);
    }
  }, [chartSize]);

  // -----------------------------------------------------------------------
  // EFFECT: Volume toggle — just toggle visibility + adjust margins
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.applyOptions({ visible: showVolume });
    }
    if (chartRef.current) {
      chartRef.current.priceScale("right").applyOptions({
        scaleMargins: { top: 0.08, bottom: showVolume ? 0.25 : 0.08 },
      });
    }
  }, [showVolume]);

  // -----------------------------------------------------------------------
  // Fit handler
  // -----------------------------------------------------------------------

  const handleFit = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  // No positions — nothing to render
  if (positions.length === 0) return null;

  return (
    <div className="border border-gray-200 rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.08)] bg-white overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        {/* Left */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono font-bold text-gray-900 tracking-tight">
            {selectedSymbol}
          </span>
          <span className="text-xs font-mono text-gray-400">
            {interval.toUpperCase()}
          </span>
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-mono ${
              wsConnected ? "text-gray-900" : "text-gray-400"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                wsConnected ? "bg-gray-900 animate-pulse" : "bg-gray-300"
              }`}
            />
            {wsConnected ? "LIVE" : "..."}
          </span>
        </div>

        {/* Right */}
        <div className="flex items-center gap-1">
          {/* Timeframes */}
          <div className="flex items-center rounded-md bg-gray-50 p-0.5 mr-2">
            {INTERVALS.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setActiveInterval(tf)}
                className={`px-2 py-0.5 text-[11px] font-mono rounded transition-all ${
                  interval === tf
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Chart type */}
          <div className="flex items-center rounded-md bg-gray-50 p-0.5 mr-2">
            <button
              type="button"
              onClick={() => setChartType("candles")}
              className={`p-1 rounded transition-all ${
                chartType === "candles"
                  ? "bg-gray-900 text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-900"
              }`}
              title="Candlesticks"
            >
              <CandlestickChart className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setChartType("line")}
              className={`p-1 rounded transition-all ${
                chartType === "line"
                  ? "bg-gray-900 text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-900"
              }`}
              title="Line"
            >
              <LineChart className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Volume */}
          <button
            type="button"
            onClick={() => setShowVolume((v) => !v)}
            className={`p-1 rounded transition-all mr-2 ${
              showVolume
                ? "bg-gray-900 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-900 bg-gray-50"
            }`}
            title="Toggle Volume"
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </button>

          {/* Size */}
          <div className="flex items-center rounded-md bg-gray-50 p-0.5 mr-2">
            {SIZES.map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => setChartSize(sz)}
                className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded transition-all ${
                  chartSize === sz
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-400 hover:text-gray-900"
                }`}
              >
                {sz}
              </button>
            ))}
          </div>

          {/* Fit */}
          <button
            type="button"
            onClick={handleFit}
            className="p-1 rounded text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            title="Fit to screen"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex">
        {/* Chart */}
        <div className="flex-1 relative min-w-0">
          {initialLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              <span className="ml-2 text-xs font-mono text-gray-400">
                Loading {selectedSymbol}...
              </span>
            </div>
          )}
          <div
            ref={containerRef}
            style={{ height: SIZE_MAP[chartSize] }}
            className="w-full"
          />
        </div>

        {/* Position selector */}
        <div
          className="w-48 border-l border-gray-100 bg-gray-50/50 flex flex-col"
          style={{ height: SIZE_MAP[chartSize] }}
        >
          <div className="px-3 py-2 border-b border-gray-100">
            <span className="text-[10px] font-mono font-semibold text-gray-400 uppercase tracking-wider">
              Positions
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {positions.map((pos) => {
              const isSelected = pos.symbol === selectedSymbol;
              const isProfit = pos.unrealizedPnl >= 0;

              return (
                <button
                  key={pos._id}
                  type="button"
                  onClick={() => setSelectedSymbol(pos.symbol)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-100 transition-all ${
                    isSelected
                      ? "bg-white shadow-[inset_3px_0_0_#171717]"
                      : "hover:bg-white/70"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-mono font-bold ${
                        isSelected ? "text-gray-900" : "text-gray-600"
                      }`}
                    >
                      {pos.symbol}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1 py-0 h-4 ${
                        pos.side === "LONG"
                          ? "border-gray-900 text-gray-900"
                          : "border-gray-400 text-gray-500"
                      }`}
                    >
                      {pos.side === "LONG" ? (
                        <ArrowUpRight className="h-2.5 w-2.5 mr-0.5" />
                      ) : (
                        <ArrowDownRight className="h-2.5 w-2.5 mr-0.5" />
                      )}
                      {pos.leverage}x
                    </Badge>
                  </div>
                  <div className="mt-1 text-[11px] font-mono tabular-nums text-gray-500">
                    {fmtPrice(pos.currentPrice)}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between">
                    <span
                      className={`text-[11px] font-mono tabular-nums font-semibold ${
                        isProfit ? "text-gray-900" : "text-gray-500"
                      }`}
                    >
                      {fmtPnl(pos.unrealizedPnl)}
                    </span>
                    <span
                      className={`text-[10px] font-mono tabular-nums ${
                        isProfit ? "text-gray-700" : "text-gray-400"
                      }`}
                    >
                      {fmtPct(pos.unrealizedPnlPct)}
                    </span>
                  </div>
                  {(pos.stopLoss || pos.takeProfit) && (
                    <div className="mt-1 flex items-center gap-2 text-[9px] font-mono tabular-nums">
                      {pos.stopLoss && (
                        <span className="text-red-500">SL {fmtPrice(pos.stopLoss)}</span>
                      )}
                      {pos.takeProfit && (
                        <span className="text-green-600">TP {fmtPrice(pos.takeProfit)}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
