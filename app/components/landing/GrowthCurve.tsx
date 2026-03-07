"use client";

import { useEffect, useRef, useState } from "react";

const dataPoints = [
  { month: 0, value: 1000 },
  { month: 1, value: 2427 },
  { month: 2, value: 5898 },
  { month: 3, value: 13295 },
  { month: 4, value: 31975 },
  { month: 5, value: 77316 },
  { month: 6, value: 187309 },
];

export default function GrowthCurve() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(svg);

    return () => observer.disconnect();
  }, []);

  const width = 400;
  const height = 300;
  const padding = 20;

  const maxValue = Math.max(...dataPoints.map((d) => d.value));
  const maxMonth = Math.max(...dataPoints.map((d) => d.month));

  const points = dataPoints.map((d) => ({
    x: padding + (d.month / maxMonth) * (width - padding * 2),
    y: height - padding - (d.value / maxValue) * (height - padding * 2),
  }));

  // Build smooth curve using cubic bezier
  let pathD = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx1 = prev.x + (curr.x - prev.x) * 0.5;
    const cpy1 = prev.y;
    const cpx2 = prev.x + (curr.x - prev.x) * 0.5;
    const cpy2 = curr.y;
    pathD += ` C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${curr.x} ${curr.y}`;
  }

  // Area fill path
  const areaD =
    pathD +
    ` L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="curveGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0.08" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Area fill */}
      <path
        d={areaD}
        fill="url(#curveGradient)"
        className={`transition-opacity duration-1000 ${isVisible ? "opacity-100" : "opacity-0"}`}
      />

      {/* Main curve */}
      <path
        d={pathD}
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`transition-all duration-1000 ${isVisible ? "opacity-100" : "opacity-0"}`}
        style={{
          strokeDasharray: isVisible ? "none" : "1000",
          strokeDashoffset: isVisible ? "0" : "1000",
        }}
      />

      {/* Data points */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="3"
          fill="white"
          className={`transition-opacity duration-500`}
          style={{
            opacity: isVisible ? 1 : 0,
            transitionDelay: `${i * 100 + 500}ms`,
          }}
        />
      ))}
    </svg>
  );
}
