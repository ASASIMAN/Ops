import Link from "next/link";
import { linePath, niceStep, type Point } from "@/lib/viz/chart-utils";
import { ChartHover, type HoverSlot } from "./chart-hover";

/**
 * The app's charts: plain SVG rendered on the server (no chart library),
 * with a thin client hover layer for exact values. One y-axis per chart -
 * measures on different scales get their own chart, never a second axis.
 * A `null` value is "no data" and is drawn as a gap, never as zero.
 */

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
      {items.map((s) => (
        <span key={s.label} className="flex items-center gap-2">
          <span
            aria-hidden
            style={{ display: "inline-block", width: 16, borderTop: `2px ${s.dashed ? "dashed" : "solid"} ${s.color}` }}
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/**
 * A y-axis that ends just above the data: round step (1/2/5 x 10^n) sized
 * for about five ticks, then only as many ticks as the data needs, so the
 * plot isn't left half empty the way a fixed four-step axis leaves it.
 */
function axis(maxValue: number): { step: number; ticks: number; max: number } {
  const step = niceStep(Math.max(maxValue, 1) / 5);
  const ticks = Math.max(1, Math.ceil(Math.max(maxValue, 1) / step - 1e-9));
  return { step, ticks, max: step * ticks };
}

/** Chart drawing width in SVG units. Narrow cards get a narrower drawing so axis text keeps its size instead of shrinking with the scale. */
const WIDTHS = { full: 1080, wide: 720, half: 520, third: 400 } as const;
export type ChartSize = keyof typeof WIDTHS;

/** Indexes of at most `max` evenly spread labels, always including first and last. */
function spread(n: number, max: number): Set<number> {
  if (n <= max) return new Set(Array.from({ length: n }, (_, i) => i));
  const out = new Set<number>();
  for (let k = 0; k < max; k++) out.add(Math.round((k * (n - 1)) / (max - 1)));
  return out;
}

export interface TrendSeries {
  label: string;
  color: string;
  dashed?: boolean;
  values: (number | null)[];
  /** Per-point label for the tooltip, when a series' points carry their own dates (a comparison period). */
  tipLabels?: string[];
}

export function TrendChart({
  xLabels,
  tipTitles,
  series,
  format,
  axisFormat,
  ariaLabel,
  height = 240,
  size = "wide",
}: {
  xLabels: string[];
  tipTitles: string[];
  series: TrendSeries[];
  format: (v: number) => string;
  axisFormat: (v: number) => string;
  ariaLabel: string;
  height?: number;
  size?: ChartSize;
}) {
  const W = WIDTHS[size];
  const H = height;
  const PAD = { l: 58, r: 14, t: 10, b: 24 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const n = xLabels.length;

  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const { step, ticks, max } = axis(Math.max(1, ...all));
  const tickIndexes = Array.from({ length: ticks + 1 }, (_, i) => i);
  const x = (i: number) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.t + plotH - (Math.max(0, Math.min(v, max)) / max) * plotH;

  const shown = spread(n, size === "full" ? 12 : size === "wide" ? 8 : size === "half" ? 6 : 4);
  const slots: HoverSlot[] = xLabels.map((_, i) => ({
    xPct: (x(i) / W) * 100,
    title: tipTitles[i],
    rows: series.map((s) => ({
      color: s.color,
      dashed: s.dashed,
      label: s.tipLabels?.[i] ?? s.label,
      value: s.values[i] === null || s.values[i] === undefined ? "no data" : format(s.values[i] as number),
    })),
  }));

  return (
    <div>
      <Legend items={series} />
      <ChartHover slots={slots} topPct={(PAD.t / H) * 100} bottomPct={((PAD.t + plotH) / H) * 100}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={ariaLabel}>
          {tickIndexes.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(step * t)} y2={y(step * t)} stroke={t === 0 ? "#cfcfcf" : "#ececec"} strokeWidth={1} />
              <text x={PAD.l - 8} y={y(step * t) + 3} textAnchor="end" className="as-chart-text">
                {axisFormat(step * t)}
              </text>
            </g>
          ))}
          {xLabels.map((label, i) =>
            shown.has(i) ? (
              <text
                key={i}
                x={x(i)}
                y={H - 6}
                textAnchor={i === 0 && n > 1 ? "start" : i === n - 1 && n > 1 ? "end" : "middle"}
                className="as-chart-text"
              >
                {label}
              </text>
            ) : null,
          )}
          {/* Context (dashed) series first, so identity series draw on top. */}
          {[...series]
            .sort((a, b) => Number(Boolean(b.dashed)) - Number(Boolean(a.dashed)))
            .map((s) => {
              const segments: Point[][] = [];
              let current: Point[] = [];
              s.values.forEach((v, i) => {
                if (v === null || v === undefined) {
                  if (current.length) segments.push(current);
                  current = [];
                } else current.push({ x: x(i), y: y(v) });
              });
              if (current.length) segments.push(current);
              return (
                <g key={s.label}>
                  {segments.map((seg, k) =>
                    seg.length === 1 ? (
                      <circle key={k} cx={seg[0].x} cy={seg[0].y} r={3} fill={s.color} />
                    ) : (
                      <path
                        key={k}
                        d={linePath(seg)}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={s.dashed ? 1.5 : 2}
                        strokeDasharray={s.dashed ? "4 4" : undefined}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    ),
                  )}
                </g>
              );
            })}
        </svg>
      </ChartHover>
    </div>
  );
}

export interface ColumnStack {
  label: string;
  color: string;
  values: (number | null)[];
}

/** Columns per period; several `stacks` sit on top of each other (parts of one total). */
export function ColumnChart({
  xLabels,
  tipTitles,
  stacks,
  format,
  axisFormat,
  ariaLabel,
  height = 220,
  size = "wide",
  missingNote,
}: {
  xLabels: string[];
  tipTitles: string[];
  stacks: ColumnStack[];
  format: (v: number) => string;
  axisFormat: (v: number) => string;
  ariaLabel: string;
  height?: number;
  size?: ChartSize;
  /** Tooltip text for a part with no data in a period. */
  missingNote?: string;
}) {
  const W = WIDTHS[size];
  const H = height;
  const PAD = { l: 58, r: 14, t: 10, b: 24 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const n = xLabels.length;

  const totals = xLabels.map((_, i) => stacks.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0));
  const { step, ticks, max } = axis(Math.max(1, ...totals));
  const tickIndexes = Array.from({ length: ticks + 1 }, (_, i) => i);
  const slot = plotW / Math.max(n, 1);
  const barW = Math.min(34, slot * 0.62);
  const cx = (i: number) => PAD.l + slot * (i + 0.5);
  const h = (v: number) => (Math.max(0, Math.min(v, max)) / max) * plotH;
  const base = PAD.t + plotH;
  const shown = spread(n, size === "full" ? 18 : size === "wide" ? 12 : size === "half" ? 6 : 4);

  const slots: HoverSlot[] = xLabels.map((_, i) => ({
    xPct: (cx(i) / W) * 100,
    title: tipTitles[i],
    rows: [
      ...stacks.map((s) => ({
        color: s.color,
        label: s.label,
        value: s.values[i] === null || s.values[i] === undefined ? (missingNote ?? "no data") : format(s.values[i] as number),
      })),
      ...(stacks.length > 1 && stacks.every((s) => s.values[i] !== null && s.values[i] !== undefined)
        ? [{ label: "Total", value: format(totals[i]) }]
        : []),
    ],
  }));

  return (
    <div>
      <Legend items={stacks} />
      <ChartHover slots={slots} topPct={(PAD.t / H) * 100} bottomPct={(base / H) * 100} crosshair={false}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={ariaLabel}>
          {tickIndexes.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={base - h(step * t)} y2={base - h(step * t)} stroke={t === 0 ? "#cfcfcf" : "#ececec"} strokeWidth={1} />
              <text x={PAD.l - 8} y={base - h(step * t) + 3} textAnchor="end" className="as-chart-text">
                {axisFormat(step * t)}
              </text>
            </g>
          ))}
          {xLabels.map((label, i) => {
            let top = base;
            return (
              <g key={i}>
                {stacks.map((s) => {
                  const v = s.values[i];
                  if (v === null || v === undefined || v <= 0) return null;
                  const height = h(v);
                  top -= height;
                  // 2px surface gap between stacked parts.
                  const gap = top + height < base - 0.5 ? 2 : 0;
                  return (
                    <rect
                      key={s.label}
                      x={cx(i) - barW / 2}
                      y={top}
                      width={barW}
                      height={Math.max(0, height - gap)}
                      fill={s.color}
                    />
                  );
                })}
                {shown.has(i) && (
                  <text x={cx(i)} y={H - 6} textAnchor="middle" className="as-chart-text">
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </ChartHover>
    </div>
  );
}

export interface BarRow {
  key: string;
  label: string;
  /** Second line under the label. */
  sub?: string;
  value: number;
  valueText: string;
  /** Extra right-hand figure (e.g. the change vs last period). */
  aside?: React.ReactNode;
  href?: string;
}

/** Ranked horizontal bars: one nominal series, so one colour and no legend. */
export function BarList({ rows, color = "#3f6b2a" }: { rows: BarRow[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const inner = (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <span className="min-w-0">
                <span className="block truncate text-[0.8125rem]">{r.label}</span>
                {r.sub && <span className="block truncate text-xs text-muted">{r.sub}</span>}
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="block text-[0.8125rem]">{r.valueText}</span>
                {r.aside && <span className="block text-xs text-muted">{r.aside}</span>}
              </span>
            </div>
            <div className="as-bar mt-2">
              <span style={{ width: `${Math.max(0, (r.value / max) * 100)}%`, background: color }} />
            </div>
          </>
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} className="block px-5 py-3 hover:bg-surface-2">
                {inner}
              </Link>
            ) : (
              <div className="px-5 py-3">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
