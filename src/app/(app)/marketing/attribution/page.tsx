import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const CHANNEL_LABELS: Record<string, string> = {
  walkin_member_count: "Members",
  walkin_instagram_count: "Instagram",
  walkin_tiktok_count: "TikTok",
  walkin_google_maps_count: "Google Maps",
  walkin_walking_by_count: "Walking by",
  walkin_friend_referral_count: "Friend referral",
  walkin_chatgpt_count: "ChatGPT",
  walkin_wa_business_count: "WA Business",
};
const CHANNEL_ORDER = Object.keys(CHANNEL_LABELS);

// Validated categorical palette (dataviz skill), fixed slot order - light/dark.
const CHANNEL_COLORS: Record<string, { light: string; dark: string }> = {
  walkin_member_count: { light: "#2a78d6", dark: "#3987e5" },
  walkin_instagram_count: { light: "#eb6834", dark: "#d95926" },
  walkin_tiktok_count: { light: "#1baf7a", dark: "#199e70" },
  walkin_google_maps_count: { light: "#eda100", dark: "#c98500" },
  walkin_walking_by_count: { light: "#e87ba4", dark: "#d55181" },
  walkin_friend_referral_count: { light: "#008300", dark: "#008300" },
  walkin_chatgpt_count: { light: "#4a3aa7", dark: "#9085e9" },
  walkin_wa_business_count: { light: "#e34948", dark: "#e66767" },
};

interface MonthData {
  date: string;
  metrics: Record<string, number>;
}

const CHART_WIDTH = 720;
const CHART_HEIGHT = 300;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

function buildLineChart(months: MonthData[]) {
  const plotW = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const maxTotal = Math.max(...months.map((m) => m.metrics.walkin_total_count ?? 0), 1);
  // round up to a clean step for gridlines
  const step = Math.ceil(maxTotal / 4 / 50) * 50 || 50;
  const yMax = step * 4;

  const x = (i: number) => PAD_LEFT + (months.length > 1 ? (i / (months.length - 1)) * plotW : 0);
  const y = (v: number) => PAD_TOP + plotH - (v / yMax) * plotH;

  const totalArea = (() => {
    const points = months.map((m, i) => `${x(i)},${y(m.metrics.walkin_total_count ?? 0)}`);
    return `M ${PAD_LEFT},${y(0)} L ${points.join(" L ")} L ${x(months.length - 1)},${y(0)} Z`;
  })();

  const channelPaths = CHANNEL_ORDER.map((metric) => {
    // break the line at gaps rather than interpolating through missing months
    const segments: string[] = [];
    let current: string[] = [];
    months.forEach((m, i) => {
      const v = m.metrics[metric];
      if (v === undefined) {
        if (current.length) segments.push(`M ${current.join(" L ")}`);
        current = [];
      } else {
        current.push(`${x(i)},${y(v)}`);
      }
    });
    if (current.length) segments.push(`M ${current.join(" L ")}`);
    return { metric, d: segments.join(" ") };
  });

  const xLabels = months
    .map((m, i) => ({ i, label: MONTH_LABEL.format(new Date(m.date + "T00:00:00Z")) }))
    .filter((_, i) => i === 0 || i === months.length - 1 || i % 3 === 0);

  const yTicks = [0, step, step * 2, step * 3, step * 4];

  return { plotW, plotH, x, y, yMax, totalArea, channelPaths, xLabels, yTicks };
}

