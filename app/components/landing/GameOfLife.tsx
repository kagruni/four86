"use client";

import { useRef, useEffect, useCallback } from "react";

interface GameOfLifeProps {
  cellSize?: number;
  opacity?: number;
  cellColor?: string;
  bgColor?: string;
  className?: string;
}

export default function GameOfLife({
  cellSize = 5,
  opacity = 0.25,
  cellColor = "#ffffff",
  bgColor = "#000000",
  className = "",
}: GameOfLifeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<Uint8Array | null>(null);
  const nextGridRef = useRef<Uint8Array | null>(null);
  const colsRef = useRef(0);
  const rowsRef = useRef(0);
  const animFrameRef = useRef<number>(0);
  const lastFrameTimeRef = useRef(0);
  const frameCountRef = useRef(0);
  const lastPopulationRef = useRef(0);
  const stableCountRef = useRef(0);
  const isVisibleRef = useRef(true);

  const initGrid = useCallback(
    (cols: number, rows: number): Uint8Array => {
      const grid = new Uint8Array(cols * rows);
      const density = 0.25;
      for (let i = 0; i < grid.length; i++) {
        grid[i] = Math.random() < density ? 1 : 0;
      }
      return grid;
    },
    []
  );

  const countNeighbors = useCallback(
    (grid: Uint8Array, cols: number, rows: number, x: number, y: number): number => {
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = (x + dx + cols) % cols;
          const ny = (y + dy + rows) % rows;
          count += grid[ny * cols + nx];
        }
      }
      return count;
    },
    []
  );

  const step = useCallback(
    (grid: Uint8Array, nextGrid: Uint8Array, cols: number, rows: number) => {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const idx = y * cols + x;
          const neighbors = countNeighbors(grid, cols, rows, x, y);
          const alive = grid[idx];
          if (alive) {
            nextGrid[idx] = neighbors === 2 || neighbors === 3 ? 1 : 0;
          } else {
            nextGrid[idx] = neighbors === 3 ? 1 : 0;
          }
        }
      }
    },
    [countNeighbors]
  );

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, grid: Uint8Array, cols: number, rows: number) => {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillStyle = cellColor;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (grid[y * cols + x]) {
            ctx.fillRect(x * cellSize, y * cellSize, cellSize - 1, cellSize - 1);
          }
        }
      }
    },
    [cellSize, cellColor, bgColor]
  );

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    const cols = Math.floor(rect.width / cellSize);
    const rows = Math.floor(rect.height / cellSize);
    colsRef.current = cols;
    rowsRef.current = rows;

    gridRef.current = initGrid(cols, rows);
    nextGridRef.current = new Uint8Array(cols * rows);
    frameCountRef.current = 0;
    stableCountRef.current = 0;
  }, [cellSize, initGrid]);

  useEffect(() => {
    setupCanvas();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const targetInterval = 66; // ~15fps

    const animate = (timestamp: number) => {
      animFrameRef.current = requestAnimationFrame(animate);

      if (!isVisibleRef.current) return;
      if (timestamp - lastFrameTimeRef.current < targetInterval) return;
      lastFrameTimeRef.current = timestamp;

      const grid = gridRef.current;
      const nextGrid = nextGridRef.current;
      const cols = colsRef.current;
      const rows = rowsRef.current;
      if (!grid || !nextGrid || cols === 0 || rows === 0) return;

      // Draw current state
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, grid, cols, rows);
      ctx.restore();

      // Advance simulation
      step(grid, nextGrid, cols, rows);

      // Check population for auto-reseed
      frameCountRef.current++;
      if (frameCountRef.current % 60 === 0) {
        let population = 0;
        for (let i = 0; i < nextGrid.length; i++) {
          population += nextGrid[i];
        }
        const totalCells = cols * rows;
        const populationRatio = population / totalCells;

        if (population === lastPopulationRef.current) {
          stableCountRef.current++;
        } else {
          stableCountRef.current = 0;
        }
        lastPopulationRef.current = population;

        // Reseed if population too low or stable for too long
        if (populationRatio < 0.02 || stableCountRef.current >= 3) {
          gridRef.current = initGrid(cols, rows);
          nextGridRef.current = new Uint8Array(cols * rows);
          stableCountRef.current = 0;
          return;
        }
      }

      // Swap grids
      gridRef.current = nextGrid;
      nextGridRef.current = grid;
    };

    animFrameRef.current = requestAnimationFrame(animate);

    // Intersection Observer
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry.isIntersecting;
      },
      { threshold: 0.1 }
    );
    observer.observe(canvas);

    // Resize handler
    const handleResize = () => {
      setupCanvas();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [setupCanvas, draw, step, initGrid]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 ${className}`}
      style={{ opacity }}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}
