"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Crosshair,
  TrendingUp,
  Minus,
  ArrowRight,
  SeparatorVertical,
  MoveUpRight,
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
  ChevronRight,
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
  | "arrow"
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
// Tool definitions & groups
// ---------------------------------------------------------------------------

interface ToolDef {
  tool: DrawingTool;
  icon: (cls: string) => React.ReactNode;
  title: string;
}

const ALL_TOOLS: Record<DrawingTool, ToolDef> = {
  crosshair: { tool: "crosshair", icon: (c) => <Crosshair className={c} />, title: "Crosshair" },
  trendline: { tool: "trendline", icon: (c) => <TrendingUp className={c} />, title: "Trend Line" },
  arrow:     { tool: "arrow",     icon: (c) => <MoveUpRight className={c} />, title: "Arrow" },
  hline:     { tool: "hline",     icon: (c) => <Minus className={c} />, title: "Horizontal Line" },
  hray:      { tool: "hray",      icon: (c) => <ArrowRight className={c} />, title: "Horizontal Ray" },
  vline:     { tool: "vline",     icon: (c) => <SeparatorVertical className={c} />, title: "Vertical Line" },
  fib:       { tool: "fib",       icon: (c) => <FibIcon className={c} />, title: "Fibonacci Retracement" },
  measure:   { tool: "measure",   icon: (c) => <Ruler className={c} />, title: "Price Range / Measure" },
  rect:      { tool: "rect",      icon: (c) => <Square className={c} />, title: "Rectangle" },
  text:      { tool: "text",      icon: (c) => <Type className={c} />, title: "Text Annotation" },
  brush:     { tool: "brush",     icon: (c) => <Pencil className={c} />, title: "Freehand Brush" },
};

const ICON_MAIN = "h-5 w-5";
const ICON_FLYOUT = "h-4 w-4";
const ICON_UTIL = "h-5 w-5";

interface ToolGroup {
  id: string;
  tools: DrawingTool[];
}

const TOOL_GROUPS: ToolGroup[] = [
  { id: "pointer",     tools: ["crosshair"] },
  { id: "lines",       tools: ["trendline", "arrow", "hline", "hray", "vline"] },
  { id: "fib",         tools: ["fib", "measure"] },
  { id: "shapes",      tools: ["rect"] },
  { id: "text",        tools: ["text"] },
  { id: "brush",       tools: ["brush"] },
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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
      className={`p-1.5 rounded transition-colors ${
        destructive
          ? "text-muted-foreground hover:text-red-500 hover:bg-muted"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

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
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-6 border-t border-border my-0.5" />;
}

// ---------------------------------------------------------------------------
// Flyout portal — renders at document.body so no parent overflow clips it.
// Uses `fixed` positioning relative to viewport.
// ---------------------------------------------------------------------------

function FlyoutPortal({
  anchorRef,
  tools,
  activeTool,
  onSelect,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  tools: DrawingTool[];
  activeTool: DrawingTool;
  onSelect: (tool: DrawingTool) => void;
  onClose: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position next to the anchor — fixed coords (viewport-relative)
  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      top: rect.top,
      left: rect.right + 6,
    });
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (
        flyoutRef.current &&
        !flyoutRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose, anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={flyoutRef}
      className="fixed z-[9999] flex flex-col gap-0.5 border border-border bg-background shadow-lg rounded-md py-1 px-1"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {tools.map((toolId) => {
        const td = ALL_TOOLS[toolId];
        const isActive = activeTool === toolId;
        return (
          <button
            key={toolId}
            type="button"
            onClick={() => onSelect(toolId)}
            title={td.title}
            className={`flex items-center gap-3 px-3 py-1.5 rounded text-xs whitespace-nowrap transition-colors ${
              isActive
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {td.icon(ICON_FLYOUT)}
            <span>{td.title}</span>
          </button>
        );
      })}
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// ToolGroupButton — a single toolbar slot that may expand into a flyout.
//
// Layout:
//   Default:  [ icon ]
//   Hover:    [ icon | > ]  — chevron appears on right, full height
//
// Clicking the icon area → activates the tool.
// Clicking the chevron area → opens the flyout.
// ---------------------------------------------------------------------------

