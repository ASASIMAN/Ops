import { ChartHover, type HoverSlot } from "@/components/ui/chart-hover";
import { idr, idrCompact } from "@/lib/biz/format";
import { linePath, niceStep, type Point } from "@/lib/viz/chart-utils";
import { ASASI_PALETTE, CONTEXT_SERIES_COLOR } from "@/lib/viz/palette";

/**
 * One core item over the next 12 months, as two stacked plots that share
 * the month axis (never two y-scales on one plot):
 *   top    - months of stock on hand: with no extra marketing (grey,
 *            dashed) and with the planned pushes (olive), against the
 *            target (dashed rule); stock above target is shaded as the pile.
 *   bottom - planned extra spend per month: approved (solid) and awaiting
 *            approval (hatched), plus the "ask by" marker.
 */

export const COLORS = {
  plan: ASASI_PALETTE[0].light,
  baseline: CONTEXT_SERIES_COLOR,
  target: "#5b5b5b",
  pile: ASASI_PALETTE[1].light,
};

export interface CoverChartProps {
  id: string;
  label: string;
  monthLabels: string[];
  tipTitles: string[];
  season: number[];
  baselineCover: (number | null)[];
  baselineStock: number[];
  /** null when the item has no live pushes (the line would sit on top of the baseline). */
  planCover: (number | null)[] | null;
  planStock: number[] | null;
  base: number[];
  extra: number[];
  incoming: number[];
  target: number;
  spendApproved: number[];
  spendPending: number[];
  askIndex: number | null;
}

const W = 520;
const PAD = { l: 46, r: 12 };
const COVER = { top: 10, bottom: 186 };
const MONTH_Y = 202;
const ASK_Y = 222;
const SPEND = { top: 230, bottom: 282 };
const H = 292;

const units = (v: number) => `${Math.round(v).toLocaleString("en-US")} units`;
const months1 = (v: number) => `${v.toFixed(1)} months`;
const rp = idr;
const rpShort = idrCompact;

