"use client";

import { useState } from "react";

/**
 * The interactive part of the "Sales over time" chart - everything else
 * (gridlines, the two series' lines/areas/dots, axis labels, the <svg>
 * wrapper) stays in the server-rendered page since it's static. This is
 * its own client component because hover state is the only reason any of
 * it needs to run client-side - keeping it small means the rest of
 * /operations (a big page) stays a server component.
 *
 * Rendered as a plain fragment of SVG children, meant to sit inside the
 * parent page's <svg viewBox="0 0 CHART_W CHART_H">, so its coordinates
 * are in that same user-unit space, not screen pixels - that's what lets
 * the crosshair and tooltip stay correctly placed regardless of how wide
 * the chart is actually rendered (it's responsive, `h-auto w-full`).
 *
 * One invisible hit-test column per day (not per line point) is what
 * makes hovering reliable on a line chart - the pointer only has to be
 * somewhere in that day's vertical slice, not exactly on the line. Pointer
 * events (not mouse events) so this responds the same way to a mouse, a
 * trackpad, and a touch tap.
 */

interface ChartDay {
  x: number;
  currentY: number | null;
  previousY: number | null;
  currentLabel: string;
  previousLabel: string;
  currentValueLabel: string;
  previousValueLabel: string | null; // null = no comparison period at all
  currentUnits: number | null;
  currentOrders: number | null;
  previousUnits: number | null;
  previousOrders: number | null;
}

const TOOLTIP_W = 150;
const TOOLTIP_GAP = 10;
const TRANSITION = "150ms ease-out";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function SalesOverTimeChart({
  days,
  daySlot,
  chartLeft,
  chartRight,
  chartTop,
  chartBottom,
  currentColor,
  previousColor,
}: {
  days: ChartDay[];
  daySlot: number;
  chartLeft: number;
  chartRight: number;
  chartTop: number;
  chartBottom: number;
  currentColor: string;
  previousColor: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  // Kept separately from `hovered` so the crosshair/tooltip have something
  // to render (and stay positioned at) while they fade out after the
  // pointer leaves, instead of disappearing mid-transition.
  const [lastHovered, setLastHovered] = useState<number | null>(null);

  const displayDay = lastHovered !== null ? days[lastHovered] : null;
  const visible = hovered !== null;

  const enter = (i: number) => {
    setHovered(i);
    setLastHovered(i);
  };
  const leave = () => setHovered(null);

  const hasPrevious = displayDay?.previousValueLabel !== null;
  const tooltipRows = hasPrevious ? 2 : 1;
  const tooltipH = 16 + tooltipRows * 15 + 6;

  const tooltipX = displayDay
    ? clamp(displayDay.x - TOOLTIP_W / 2, chartLeft, chartRight - TOOLTIP_W)
    : 0;
  // Sits above whichever series is higher (smaller y) that day, so it
  // never overlaps either line's marker.
  const topmostY = displayDay
    ? Math.min(
        displayDay.currentY ?? chartBottom,
        displayDay.previousY ?? chartBottom,
      )
    : 0;
  const tooltipY = displayDay
    ? Math.max(topmostY - tooltipH - TOOLTIP_GAP, chartTop)
    : 0;

  return (
    <>
      {days.map((d, i) => (
        <rect
          key={i}
          x={d.x - daySlot / 2}
          y={chartTop}
          width={daySlot}
          height={chartBottom - chartTop}
          fill="transparent"
          onPointerEnter={() => enter(i)}
          onPointerLeave={leave}
        />
      ))}

      {displayDay && (
        <g
          style={{
            opacity: visible ? 1 : 0,
            transition: `opacity ${TRANSITION}`,
          }}
        >
          <g
            className="pointer-events-none"
            style={{
              transform: `translate(${displayDay.x}px, 0)`,
              transition: `transform ${TRANSITION}`,
            }}
          >
            <line
              x1={0}
              x2={0}
              y1={chartTop}
              y2={chartBottom}
              stroke="currentColor"
              className="text-zinc-300 dark:text-zinc-700"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {displayDay.currentY !== null && (
              <circle
                cx={0}
                cy={displayDay.currentY}
                r={4}
                style={{ fill: currentColor }}
                className="stroke-white dark:stroke-zinc-950"
                strokeWidth={1.5}
              />
            )}
            {displayDay.previousY !== null && (
              <circle
                cx={0}
                cy={displayDay.previousY}
                r={4}
                style={{ fill: previousColor }}
                className="stroke-white dark:stroke-zinc-950"
                strokeWidth={1.5}
              />
            )}
          </g>

          <g
            className="pointer-events-none"
            aria-hidden="true"
            style={{
              transform: `translate(${tooltipX}px, ${tooltipY}px)`,
              transition: `transform ${TRANSITION}`,
            }}
          >
            <rect
              width={TOOLTIP_W}
              height={tooltipH}
              rx={4}
              className="fill-zinc-900 dark:fill-zinc-100"
            />
            <text
              x={8}
              y={14}
              className="fill-zinc-400 text-[8px] uppercase tracking-wide dark:fill-zinc-500"
            >
              {displayDay.currentLabel}
            </text>
            <circle
              cx={11}
              cy={26}
              r={3}
              style={{ fill: currentColor }}
            />
            <text
              x={18}
              y={29}
              className="fill-white text-[9px] font-medium dark:fill-zinc-900"
            >
              {displayDay.currentValueLabel}
              {displayDay.currentUnits !== null &&
                ` · ${displayDay.currentUnits} units · ${displayDay.currentOrders} orders`}
            </text>
            {hasPrevious && (
              <>
                <circle
                  cx={11}
                  cy={41}
                  r={3}
                  style={{ fill: previousColor }}
                />
                <text
                  x={18}
                  y={44}
                  className="fill-zinc-300 text-[9px] dark:fill-zinc-600"
                >
                  {displayDay.previousLabel}: {displayDay.previousValueLabel}
                  {displayDay.previousUnits !== null &&
                    ` · ${displayDay.previousUnits} units`}
                </text>
              </>
            )}
          </g>
        </g>
      )}
    </>
  );
}
