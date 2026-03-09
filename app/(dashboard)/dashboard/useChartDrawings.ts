"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { DrawingTool } from "./ChartToolbar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DrawingType =
  | "trendline"
  | "arrow"
  | "hline"
  | "hray"
  | "vline"
  | "fib"
  | "measure"
  | "rect"
  | "text"
  | "brush";

export interface Point {
  time: number; // UTC seconds (for coordinate conversion)
  price: number;
  x: number; // pixel x (stored for brush)
  y: number; // pixel y (stored for brush)
}

export interface Drawing {
  id: string;
  type: DrawingType;
  points: Point[];
  color: string;
  text?: string;
  visible: boolean;
}

export interface MeasureOverlay {
  x: number;
  y: number;
  diff: string;
  pct: string;
  bars: string;
}

interface UseChartDrawingsParams {
  chartRef: React.RefObject<IChartApi | null>;
  seriesRef: React.RefObject<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  chartSize: number;
}

// ---------------------------------------------------------------------------
// Fibonacci levels
// ---------------------------------------------------------------------------

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS_LIGHT = [
  "#171717", "#525252", "#737373", "#404040", "#737373", "#525252", "#171717",
];
const FIB_COLORS_DARK = [
  "#e5e5e5", "#a3a3a3", "#737373", "#a3a3a3", "#737373", "#a3a3a3", "#e5e5e5",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

function getLineColor(): string {
  return isDarkMode() ? "#a3a3a3" : "#737373";
}

function getTextColor(): string {
  return isDarkMode() ? "#e5e5e5" : "#171717";
}

function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Drawing renderers
// ---------------------------------------------------------------------------

function toPixel(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">,
  p: Point | null | undefined
): { x: number; y: number } | null {
  if (!p || p.time == null || p.price == null) return null;
  try {
    const ts = chart.timeScale();
    const x = ts.timeToCoordinate(p.time as never);
    const y = (series as ISeriesApi<"Candlestick">).priceToCoordinate(p.price);
    if (x === null || y === null) return null;
    return { x, y };
  } catch {
    return null;
  }
}

function drawTrendline(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">
) {
  if (d.points.length < 2) return;
  const p1 = toPixel(chart, series, d.points[0]);
  const p2 = toPixel(chart, series, d.points[1]);
  if (!p1 || !p2) return;

  ctx.beginPath();
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">
) {
  if (d.points.length < 2) return;
  const p1 = toPixel(chart, series, d.points[0]);
  const p2 = toPixel(chart, series, d.points[1]);
  if (!p1 || !p2) return;

  // Line
  ctx.beginPath();
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  // Arrowhead at p2
  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const headLen = 10;
  ctx.beginPath();
  ctx.fillStyle = d.color;
  ctx.moveTo(p2.x, p2.y);
  ctx.lineTo(
    p2.x - headLen * Math.cos(angle - Math.PI / 6),
    p2.y - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    p2.x - headLen * Math.cos(angle + Math.PI / 6),
    p2.y - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}

function drawHLine(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">,
  width: number
) {
  if (d.points.length < 1) return;
  const y = (series as ISeriesApi<"Candlestick">).priceToCoordinate(d.points[0].price);
  if (y === null) return;

  ctx.beginPath();
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
  ctx.setLineDash([]);

  const label = d.points[0].price >= 1000
    ? d.points[0].price.toFixed(2)
    : d.points[0].price >= 1
      ? d.points[0].price.toFixed(4)
      : d.points[0].price.toFixed(6);
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = d.color;
  const tw = ctx.measureText(label).width;
  ctx.fillText(label, width - tw - 4, y - 4);
}

function drawHRay(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">,
  width: number
) {
  if (d.points.length < 1) return;
  const pix = toPixel(chart, series, d.points[0]);
  if (!pix) return;

  // Solid line from origin to the right edge
  ctx.beginPath();
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.moveTo(pix.x, pix.y);
  ctx.lineTo(width, pix.y);
  ctx.stroke();

  // Small arrowhead at the right end
  const arrowSize = 6;
  ctx.beginPath();
  ctx.fillStyle = d.color;
  ctx.moveTo(width, pix.y);
  ctx.lineTo(width - arrowSize, pix.y - arrowSize / 2);
  ctx.lineTo(width - arrowSize, pix.y + arrowSize / 2);
  ctx.closePath();
  ctx.fill();

  // Small dot at origin
  ctx.beginPath();
  ctx.arc(pix.x, pix.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawVLine(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  chart: IChartApi,
  height: number
) {
  if (d.points.length < 1) return;
  const ts = chart.timeScale();
  const x = ts.timeToCoordinate(d.points[0].time as never);
  if (x === null) return;

  ctx.beginPath();
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawFibonacci(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">,
  width: number
) {
  if (d.points.length < 2) return;
  const p1 = toPixel(chart, series, d.points[0]);
  const p2 = toPixel(chart, series, d.points[1]);
  if (!p1 || !p2) return;

  const priceLow = Math.min(d.points[0].price, d.points[1].price);
  const priceHigh = Math.max(d.points[0].price, d.points[1].price);
  const dark = isDarkMode();
  const colors = dark ? FIB_COLORS_DARK : FIB_COLORS_LIGHT;

  for (let i = 0; i < FIB_LEVELS.length; i++) {
    const level = FIB_LEVELS[i];
    const price = priceHigh - (priceHigh - priceLow) * level;
    const y = (series as ISeriesApi<"Candlestick">).priceToCoordinate(price);
    if (y === null) continue;

    ctx.beginPath();
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = 1;
    ctx.setLineDash(level === 0 || level === 1 ? [] : [4, 3]);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.setLineDash([]);

    const pctLabel = `${(level * 100).toFixed(1)}%`;
    const priceLabel = price >= 1000 ? price.toFixed(2) : price >= 1 ? price.toFixed(4) : price.toFixed(6);
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = colors[i];
    ctx.fillText(`${pctLabel}  ${priceLabel}`, 4, y - 3);
  }
}

function drawMeasureRect(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">
): MeasureOverlay | null {
  if (d.points.length < 2) return null;
  const p1 = toPixel(chart, series, d.points[0]);
  const p2 = toPixel(chart, series, d.points[1]);
  if (!p1 || !p2) return null;

  const dark = isDarkMode();

  ctx.fillStyle = dark ? "rgba(229,229,229,0.06)" : "rgba(23,23,23,0.06)";
  ctx.fillRect(
    Math.min(p1.x, p2.x),
    Math.min(p1.y, p2.y),
    Math.abs(p2.x - p1.x),
    Math.abs(p2.y - p1.y)
  );
  ctx.strokeStyle = dark ? "rgba(229,229,229,0.3)" : "rgba(23,23,23,0.3)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(
    Math.min(p1.x, p2.x),
    Math.min(p1.y, p2.y),
    Math.abs(p2.x - p1.x),
    Math.abs(p2.y - p1.y)
  );
  ctx.setLineDash([]);

  const priceDiff = d.points[1].price - d.points[0].price;
  const pricePct = (priceDiff / d.points[0].price) * 100;
  const timeDiff = d.points[1].time - d.points[0].time;
  const sign = priceDiff >= 0 ? "+" : "";
  const diffStr = priceDiff >= 100
    ? `${sign}${priceDiff.toFixed(2)}`
    : priceDiff >= 1
      ? `${sign}${priceDiff.toFixed(4)}`
      : `${sign}${priceDiff.toFixed(6)}`;
  const pctStr = `${sign}${pricePct.toFixed(2)}%`;
  const barsStr = `${Math.abs(Math.round(timeDiff / 60))} bars`;

  return {
    x: Math.max(p1.x, p2.x) + 8,
    y: Math.min(p1.y, p2.y) - 4,
    diff: diffStr,
    pct: pctStr,
    bars: barsStr,
  };
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">
) {
  if (d.points.length < 2) return;
  const p1 = toPixel(chart, series, d.points[0]);
  const p2 = toPixel(chart, series, d.points[1]);
  if (!p1 || !p2) return;

  const dark = isDarkMode();
  ctx.fillStyle = dark ? "rgba(229,229,229,0.05)" : "rgba(23,23,23,0.05)";
  ctx.fillRect(
    Math.min(p1.x, p2.x),
    Math.min(p1.y, p2.y),
    Math.abs(p2.x - p1.x),
    Math.abs(p2.y - p1.y)
  );
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(
    Math.min(p1.x, p2.x),
    Math.min(p1.y, p2.y),
    Math.abs(p2.x - p1.x),
    Math.abs(p2.y - p1.y)
  );
}

function drawTextAnnotation(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">
) {
  if (d.points.length < 1 || !d.text) return;
  const pix = toPixel(chart, series, d.points[0]);
  if (!pix) return;

  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = getTextColor();
  ctx.fillText(d.text, pix.x, pix.y);
}

function drawBrushStrokes(
  ctx: CanvasRenderingContext2D,
  d: Drawing
) {
  if (d.points.length < 2) return;

  ctx.beginPath();
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.moveTo(d.points[0].x, d.points[0].y);
  for (let i = 1; i < d.points.length; i++) {
    ctx.lineTo(d.points[i].x, d.points[i].y);
  }
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Preview renderers (rubber-band while second click pending)
// ---------------------------------------------------------------------------

function drawPreview(
  ctx: CanvasRenderingContext2D,
  type: DrawingType,
  startPx: { x: number; y: number },
  currentPx: { x: number; y: number },
  color: string,
  width: number,
  height: number
) {
  ctx.globalAlpha = 0.6;
  switch (type) {
    case "trendline": {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.moveTo(startPx.x, startPx.y);
      ctx.lineTo(currentPx.x, currentPx.y);
      ctx.stroke();
      break;
    }
    case "arrow": {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.moveTo(startPx.x, startPx.y);
      ctx.lineTo(currentPx.x, currentPx.y);
      ctx.stroke();
      // Arrowhead preview
      const angle = Math.atan2(currentPx.y - startPx.y, currentPx.x - startPx.x);
      const hl = 10;
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.moveTo(currentPx.x, currentPx.y);
      ctx.lineTo(currentPx.x - hl * Math.cos(angle - Math.PI / 6), currentPx.y - hl * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(currentPx.x - hl * Math.cos(angle + Math.PI / 6), currentPx.y - hl * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "hline": {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.moveTo(0, startPx.y);
      ctx.lineTo(width, startPx.y);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case "hray": {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.moveTo(startPx.x, startPx.y);
      ctx.lineTo(width, startPx.y);
      ctx.stroke();
      break;
    }
    case "vline": {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.moveTo(startPx.x, 0);
      ctx.lineTo(startPx.x, height);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case "fib": {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.moveTo(0, startPx.y);
      ctx.lineTo(width, startPx.y);
      ctx.moveTo(0, currentPx.y);
      ctx.lineTo(width, currentPx.y);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case "measure":
    case "rect": {
      const dark = isDarkMode();
      ctx.fillStyle = dark ? "rgba(229,229,229,0.06)" : "rgba(23,23,23,0.06)";
      ctx.fillRect(
        Math.min(startPx.x, currentPx.x),
        Math.min(startPx.y, currentPx.y),
        Math.abs(currentPx.x - startPx.x),
        Math.abs(currentPx.y - startPx.y)
      );
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(
        Math.min(startPx.x, currentPx.x),
        Math.min(startPx.y, currentPx.y),
        Math.abs(currentPx.x - startPx.x),
        Math.abs(currentPx.y - startPx.y)
      );
      ctx.setLineDash([]);
      break;
    }
    default:
      break;
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChartDrawings({
  chartRef,
  seriesRef,
  containerRef,
  chartSize,
}: UseChartDrawingsParams) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeTool, setActiveTool] = useState<DrawingTool>("crosshair");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [isVisible, setIsVisible] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [magnetEnabled, setMagnetEnabled] = useState(false);
  const [measureOverlays, setMeasureOverlays] = useState<MeasureOverlay[]>([]);
  const [pendingTextPoint, setPendingTextPoint] = useState<Point | null>(null);

  // Mutable refs to avoid stale closures in event handlers
  const drawingsRef = useRef<Drawing[]>([]);
  const activeToolRef = useRef<DrawingTool>("crosshair");
  const isVisibleRef = useRef(true);
  const isLockedRef = useRef(false);
  const drawingInProgress = useRef(false);
  const startPoint = useRef<Point | null>(null);
  const startPxRef = useRef<{ x: number; y: number } | null>(null);
  const brushPoints = useRef<Point[]>([]);
  const currentMousePx = useRef<{ x: number; y: number } | null>(null);
  const rafId = useRef<number | null>(null);

  // Position tracked by crosshair move (proven to work — tooltip uses same API)
  const lastCrosshairPos = useRef<{ time: number; price: number; x: number; y: number } | null>(null);

  // Current mouse pixel position on the chart canvas (for measure hover detection)
  const hoverMousePos = useRef<{ x: number; y: number } | null>(null);

  // Sync refs
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { isVisibleRef.current = isVisible; }, [isVisible]);
  useEffect(() => { isLockedRef.current = isLocked; }, [isLocked]);

  // -----------------------------------------------------------------------
  // Master redraw
  // -----------------------------------------------------------------------
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!canvas || !chart || !series) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!isVisibleRef.current) {
      setMeasureOverlays([]);
      return;
    }

    // Collect measure overlay data for hover detection
    const measureDrawingBounds: { overlay: MeasureOverlay; minX: number; minY: number; maxX: number; maxY: number }[] = [];

    for (const d of drawingsRef.current) {
      if (!d.visible || !d.points?.length) continue;
      try {
        switch (d.type) {
          case "trendline":
            drawTrendline(ctx, d, chart, series);
            break;
          case "arrow":
            drawArrow(ctx, d, chart, series);
            break;
          case "hline":
            drawHLine(ctx, d, series, w);
            break;
          case "hray":
            drawHRay(ctx, d, chart, series, w);
            break;
          case "vline":
            drawVLine(ctx, d, chart, h);
            break;
          case "fib":
            drawFibonacci(ctx, d, chart, series, w);
            break;
          case "measure": {
            const overlay = drawMeasureRect(ctx, d, chart, series);
            if (overlay && d.points.length >= 2) {
              const p1 = toPixel(chart, series, d.points[0]);
              const p2 = toPixel(chart, series, d.points[1]);
              if (p1 && p2) {
                measureDrawingBounds.push({
                  overlay,
                  minX: Math.min(p1.x, p2.x),
                  minY: Math.min(p1.y, p2.y),
                  maxX: Math.max(p1.x, p2.x),
                  maxY: Math.max(p1.y, p2.y),
                });
              }
            }
            break;
          }
          case "rect":
            drawRect(ctx, d, chart, series);
            break;
          case "text":
            drawTextAnnotation(ctx, d, chart, series);
            break;
          case "brush":
            drawBrushStrokes(ctx, d);
            break;
        }
      } catch { /* skip broken drawing */ }
    }

    // Rubber-band preview for two-point tools
    if (drawingInProgress.current && startPxRef.current && currentMousePx.current) {
      const tool = activeToolRef.current;
      if (tool !== "crosshair" && tool !== "text" && tool !== "brush") {
        drawPreview(
          ctx,
          tool as DrawingType,
          startPxRef.current,
          currentMousePx.current,
          getLineColor(),
          w,
          h
        );
      }
    }

    // In-progress brush strokes — rendered here so they survive rAF redraws
    if (drawingInProgress.current && activeToolRef.current === "brush" && brushPoints.current.length >= 2) {
      ctx.beginPath();
      ctx.strokeStyle = getLineColor();
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.6;
      ctx.moveTo(brushPoints.current[0].x, brushPoints.current[0].y);
      for (let i = 1; i < brushPoints.current.length; i++) {
        ctx.lineTo(brushPoints.current[i].x, brushPoints.current[i].y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Show measure overlays only for hovered measure drawings
    const mouse = hoverMousePos.current;
    const PAD = 4; // px padding for hover hit-test
    if (mouse) {
      const hoveredOverlays = measureDrawingBounds
        .filter(({ minX, minY, maxX, maxY }) =>
          mouse.x >= minX - PAD && mouse.x <= maxX + PAD &&
          mouse.y >= minY - PAD && mouse.y <= maxY + PAD
        )
        .map(({ overlay }) => overlay);
      setMeasureOverlays(hoveredOverlays);
    } else {
      setMeasureOverlays([]);
    }
  }, [chartRef, seriesRef]);

  // -----------------------------------------------------------------------
  // Canvas sizing
  // -----------------------------------------------------------------------
  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const chart = chartRef.current;
    const sizeEl = chart?.chartElement() ?? containerRef.current;
    if (!canvas || !sizeEl) return;

    const rect = sizeEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    redraw();
  }, [chartRef, containerRef, redraw]);

  // -----------------------------------------------------------------------
  // Core click processor — shared by all detection paths
  // -----------------------------------------------------------------------
  const processClick = useCallback((chartLocalX: number, chartLocalY: number) => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    if (isLockedRef.current) return;

    const tool = activeToolRef.current;

    // In crosshair mode: check if clicking on a measure/rect to delete it
    if (tool === "crosshair") {
      const HIT_PAD = 4;
      for (let i = drawingsRef.current.length - 1; i >= 0; i--) {
        const d = drawingsRef.current[i];
        if (!d.visible || d.points.length < 2) continue;
        if (d.type !== "measure" && d.type !== "rect") continue;
        const p1 = toPixel(chart, series, d.points[0]);
        const p2 = toPixel(chart, series, d.points[1]);
        if (!p1 || !p2) continue;
        const minX = Math.min(p1.x, p2.x) - HIT_PAD;
        const maxX = Math.max(p1.x, p2.x) + HIT_PAD;
        const minY = Math.min(p1.y, p2.y) - HIT_PAD;
        const maxY = Math.max(p1.y, p2.y) + HIT_PAD;
        if (chartLocalX >= minX && chartLocalX <= maxX && chartLocalY >= minY && chartLocalY <= maxY) {
          const removeId = d.id;
          setDrawings((prev) => prev.filter((dr) => dr.id !== removeId));
          requestAnimationFrame(() => redraw());
          return;
        }
      }
      return;
    }

    if (tool === "brush") return;

    // Convert pixel coordinates to price using chart API
    const price = (series as ISeriesApi<"Candlestick">).coordinateToPrice(chartLocalY as never);

    // Try time conversion; fall back to visible range end or now
    let time: number;
    const rawTime = chart.timeScale().coordinateToTime(chartLocalX as never);
    if (rawTime !== null && rawTime !== undefined) {
      time = rawTime as number;
    } else {
      const vr = chart.timeScale().getVisibleRange();
      time = vr ? (vr.to as number) : Math.floor(Date.now() / 1000);
    }

    // Use crosshair-tracked price if direct conversion failed
    const finalPrice = (price !== null && price !== undefined)
      ? (price as number)
      : lastCrosshairPos.current?.price ?? null;

    if (finalPrice === null) {
      return;
    }

    const pt: Point = {
      time,
      price: finalPrice,
      x: chartLocalX,
      y: chartLocalY,
    };

    // ---- One-point tools ----
    if (["hline", "hray", "vline", "text"].includes(tool)) {
      if (tool === "text") {
        setPendingTextPoint(pt);
        return;
      } else {
        setDrawings((prev) => [
          ...prev,
          { id: genId(), type: tool as DrawingType, points: [pt], color: getLineColor(), visible: true },
        ]);
      }
      requestAnimationFrame(() => redraw());
      return;
    }

    // ---- Two-point tools ----
    if (["trendline", "arrow", "fib", "measure", "rect"].includes(tool)) {
      if (!drawingInProgress.current) {
        startPoint.current = pt;
        startPxRef.current = { x: chartLocalX, y: chartLocalY };
        drawingInProgress.current = true;
      } else {
        if (!startPoint.current) return;
        const sp = { ...startPoint.current };
        drawingInProgress.current = false;
        startPoint.current = null;
        startPxRef.current = null;
        currentMousePx.current = null;
        setDrawings((prev) => [
          ...prev,
          { id: genId(), type: tool as DrawingType, points: [sp, pt], color: getLineColor(), visible: true },
        ]);
        requestAnimationFrame(() => redraw());
      }
    }
  }, [chartRef, seriesRef, redraw]);

  // -----------------------------------------------------------------------
  // Subscribe to chart for:
  //   1. Crosshair move → position tracking + rubberband preview
  //   2. Viewport changes → redraw on pan/zoom
  //
  // Click detection is handled separately via window capture listener
  // because chart.subscribeClick() proved unreliable.
  // -----------------------------------------------------------------------
  const subscribedChartRef = useRef<IChartApi | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const subscribeToChart = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return () => {};

    // Always clean up previous subscription before creating a new one.
    // (Previously a dedup guard skipped re-subscription for the same chart
    //  instance, but this caused stale subscriptions after chart rebuilds.)
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    subscribedChartRef.current = chart;

    // -- Crosshair move: track position + rubberband preview + hover --------
    const handleCrosshairMove = (param: { time?: unknown; point?: { x: number; y: number } | null }) => {
      if (param.point && series) {
        const price = (series as ISeriesApi<"Candlestick">).coordinateToPrice(param.point.y as never);
        if (price !== null && price !== undefined) {
          let time: number;
          if (param.time !== undefined && param.time !== null) {
            time = param.time as number;
          } else {
            const vr = chart.timeScale().getVisibleRange();
            time = vr ? (vr.to as number) : Math.floor(Date.now() / 1000);
          }
          lastCrosshairPos.current = {
            time,
            price: price as number,
            x: param.point.x,
            y: param.point.y,
          };
        }

        // Track mouse position for measure hover detection
        hoverMousePos.current = { x: param.point.x, y: param.point.y };
      } else {
        // Mouse left the chart area
        hoverMousePos.current = null;
      }

      // Rubberband preview for two-point tools OR hover detection refresh
      if (drawingInProgress.current && startPxRef.current && param.point) {
        currentMousePx.current = { x: param.point.x, y: param.point.y };
      }
      // Always schedule a redraw: when mouse is on chart (hover detection) or
      // when mouse left (clear hover overlays)
      if (rafId.current) cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => redraw());
    };

    // -- Viewport changes --------------------------------------------------
    const handleRangeChange = () => {
      requestAnimationFrame(() => redraw());
    };

    chart.subscribeCrosshairMove(handleCrosshairMove as never);
    chart.timeScale().subscribeVisibleTimeRangeChange(handleRangeChange);

    // -- Window-level click detection (capture phase, cannot be blocked) ----
    const chartEl = chart.chartElement();

    const handleWindowClick = (e: MouseEvent) => {
      const tool = activeToolRef.current;
      if (tool === "brush") return;

      const rect = chartEl.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;

      if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
        return;
      }

      processClick(localX, localY);
    };

    window.addEventListener("click", handleWindowClick, { capture: true });

    // -- Brush tool: window capture events (needs drag) ---------------------
    // Uses window capture phase for mousedown (same approach as click handler)
    // because chartEl's mousedown may be consumed by lightweight-charts internally.
    const handleBrushDown = (e: MouseEvent) => {
      if (isLockedRef.current) return;
      if (activeToolRef.current !== "brush") return;
      const rect = chartEl.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return;
      // Stop the event so lightweight-charts can't interfere with the drag
      e.stopPropagation();
      e.preventDefault();
      drawingInProgress.current = true;
      brushPoints.current = [{ time: 0, price: 0, x: localX, y: localY }];
    };

    const handleBrushMove = (e: MouseEvent) => {
      if (activeToolRef.current !== "brush" || !drawingInProgress.current) return;
      e.preventDefault();
      const rect = chartEl.getBoundingClientRect();
      const px = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      brushPoints.current.push({ time: 0, price: 0, x: px.x, y: px.y });
      // redraw() now handles in-progress brush strokes directly
      redraw();
    };

    const handleBrushUp = () => {
      if (activeToolRef.current !== "brush" || !drawingInProgress.current) return;
      if (brushPoints.current.length >= 2) {
        setDrawings((prev) => [
          ...prev,
          { id: genId(), type: "brush", points: [...brushPoints.current], color: getLineColor(), visible: true },
        ]);
      }
      drawingInProgress.current = false;
      brushPoints.current = [];
      requestAnimationFrame(() => redraw());
    };

    window.addEventListener("mousedown", handleBrushDown, { capture: true });
    window.addEventListener("mousemove", handleBrushMove);
    window.addEventListener("mouseup", handleBrushUp);

    // -- Cleanup -----------------------------------------------------------
    const cleanup = () => {
      try {
        chart.unsubscribeCrosshairMove(handleCrosshairMove as never);
        chart.timeScale().unsubscribeVisibleTimeRangeChange(handleRangeChange);
      } catch { /* chart may be destroyed */ }
      window.removeEventListener("click", handleWindowClick, { capture: true });
      window.removeEventListener("mousedown", handleBrushDown, { capture: true });
      window.removeEventListener("mousemove", handleBrushMove);
      window.removeEventListener("mouseup", handleBrushUp);
      if (subscribedChartRef.current === chart) {
        subscribedChartRef.current = null;
      }
      cleanupRef.current = null;
    };

    cleanupRef.current = cleanup;
    return cleanup;
  }, [chartRef, seriesRef, redraw, processClick]);

  // -----------------------------------------------------------------------
  // Observe container resize
  // -----------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      syncCanvasSize();
    });
    observer.observe(container);
    syncCanvasSize();

    return () => observer.disconnect();
  }, [containerRef, syncCanvasSize, chartSize]);

  // -----------------------------------------------------------------------
  // Redraw when drawings or visibility changes
  // -----------------------------------------------------------------------
  useEffect(() => {
    requestAnimationFrame(() => redraw());
  }, [drawings, isVisible, redraw]);

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  const clearAll = useCallback(() => {
    setDrawings([]);
    drawingInProgress.current = false;
    startPoint.current = null;
    startPxRef.current = null;
    currentMousePx.current = null;
    brushPoints.current = [];
    setMeasureOverlays([]);
  }, []);

  const toggleVisibility = useCallback(() => {
    setIsVisible((v) => !v);
  }, []);

  const toggleLock = useCallback(() => {
    setIsLocked((v) => !v);
  }, []);

  const toggleMagnet = useCallback(() => {
    setMagnetEnabled((v) => !v);
  }, []);

  const confirmTextDrawing = useCallback((text: string) => {
    const pt = pendingTextPoint;
    if (!pt || !text.trim()) {
      setPendingTextPoint(null);
      return;
    }
    setDrawings((prev) => [
      ...prev,
      { id: genId(), type: "text", points: [pt], color: getTextColor(), text: text.trim(), visible: true },
    ]);
    setPendingTextPoint(null);
    requestAnimationFrame(() => redraw());
  }, [pendingTextPoint, redraw]);

  const cancelTextDrawing = useCallback(() => {
    setPendingTextPoint(null);
  }, []);

  return {
    canvasRef,
    activeTool,
    setActiveTool,
    drawings,
    clearAll,
    toggleVisibility,
    isVisible,
    isLocked,
    toggleLock,
    redraw,
    magnetEnabled,
    toggleMagnet,
    measureOverlays,
    pendingTextPoint,
    confirmTextDrawing,
    cancelTextDrawing,
    subscribeToChart,
  };
}
