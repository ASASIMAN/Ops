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
 *
 * Pointer events (not mouse events) so this responds the same way to a
 * mouse, a trackpad, and a touch tap - one bar's "leave" is the next
 * bar's "enter" either way. The tooltip itself is never unmounted: it
 * stays put at the last hovered bar and just fades out, so moving between
 * adjacent bars reads as one tooltip gliding across rather than a flicker
 * of separate popups.
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
const TRANSITION = "150ms ease-out";

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
  // Kept separately from `hovered` so the tooltip has something to render
  // (and stay positioned at) while it fades out after the pointer leaves,
  // instead of disappearing mid-transition.
  const [lastHovered, setLastHovered] = useState<number | null>(null);

  const displayBar = (lastHovered !== null && bars[lastHovered]) || null;
  const visible = hovered !== null;

  const enter = (i: number) => {
    setHovered(i);
    setLastHovered(i);
  };
  const leave = () => setHovered(null);

  const tooltipX = displayBar
    ? clamp(
        displayBar.x + displayBar.width / 2 - TOOLTIP_W / 2,
        chartLeft,
        chartRight - TOOLTIP_W,
      )
    : 0;
  const tooltipY = displayBar
    ? Math.max(displayBar.y - TOOLTIP_H - TOOLTIP_GAP, chartTop)
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
          className="fill-zinc-700 dark:fill-zinc-300"
          style={{
            fill: hovered === i ? paletteVar("bar") : undefined,
            transition: `fill ${TRANSITION}`,
          }}
          onPointerEnter={() => enter(i)}
          onPointerLeave={leave}
        >
          {/* Accessible/no-JS fallback - the tooltip below is the primary UI. */}
          <title>
            {b.dayLabel}: {b.revenueLabel}, {b.units} units, {b.orders} orders
          </title>
        </rect>
      ))}

      {displayBar && (
        <g
          className="pointer-events-none"
          aria-hidden="true"
          style={{
            opacity: visible ? 1 : 0,
            transform: `translate(${tooltipX}px, ${tooltipY}px)`,
            transition: `opacity ${TRANSITION}, transform ${TRANSITION}`,
          }}
        >
          <rect
            width={TOOLTIP_W}
            height={TOOLTIP_H}
            rx={4}
            className="fill-zinc-900 dark:fill-zinc-100"
          />
          <text
            x={TOOLTIP_W / 2}
            y={15}
            textAnchor="middle"
            className="fill-white text-[9px] font-medium dark:fill-zinc-900"
          >
            {displayBar.dayLabel}
          </text>
          <text
            x={TOOLTIP_W / 2}
            y={27}
            textAnchor="middle"
            className="fill-white text-[9px] dark:fill-zinc-900"
          >
            {displayBar.revenueLabel}
          </text>
          <text
            x={TOOLTIP_W / 2}
            y={39}
            textAnchor="middle"
            className="fill-zinc-400 text-[8px] dark:fill-zinc-500"
          >
            {displayBar.units} units · {displayBar.orders} orders
          </text>
        </g>
      )}
    </>
  );
}