export function CoverChart(p: CoverChartProps) {
  const n = p.monthLabels.length;
  const plotW = W - PAD.l - PAD.r;
  const slotW = plotW / n;
  const x = (i: number) => PAD.l + slotW * (i + 0.5);

  const coverValues = [...p.baselineCover, ...(p.planCover ?? [])].filter((v): v is number => v !== null);
  const coverMaxRaw = Math.max(p.target * 1.3, ...coverValues, 1);
  const step = niceStep(coverMaxRaw / 4);
  const ticks = Math.max(1, Math.ceil(coverMaxRaw / step - 1e-9));
  const coverMax = step * ticks;
  const yc = (v: number) => COVER.bottom - (Math.max(0, Math.min(v, coverMax)) / coverMax) * (COVER.bottom - COVER.top);

  const spendTotals = p.spendApproved.map((a, i) => a + p.spendPending[i]);
  const spendMax = Math.max(...spendTotals, 0);
  const spendScale = spendMax > 0 ? niceStep(spendMax / 2) * Math.ceil(spendMax / niceStep(spendMax / 2) - 1e-9) : 1;
  const ys = (v: number) => SPEND.bottom - (v / spendScale) * (SPEND.bottom - SPEND.top);

  const line = (values: (number | null)[]): Point[][] => {
    const segments: Point[][] = [];
    let cur: Point[] = [];
    values.forEach((v, i) => {
      if (v === null) {
        if (cur.length) segments.push(cur);
        cur = [];
      } else cur.push({ x: x(i), y: yc(v) });
    });
    if (cur.length) segments.push(cur);
    return segments;
  };
  const baselineSegments = line(p.baselineCover);
  const planSegments = p.planCover ? line(p.planCover) : [];
  const targetY = yc(p.target);
  const clipId = `pile-${p.id}`;
  const hatchId = `hatch-${p.id}`;

  const slots: HoverSlot[] = p.monthLabels.map((_, i) => {
    const rows: HoverSlot["rows"] = [
      {
        color: COLORS.baseline,
        dashed: true,
        label: "No extra marketing",
        value: p.baselineCover[i] === null ? "no data" : `${months1(p.baselineCover[i]!)} · ${units(p.baselineStock[i])}`,
      },
    ];
    if (p.planCover && p.planStock)
      rows.push({
        color: COLORS.plan,
        label: "With planned pushes",
        value: p.planCover[i] === null ? "no data" : `${months1(p.planCover[i]!)} · ${units(p.planStock[i])}`,
      });
    rows.push({ color: COLORS.target, dashed: true, label: "Target", value: months1(p.target) });
    rows.push({ label: "Normal sales this month", value: units(p.base[i]) });
    if (p.extra[i] > 0) rows.push({ label: "Extra from pushes", value: `+${units(p.extra[i])}` });
    if (p.incoming[i] > 0) rows.push({ label: "Arriving (open POs)", value: units(p.incoming[i]) });
    if (spendTotals[i] > 0)
      rows.push({
        label: "Planned extra spend",
        value: [p.spendApproved[i] > 0 ? `${rp(p.spendApproved[i])} approved` : "", p.spendPending[i] > 0 ? `${rp(p.spendPending[i])} awaiting` : ""]
          .filter(Boolean)
          .join(" · "),
      });
    rows.push({ label: "Tourist season", value: `×${p.season[i].toFixed(2)}` });
    if (p.askIndex === i) rows.push({ label: "Ask for budget", value: "by this month" });
    return { xPct: (x(i) / W) * 100, title: p.tipTitles[i], rows };
  });

  const pileArea = baselineSegments.map((seg) => `${linePath(seg)} L${seg[seg.length - 1].x},${COVER.bottom} L${seg[0].x},${COVER.bottom} Z`).join(" ");
  const summary = p.baselineCover
    .map((v, i) => (v === null ? null : `${p.tipTitles[i]}: ${v.toFixed(1)} months`))
    .filter(Boolean)
    .join("; ");

  return (
    <ChartHover slots={slots} topPct={(COVER.top / H) * 100} bottomPct={(SPEND.bottom / H) * 100}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`${p.label}: months of stock over the next year against a ${p.target.toFixed(1)}-month target. ${summary}`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.l} y={COVER.top} width={plotW} height={Math.max(0, targetY - COVER.top)} />
          </clipPath>
          <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="#ffffff" />
            <line x1="0" y1="0" x2="0" y2="5" stroke={COLORS.plan} strokeWidth="2.2" />
          </pattern>
        </defs>

        {/* Months-of-stock grid */}
        {Array.from({ length: ticks + 1 }, (_, t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yc(step * t)} y2={yc(step * t)} stroke={t === 0 ? "#cfcfcf" : "#ececec"} strokeWidth={1} />
            <text x={PAD.l - 8} y={yc(step * t) + 3} textAnchor="end" className="as-chart-text">
              {step * t % 1 === 0 ? step * t : (step * t).toFixed(1)}
            </text>
          </g>
        ))}

        {/* The pile: stock above target with no extra marketing */}
        <path d={pileArea} fill={COLORS.pile} fillOpacity={0.2} clipPath={`url(#${clipId})`} />
        <line x1={PAD.l} x2={W - PAD.r} y1={targetY} y2={targetY} stroke={COLORS.target} strokeWidth={1.25} strokeDasharray="5 4" />

        {baselineSegments.map((seg, k) =>
          seg.length === 1 ? (
            <circle key={k} cx={seg[0].x} cy={seg[0].y} r={4} fill={COLORS.baseline} />
          ) : (
            <path key={k} d={linePath(seg)} fill="none" stroke={COLORS.baseline} strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
          ),
        )}
        {planSegments.map((seg, k) =>
          seg.length === 1 ? (
            <circle key={k} cx={seg[0].x} cy={seg[0].y} r={4} fill={COLORS.plan} />
          ) : (
            <path key={k} d={linePath(seg)} fill="none" stroke={COLORS.plan} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          ),
        )}

        {p.monthLabels.map((m, i) => (
          <text key={i} x={x(i)} y={MONTH_Y} textAnchor="middle" className="as-chart-text">
            {m}
          </text>
        ))}

        {/* Planned extra spend */}
        <line x1={PAD.l} x2={W - PAD.r} y1={SPEND.bottom} y2={SPEND.bottom} stroke="#cfcfcf" strokeWidth={1} />
        <text x={PAD.l - 8} y={SPEND.bottom + 3} textAnchor="end" className="as-chart-text">
          Rp 0
        </text>
        {spendMax > 0 && (
          <>
            <line x1={PAD.l} x2={W - PAD.r} y1={SPEND.top} y2={SPEND.top} stroke="#ececec" strokeWidth={1} />
            <text x={PAD.l - 8} y={SPEND.top + 3} textAnchor="end" className="as-chart-text">
              {rpShort(spendScale)}
            </text>
          </>
        )}
        {spendMax === 0 && (
          <text x={W - PAD.r} y={SPEND.bottom - 8} textAnchor="end" className="as-chart-text">
            No extra spend planned
          </text>
        )}
        {p.monthLabels.map((_, i) => {
          const bw = Math.min(18, slotW * 0.5);
          const approvedTop = ys(p.spendApproved[i]);
          const pendingTop = ys(spendTotals[i]);
          return (
            <g key={i}>
              {p.spendApproved[i] > 0 && (
                <rect x={x(i) - bw / 2} y={approvedTop} width={bw} height={SPEND.bottom - approvedTop} fill={COLORS.plan} />
              )}
              {p.spendPending[i] > 0 && (
                <rect
                  x={x(i) - bw / 2}
                  y={pendingTop}
                  width={bw}
                  height={Math.max(1, approvedTop - pendingTop - (p.spendApproved[i] > 0 ? 2 : 0))}
                  fill={`url(#${hatchId})`}
                  stroke={COLORS.plan}
                  strokeWidth={1}
                />
              )}
            </g>
          );
        })}

        {p.askIndex !== null && (
          <g>
            <line x1={x(p.askIndex)} x2={x(p.askIndex)} y1={ASK_Y + 4} y2={SPEND.bottom} stroke={COLORS.pile} strokeWidth={1.5} strokeDasharray="3 3" />
            <path d={`M${x(p.askIndex) - 5},${ASK_Y - 4} L${x(p.askIndex) + 5},${ASK_Y - 4} L${x(p.askIndex)},${ASK_Y + 3} Z`} fill={COLORS.pile} />
            <text
              x={x(p.askIndex) + (p.askIndex > n - 3 ? -9 : 9)}
              y={ASK_Y + 2}
              textAnchor={p.askIndex > n - 3 ? "end" : "start"}
              className="as-chart-text"
              style={{ fill: "#1c1c1c" }}
            >
              Ask by
            </text>
          </g>
        )}
      </svg>
    </ChartHover>
  );
}
