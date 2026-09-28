"use client";

import { useState } from "react";
import { paletteVar } from "@/lib/viz/palette";

/**
 * The interactive part of the "Sales over time" chart - everything else
 * (gridlines, axis labels, the <svg> wrapper) stays in the server-rendered
 * page since it doesn't need state. This is its own client component
 * because hover state is the only reason any of this chart needs the
 * client at all - keeping it small means the rest of /operations (a big
 * page) stays a server component.
 *
 * Rendered as a plain fragment of SVG children, meant to sit inside the
 * parent page's <svg viewBox="0 0 CHART_W CHART_H">, so its coordinates
 * are in that same user-unit space, not screen pixels - that's what lets
 * the tooltip stay correctly placed regardless of how wide the chart is
 * actually rendered (it's responsive, `h-auto w-full`).
 */

interface Bar {
  day: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dayLabel: string;
  revenueLabel: string;
  units: number;
  orders: number;
}

const TOOLTIP_W = 130;
const TOOLTIP_H = 46;
const TOOLTIP_GAP = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function SalesOverTimeBars({
  bars,
  chartLeft,
  chartRight,
  chartTop,
}: {
  bars: Bar[];
  chartLeft: number;
  chartRight: number;
  chartTop: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const hoveredBar = hovered !== null ? bars[hovered] : null;

  const tooltipX = hoveredBar
    ? clamp(
        hoveredBar.x + hoveredBar.width / 2 - TOOLTIP_W / 2,
        chartLeft,
        chartRight - TOOLTIP_W,
      )
    : 0;
  const tooltipY = hoveredBar
    ? Math.max(hoveredBar.y - TOOLTIP_H - TOOLTIP_GAP, chartTop)
    : 0;

  return (
    <>
      {bars.map((b, i) => (
        <rect
          key={b.day}
          x={b.x}
          y={b.y}
          width={b.width}
          height={b.height}
          className={
            hovered === i
              ? undefined
              : "fill-zinc-700 dark:fill-zinc-300"
          }
          style={hovered === i ? { fill: paletteVar("bar") } : undefined}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
        >
          {/* Accessible/no-JS fallback - the tooltip below is the primary UI. */}
          <title>
            {b.dayLabel}: {b.revenueLabel}, {b.units} units, {b.orders} orders
          </title>
        </rect>
      ))}

      {hoveredBar && (
        <g className="pointer-events-none" aria-hidden="true">
          <rect
            x={tooltipX}
            y={tooltipY}
            width={TOOLTIP_W}
            height={TOOLTIP_H}
            rx={4}
            className="fill-zinc-900 dark:fill-zinc-100"
          />
          <text
            x={tooltipX + TOOLTIP_W / 2}
            y={tooltipY + 15}
            textAnchor="middle"
            className="fill-white text-[9px] font-medium dark:fill-zinc-900"
          >
            {hoveredBar.dayLabel}
          </text>
          <text
            x={tooltipX + TOOLTIP_W / 2}
            y={tooltipY + 27}
            textAnchor="middle"
            className="fill-white text-[9px] dark:fill-zinc-900"
          >
            {hoveredBar.revenueLabel}
          </text>
          <text
            x={tooltipX + TOOLTIP_W / 2}
            y={tooltipY + 39}
            textAnchor="middle"
            className="fill-zinc-400 text-[8px] dark:fill-zinc-500"
          >
            {hoveredBar.units} units · {hoveredBar.orders} orders
          </text>
        </g>
      )}
    </>
  );
}
