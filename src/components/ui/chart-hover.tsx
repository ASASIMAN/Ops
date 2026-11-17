"use client";

import { useState } from "react";

/**
 * Hover layer for the server-rendered SVG charts: a crosshair plus one
 * tooltip listing every series at the hovered x-position. Only the hover
 * state runs in the browser; the chart itself is static markup.
 *
 * Positions are percentages of the chart box, so the layer lines up at any
 * rendered width. Each slot's hit area is the full-height column around its
 * x, so the pointer only has to be near a point, not on it; pointer events
 * cover mouse and touch alike.
 */

export interface HoverRow {
  /** CSS colour of the series' mark; omit for rows that aren't a series. */
  color?: string;
  dashed?: boolean;
  label: string;
  value: string;
}

export interface HoverSlot {
  /** Centre of the slot, as a percentage of the chart's width. */
  xPct: number;
  title: string;
  rows: HoverRow[];
}

export function ChartHover({
  slots,
  topPct,
  bottomPct,
  crosshair = true,
  children,
}: {
  slots: HoverSlot[];
  /** Top and bottom of the plot area, as percentages of the chart's height. */
  topPct: number;
  bottomPct: number;
  crosshair?: boolean;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState<number | null>(null);
  const slot = active !== null ? slots[active] : null;

  const edges = slots.map((s, i) => {
    const left = i === 0 ? 0 : (slots[i - 1].xPct + s.xPct) / 2;
    const right = i === slots.length - 1 ? 100 : (s.xPct + slots[i + 1].xPct) / 2;
    return { left, width: right - left };
  });

  return (
    <div style={{ position: "relative" }} onPointerLeave={() => setActive(null)}>
      {children}
      {edges.map((e, i) => (
        <div
          key={i}
          onPointerEnter={() => setActive(i)}
          onPointerDown={() => setActive(i)}
          style={{ position: "absolute", top: 0, bottom: 0, left: `${e.left}%`, width: `${e.width}%` }}
        />
      ))}
      {slot && crosshair && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            pointerEvents: "none",
            left: `${slot.xPct}%`,
            top: `${topPct}%`,
            height: `${bottomPct - topPct}%`,
            borderLeft: "1px solid var(--as-ink)",
            opacity: 0.35,
          }}
        />
      )}
      {slot && (
        <div
          className="as-chart-tip"
          role="status"
          style={{
            top: `${topPct}%`,
            ...(slot.xPct > 55
              ? { right: `calc(${100 - slot.xPct}% + 10px)` }
              : { left: `calc(${slot.xPct}% + 10px)` }),
          }}
        >
          <div className="as-eyebrow mb-1">{slot.title}</div>
          {slot.rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2 py-px">
              {r.color && (
                <span
                  aria-hidden="true"
                  style={{ display: "inline-block", width: 12, borderTop: `2px ${r.dashed ? "dashed" : "solid"} ${r.color}` }}
                />
              )}
              <span className="text-muted">{r.label}</span>
              <strong className="ml-auto pl-3 font-medium">{r.value}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