function ToolGroupButton({
  group,
  activeTool,
  selectedTool,
  onToolChange,
}: {
  group: ToolGroup;
  activeTool: DrawingTool;
  selectedTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
}) {
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseInFlyout = useRef(false);
  const hasMultiple = group.tools.length > 1;

  const isGroupActive = group.tools.includes(activeTool);
  const faceTool = isGroupActive ? activeTool : selectedTool;
  const def = ALL_TOOLS[faceTool];

  const showChevron = hasMultiple && (hovered || flyoutOpen);

  // Cancel any pending close
  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // Schedule a close after a short delay — gives user time to move to flyout
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (!mouseInFlyout.current) {
        setHovered(false);
        setFlyoutOpen(false);
      }
    }, 150);
  }, [cancelClose]);

  useEffect(() => {
    return () => cancelClose();
  }, [cancelClose]);

  const handleMainClick = useCallback(() => {
    onToolChange(faceTool);
  }, [faceTool, onToolChange]);

  const handleExpandClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setFlyoutOpen((prev) => !prev);
  }, []);

  const handleFlyoutSelect = useCallback(
    (tool: DrawingTool) => {
      onToolChange(tool);
      setFlyoutOpen(false);
      mouseInFlyout.current = false;
    },
    [onToolChange]
  );

  const closeFlyout = useCallback(() => {
    setFlyoutOpen(false);
    mouseInFlyout.current = false;
  }, []);

  const handleFlyoutMouseEnter = useCallback(() => {
    mouseInFlyout.current = true;
    cancelClose();
  }, [cancelClose]);

  const handleFlyoutMouseLeave = useCallback(() => {
    mouseInFlyout.current = false;
    scheduleClose();
  }, [scheduleClose]);

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setHovered(true);
      }}
      onMouseLeave={() => {
        scheduleClose();
      }}
    >
      <div
        className={`flex items-stretch rounded transition-colors ${
          isGroupActive
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
      >
        {/* Icon area — click to activate tool */}
        <button
          type="button"
          onClick={handleMainClick}
          title={def.title}
          className="flex items-center justify-center p-1.5"
        >
          {def.icon(ICON_MAIN)}
        </button>

        {/* Chevron area — click to open flyout, full button height, visible on hover */}
        {showChevron && (
          <button
            type="button"
            onClick={handleExpandClick}
            className={`flex items-center justify-center pl-0 pr-0.5 border-l ${
              isGroupActive
                ? "border-background/30 text-background/70 hover:text-background"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* Flyout rendered via portal */}
      {flyoutOpen && hasMultiple && (
        <FlyoutPortal
          anchorRef={containerRef}
          tools={group.tools}
          activeTool={activeTool}
          onSelect={handleFlyoutSelect}
          onClose={closeFlyout}
          onMouseEnter={handleFlyoutMouseEnter}
          onMouseLeave={handleFlyoutMouseLeave}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChartToolbar Component
// ---------------------------------------------------------------------------

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
  const [selectedPerGroup, setSelectedPerGroup] = useState<Record<string, DrawingTool>>(() => {
    const initial: Record<string, DrawingTool> = {};
    for (const g of TOOL_GROUPS) {
      initial[g.id] = g.tools[0];
    }
    return initial;
  });

  useEffect(() => {
    for (const g of TOOL_GROUPS) {
      if (g.tools.includes(activeTool)) {
        setSelectedPerGroup((prev) => {
          if (prev[g.id] === activeTool) return prev;
          return { ...prev, [g.id]: activeTool };
        });
        break;
      }
    }
  }, [activeTool]);

  return (
    <div
      className="hidden md:flex flex-col items-center w-[62px] border-r border-border bg-background py-1 gap-0 shrink-0"
      style={height ? { height } : undefined}
    >
      {TOOL_GROUPS.map((group, idx) => (
        <div key={group.id}>
          {idx > 0 && <Divider />}
          <ToolGroupButton
            group={group}
            activeTool={activeTool}
            selectedTool={selectedPerGroup[group.id]}
            onToolChange={onToolChange}
          />
        </div>
      ))}

      <Divider />

      {/* Bottom utility tools */}
      <ToolBtn
        active={magnetEnabled}
        onClick={onToggleMagnet}
        title="Magnet Mode"
      >
        <Magnet className={ICON_UTIL} />
      </ToolBtn>
      <ToolBtn
        active={isLocked}
        onClick={onToggleLock}
        title={isLocked ? "Unlock Drawings" : "Lock Drawings"}
      >
        {isLocked ? <Lock className={ICON_UTIL} /> : <Unlock className={ICON_UTIL} />}
      </ToolBtn>
      <ActionBtn
        onClick={onToggleVisibility}
        title={isVisible ? "Hide Drawings" : "Show Drawings"}
      >
        {isVisible ? <Eye className={ICON_UTIL} /> : <EyeOff className={ICON_UTIL} />}
      </ActionBtn>
      <ActionBtn onClick={onClearAll} title="Remove All Drawings" destructive>
        <Trash2 className={ICON_UTIL} />
      </ActionBtn>
      <ActionBtn onClick={onFitChart} title="Zoom to Fit">
        <ZoomIn className={ICON_UTIL} />
      </ActionBtn>
    </div>
  );
}