export default async function AttributionPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const admin = createAdminClient();

  const [{ data: rows }, { data: geoRows }] = await Promise.all([
    admin
      .from("facts_daily")
      .select("date, metric, value")
      .eq("source", "visitor_attribution_sheet")
      .order("date", { ascending: true }),
    admin
      .from("visitor_geography")
      .select("location, approx_visitors, pct_share")
      .order("approx_visitors", { ascending: false }),
  ]);

  const byMonth = new Map<string, MonthData>();
  for (const row of rows ?? []) {
    if (!byMonth.has(row.date)) byMonth.set(row.date, { date: row.date, metrics: {} });
    byMonth.get(row.date)!.metrics[row.metric] = Number(row.value);
  }
  const months = Array.from(byMonth.values()).sort((a, b) => a.date.localeCompare(b.date));
  const selected = months.find((m) => m.date === monthParam) ?? months[months.length - 1];
  const selectedIndex = months.findIndex((m) => m.date === selected?.date);
  const prior = selectedIndex > 0 ? months[selectedIndex - 1] : undefined;

  const channels = selected
    ? CHANNEL_ORDER.map((metric) => ({
        metric,
        label: CHANNEL_LABELS[metric],
        count: selected.metrics[metric],
      })).filter((c) => c.count !== undefined)
    : [];
  const maxCount = Math.max(...channels.map((c) => c.count), 1);
  const total = selected?.metrics.walkin_total_count;

  const chart = months.length > 1 ? buildLineChart(months) : null;

  // Average mix across all months with data - same method the source
  // sheet's own "Avg Visits/Month" % share uses (mean ignores months
  // where that channel wasn't tracked, not treated as zero).
  const mix = CHANNEL_ORDER.map((metric) => {
    const values = months.map((m) => m.metrics[metric]).filter((v) => v !== undefined) as number[];
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    return { metric, label: CHANNEL_LABELS[metric], avg };
  }).filter((c) => c.avg > 0);
  const mixTotal = mix.reduce((sum, c) => sum + c.avg, 0);
  const sortedMix = mix.slice().sort((a, b) => b.avg - a.avg);
  const pieSlices = sortedMix.reduce<
    { metric: string; label: string; avg: number; pct: number; start: number; end: number }[]
  >((acc, c) => {
    const pct = mixTotal ? (c.avg / mixTotal) * 100 : 0;
    const start = acc.length ? acc[acc.length - 1].end : 0;
    acc.push({ ...c, pct, start, end: start + pct });
    return acc;
  }, []);
  const conicStops = pieSlices
    .map((s) => `var(--wc-${s.metric}) ${s.start.toFixed(2)}% ${s.end.toFixed(2)}%`)
    .join(", ");

  const colorVarStyle = Object.fromEntries(
    Object.entries(CHANNEL_COLORS).map(([metric, c]) => [`--wc-${metric}`, c.light]),
  ) as React.CSSProperties;
  const colorVarDarkClasses = Object.entries(CHANNEL_COLORS)
    .map(([metric, c]) => `dark:[--wc-${metric}:${c.dark}]`)
    .join(" ");

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Attribution &amp; Visitors</h1>
        <Link href="/marketing" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50">
          ← Marketing
        </Link>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        What customers say brought them in, self-reported in store. Real monthly counts, not
        derived from Meta or Google Maps data - there&apos;s no per-channel platform number yet
        to check this against (see the Insights page).
      </p>

      {months.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-600 dark:text-zinc-400">No attribution data yet.</p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
            {months
              .slice()
              .reverse()
              .map((m) => (
                <Link
                  key={m.date}
                  href={`/marketing/attribution?month=${m.date}`}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    m.date === selected.date
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                      : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
                  }`}
                >
                  {MONTH_LABEL.format(new Date(m.date + "T00:00:00Z"))}
                </Link>
              ))}
          </div>

          {chart && (
            <div className={`mt-8 ${colorVarDarkClasses}`} style={colorVarStyle}>
              <h2 className="text-lg font-medium">Monthly trend by channel</h2>
              <svg
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                className="mt-2 w-full h-auto"
                role="img"
                aria-label="Walk-in attribution by channel, monthly"
              >
                {chart.yTicks.map((t) => (
                  <g key={t}>
                    <line
                      x1={PAD_LEFT}
                      x2={CHART_WIDTH - PAD_RIGHT}
                      y1={chart.y(t)}
                      y2={chart.y(t)}
                      stroke="currentColor"
                      className="text-zinc-200 dark:text-zinc-800"
                      strokeWidth={1}
                    />
                    <text
                      x={PAD_LEFT - 6}
                      y={chart.y(t) + 3}
                      textAnchor="end"
                      className="fill-zinc-400 text-[9px]"
                    >
                      {t}
                    </text>
                  </g>
                ))}
                <path d={chart.totalArea} fill="currentColor" className="text-zinc-400" opacity={0.12} />
                {chart.channelPaths.map((p) => (
                  <path
                    key={p.metric}
                    d={p.d}
                    fill="none"
                    stroke={`var(--wc-${p.metric})`}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
                {chart.xLabels.map(({ i, label }) => (
                  <text
                    key={i}
                    x={chart.x(i)}
                    y={CHART_HEIGHT - PAD_BOTTOM + 16}
                    textAnchor="middle"
                    className="fill-zinc-400 text-[9px]"
                  >
                    {label}
                  </text>
                ))}
              </svg>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {CHANNEL_ORDER.map((metric) => (
                  <span key={metric} className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: `var(--wc-${metric})` }}
                    />
                    {CHANNEL_LABELS[metric]}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-zinc-400">
                Shaded area is the monthly total. Lines break where a channel wasn&apos;t tracked
                that month, rather than joining across the gap.
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-zinc-500 hover:underline">
                  Table view
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[600px] text-left text-xs">
                    <thead>
                      <tr className="text-zinc-500">
                        <th className="px-2 py-1">Month</th>
                        {CHANNEL_ORDER.map((metric) => (
                          <th key={metric} className="px-2 py-1 text-right">
                            {CHANNEL_LABELS[metric]}
                          </th>
                        ))}
                        <th className="px-2 py-1 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {months.map((m) => (
                        <tr key={m.date} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="px-2 py-1">
                            {MONTH_LABEL.format(new Date(m.date + "T00:00:00Z"))}
                          </td>
                          {CHANNEL_ORDER.map((metric) => (
                            <td key={metric} className="px-2 py-1 text-right">
                              {m.metrics[metric] ?? "-"}
                            </td>
                          ))}
                          <td className="px-2 py-1 text-right">{m.metrics.walkin_total_count ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}

          {pieSlices.length > 0 && (
            <div className={`mt-8 ${colorVarDarkClasses}`} style={colorVarStyle}>
              <h2 className="text-lg font-medium">Channel mix (average across all months)</h2>
              <div className="mt-3 flex flex-wrap items-center gap-6">
                <div
                  className="h-40 w-40 shrink-0 rounded-full"
                  style={{ background: `conic-gradient(${conicStops})` }}
                  role="img"
                  aria-label="Average walk-in attribution mix by channel"
                />
                <ul className="space-y-1 text-sm">
                  {pieSlices.map((s) => (
                    <li key={s.metric} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: `var(--wc-${s.metric})` }}
                      />
                      <span className="text-zinc-600 dark:text-zinc-400">{s.label}</span>
                      <span className="text-zinc-400">
                        {s.pct.toFixed(1)}% ({s.avg.toFixed(1)} avg/mo)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="mt-8">
            <h2 className="text-lg font-medium">
              {MONTH_LABEL.format(new Date(selected.date + "T00:00:00Z"))}
              {total !== undefined && (
                <span className="ml-2 text-sm font-normal text-zinc-500">{total} total</span>
              )}
            </h2>
            <div className="mt-3 space-y-2">
              {channels.map((c) => {
                const priorCount = prior?.metrics[c.metric];
                const delta =
                  priorCount !== undefined && priorCount !== 0
                    ? Math.round(((c.count - priorCount) / priorCount) * 100)
                    : null;
                return (
                  <div key={c.metric} className="text-xs">
                    <div className="flex justify-between text-zinc-500">
                      <span>{c.label}</span>
                      <span>
                        {c.count}
                        {delta !== null && (
                          <span className="ml-1">
                            ({delta > 0 ? "+" : ""}
                            {delta}% MoM)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mt-0.5 h-3 bg-zinc-100 dark:bg-zinc-900">
                      <div
                        className="h-3 bg-zinc-700 dark:bg-zinc-400"
                        style={{ width: `${(c.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {CHANNEL_ORDER.some((metric) => selected.metrics[metric] === undefined) && (
              <p className="mt-3 text-xs text-zinc-500">
                Some channels (ChatGPT, WA Business) weren&apos;t tracked as categories before
                April &apos;26 - not shown for earlier months rather than shown as zero.
              </p>
            )}
          </div>
        </>
      )}

      {geoRows && geoRows.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-medium">Visitor geography</h2>
          <p className="mt-1 text-xs text-zinc-500">
            A point-in-time snapshot, not tied to a specific month - the source doesn&apos;t say
            what period it covers.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-zinc-500">
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2 text-right">Approx. visitors</th>
                  <th className="px-3 py-2 text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {geoRows.map((g) => (
                  <tr key={g.location} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-2">{g.location}</td>
                    <td className="px-3 py-2 text-right">{g.approx_visitors}</td>
                    <td className="px-3 py-2 text-right">{g.pct_share}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
