"use client";

import {
  Crosshair,
  TrendingUp,
  Minus,
  ArrowRight,
  SeparatorVertical,
  Ruler,
  Square,
  Type,
  Pencil,
  Magnet,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Trash2,
  ZoomIn,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Fibonacci icon — custom SVG since lucide doesn't have one
// ---------------------------------------------------------------------------

function FibIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <line x1="2" y1="2" x2="14" y2="2" />
      <line x1="2" y1="5.7" x2="14" y2="5.7" strokeDasharray="2 1.5" />
      <line x1="2" y1="8" x2="14" y2="8" strokeDasharray="2 1.5" />
      <line x1="2" y1="10.3" x2="14" y2="10.3" strokeDasharray="2 1.5" />
      <line x1="2" y1="14" x2="14" y2="14" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DrawingTool =
  | "crosshair"
  | "trendline"
  | "hline"
  | "hray"
  | "vline"
  | "fib"
  | "measure"
  | "rect"
  | "text"
  | "brush";

export interface ChartToolbarProps {
  activeTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  magnetEnabled: boolean;
  onToggleMagnet: () => void;
  isLocked: boolean;
  onToggleLock: () => void;
  isVisible: boolean;
  onToggleVisibility: () => void;
  onClearAll: () => void;
  onFitChart: () => void;
  height?: number;
}

// ---------------------------------------------------------------------------
// Toolbar button helper
// ---------------------------------------------------------------------------

function ToolBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1 rounded transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function ActionBtn({
  onClick,
  title,
  children,
  destructive,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1 rounded transition-colors ${
        destructive
          ? "text-muted-foreground hover:text-red-500 hover:bg-muted"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-4 border-t border-border my-0.5" />;
}

// ---------------------------------------------------------------------------
// ChartToolbar Component
// ---------------------------------------------------------------------------

const ICON = "h-3.5 w-3.5";

export default function ChartToolbar({
  activeTool,
  onToolChange,
  magnetEnabled,
  onToggleMagnet,
  isLocked,
  onToggleLock,
  isVisible,
  onToggleVisibility,
  onClearAll,
  onFitChart,
  height,
}: ChartToolbarProps) {
  return (
    <div
      className="hidden md:flex flex-col items-center w-[34px] border-r border-border bg-background py-1 gap-0 shrink-0 overflow-y-auto overflow-x-hidden scrollbar-none"
      style={height ? { maxHeight: height, height } : undefined}
    >
      {/* Group 1: Pointer */}
      <ToolBtn
        active={activeTool === "crosshair"}
        onClick={() => onToolChange("crosshair")}
        title="Crosshair"
      >
        <Crosshair className={ICON} />
      </ToolBtn>

      <Divider />

      {/* Group 2: Line tools */}
      <ToolBtn
        active={activeTool === "trendline"}
        onClick={() => onToolChange("trendline")}
        title="Trend Line"
      >
        <TrendingUp className={ICON} />
      </ToolBtn>
      <ToolBtn
        active={activeTool === "hline"}
        onClick={() => onToolChange("hline")}
        title="Horizontal Line"
      >
        <Minus className={ICON} />
      </ToolBtn>
      <ToolBtn
        active={activeTool === "hray"}
        onClick={() => onToolChange("hray")}
        title="Horizontal Ray"
      >
        <ArrowRight className={ICON} />
      </ToolBtn>
      <ToolBtn
        active={activeTool === "vline"}
        onClick={() => onToolChange("vline")}
        title="Vertical Line"
      >
        <SeparatorVertical className={ICON} />
      </ToolBtn>

      <Divider />

      {/* Group 3: Fibonacci */}
      <ToolBtn
        active={activeTool === "fib"}
        onClick={() => onToolChange("fib")}
        title="Fibonacci Retracement"
      >
        <FibIcon className={ICON} />
      </ToolBtn>

      <Divider />

      {/* Group 4: Measurement */}
      <ToolBtn
        active={activeTool === "measure"}
        onClick={() => onToolChange("measure")}
        title="Price Range / Measure"
      >
        <Ruler className={ICON} />
      </ToolBtn>

      <Divider />

      {/* Group 5: Shapes */}
      <ToolBtn
        active={activeTool === "rect"}
        onClick={() => onToolChange("rect")}
        title="Rectangle"
      >
        <Square className={ICON} />
      </ToolBtn>

      <Divider />

      {/* Group 6: Text */}
      <ToolBtn
        active={activeTool === "text"}
        onClick={() => onToolChange("text")}
        title="Text Annotation"
      >
        <Type className={ICON} />
      </ToolBtn>

      <Divider />

      {/* Group 7: Brush */}
      <ToolBtn
        active={activeTool === "brush"}
        onClick={() => onToolChange("brush")}
        title="Freehand Brush"
      >
        <Pencil className={ICON} />
      </ToolBtn>

      <Divider />

      {/* Bottom utility tools */}
      <ToolBtn
        active={magnetEnabled}
        onClick={onToggleMagnet}
        title="Magnet Mode"
      >
        <Magnet className={ICON} />
      </ToolBtn>
      <ToolBtn
        active={isLocked}
        onClick={onToggleLock}
        title={isLocked ? "Unlock Drawings" : "Lock Drawings"}
      >
        {isLocked ? <Lock className={ICON} /> : <Unlock className={ICON} />}
      </ToolBtn>
      <ActionBtn
        onClick={onToggleVisibility}
        title={isVisible ? "Hide Drawings" : "Show Drawings"}
      >
        {isVisible ? <Eye className={ICON} /> : <EyeOff className={ICON} />}
      </ActionBtn>
      <ActionBtn onClick={onClearAll} title="Remove All Drawings" destructive>
        <Trash2 className={ICON} />
      </ActionBtn>
      <ActionBtn onClick={onFitChart} title="Zoom to Fit">
        <ZoomIn className={ICON} />
      </ActionBtn>
    </div>
  );
}
