import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInsights } from "@/lib/insights";
import { forecast, type Period } from "@/lib/forecast/engine";
import { linePath, bandPath, niceStep, type Point } from "@/lib/viz/chart-utils";
import { paletteCss, paletteVar } from "@/lib/viz/palette";
import { buildSeasonIndex, fetchArrivals, EVEN_SHARE_PCT } from "@/lib/tourism/seasonality";
import { formatRupiahCompact } from "@/lib/creative-brief/format";

export const dynamic = "force-dynamic";

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH_ONLY_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});
const MONTH_NAME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  timeZone: "UTC",
});
function monthName(month1to12: number): string {
  return MONTH_NAME_FORMATTER.format(new Date(Date.UTC(2000, month1to12 - 1, 1)));
}

const modules = [
  { href: "/marketing/creative-brief", label: "Creative Brief", status: "live" as const },
  { href: "/marketing/paid-media", label: "Paid Media", status: "live" as const },
  { href: "/marketing/attribution", label: "Attribution & Visitors", status: "live" as const },
  { href: "/marketing/financials", label: "Financials", status: "live" as const },
  { href: "/marketing/import", label: "Data Import", status: "live" as const },
  { href: "/marketing/campaigns", label: "Campaign Tracker", status: "live" as const },
  { href: "/marketing/tasks", label: "Tasks", status: "live" as const },
  { href: "/marketing/creative", label: "Creative Planner", status: "live" as const },
  { href: "/marketing/kols", label: "KOL CRM", status: "live" as const },
  { href: "/marketing/organic-social", label: "Organic Social", status: "live" as const },
  { href: "/marketing/insights", label: "Insights", status: "live" as const },
  { href: "/marketing/settings", label: "Settings", status: "live" as const },
  { href: null, label: "Web & Ecom", status: "soon" as const },
  { href: null, label: "Retail & Local", status: "soon" as const },
];

interface MonthMetrics {
  date: string;
  metrics: Record<string, number>;
}

interface AdSnapshotRow {
  ad_id: number;
  reporting_start: string;
  reporting_end: string;
  last_significant_edit: string | null;
  results: number | null;
  cost_per_results: number | null;
  purchases: number | null;
  cost_per_purchase_idr: number | null;
  ads: { ad_name: string } | null;
}

interface AdTileEntry {
  name: string;
  caption: string;
  href: string;
}

function fmtIdr(v: number | undefined) {
  return v === undefined ? "-" : currencyFormatter.format(v);
}

function deltaLabel(current: number | undefined, prior: number | undefined) {
  if (current === undefined || prior === undefined || prior === 0) return null;
  const pct = Math.round(((current - prior) / prior) * 100);
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

function Kpi({
  label,
  value,
  mom,
  yoy,
  note,
}: {
  label: string;
  value: string;
  mom?: string | null;
  yoy?: string | null;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="mt-1 flex gap-2 text-xs text-zinc-500">
        {mom && <span>MoM {mom}</span>}
        {yoy && <span>YoY {yoy}</span>}
        {!mom && !yoy && note && <span>{note}</span>}
      </div>
    </div>
  );
}

function AdPulseTile({
  lastAd,
  bestAd,
  bestAdMonthLabel,
}: {
  lastAd: AdTileEntry | null;
  bestAd: AdTileEntry | null;
  bestAdMonthLabel: string | null;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">Ads pulse</div>
      <div className="mt-2 space-y-2.5">
        <div>
          <div className="text-[11px] text-zinc-500">Last ad (all time)</div>
          {lastAd ? (
            <>
              <Link
                href={lastAd.href}
                className="block truncate text-sm font-medium hover:underline"
                title={lastAd.name}
              >
                {lastAd.name}
              </Link>
              <div className="text-xs text-zinc-500">{lastAd.caption}</div>
            </>
          ) : (
            <div className="text-sm text-zinc-400">-</div>
          )}
        </div>
        <div>
          <div className="text-[11px] text-zinc-500">
            Best ad{bestAdMonthLabel ? ` (${bestAdMonthLabel})` : ""}
          </div>
          {bestAd ? (
            <>
              <Link
                href={bestAd.href}
                className="block truncate text-sm font-medium hover:underline"
                title={bestAd.name}
              >
                {bestAd.name}
              </Link>
              <div className="text-xs text-zinc-500">{bestAd.caption}</div>
            </>
          ) : (
            <div className="text-sm text-zinc-400">
              {bestAdMonthLabel ? "no results data that period" : "-"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type Status = "good" | "attention" | "neutral";

const statusStyles: Record<Status, { badge: string; card: string; label: string }> = {
  good: {
    badge: "bg-emerald-600 text-white dark:bg-emerald-500",
    card: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30",
    label: "On track",
  },
  attention: {
    badge: "bg-amber-500 text-white dark:bg-amber-600",
    card: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
    label: "Needs attention",
  },
  neutral: {
    badge: "bg-zinc-400 text-white dark:bg-zinc-600",
    card: "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50",
    label: "No signal yet",
  },
};

function StatusTile({
  title,
  status,
  caption,
  href,
}: {
  title: string;
  status: Status;
  caption: string;
  href: string;
}) {
  const s = statusStyles[status];
  return (
    <Link
      href={href}
      className={`block rounded-xl border p-5 transition hover:opacity-90 ${s.card}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${s.badge}`}>
          {s.label}
        </span>
      </div>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{caption}</p>
    </Link>
  );
}

function Hero({
  label,
  value,
  deltaText,
  deltaStatus,
}: {
  label: string;
  value: string;
  deltaText?: string;
  deltaStatus?: Status;
}) {
  const deltaColor = deltaStatus
    ? {
        good: "text-emerald-600 dark:text-emerald-500",
        attention: "text-amber-600 dark:text-amber-500",
        neutral: "text-zinc-500",
      }[deltaStatus]
    : "text-zinc-500";
  return (
    <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="mt-1 text-4xl font-semibold tracking-tight">{value}</div>
      {deltaText && <div className={`mt-2 text-sm font-medium ${deltaColor}`}>{deltaText}</div>}
    </div>
  );
}

export default async function MarketingOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string }>;
}) {
  const { month: monthParam, view } = await searchParams;
  const isSimple = view === "simple";
  const supabase = createAdminClient();

  const [{ data: factRows }, { data: ecomRows }, { active: attentionItems, good: goodItems }, arrivalRows] =
    await Promise.all([
      supabase
        .from("facts_daily")
        .select("date, metric, value")
        .eq("source", "financials_sheet")
        .order("date", { ascending: true }),
      supabase
        .from("facts_daily")
        .select("date, metric, value")
        .eq("source", "ecom_breakdown_sheet")
        .order("date", { ascending: true }),
      getInsights(),
      fetchArrivals(supabase),
    ]);

  const byMonth = new Map<string, MonthMetrics>();
  for (const row of [...(factRows ?? []), ...(ecomRows ?? [])]) {
    if (!byMonth.has(row.date)) byMonth.set(row.date, { date: row.date, metrics: {} });
    byMonth.get(row.date)!.metrics[row.metric] = Number(row.value);
  }
  const months = Array.from(byMonth.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  // Real in-store (offline) revenue, from the actual Odoo POS sync
  // (order_lines/orders - same tables /operations reads), not the
  // financials sheet's "Instore Sales" column, which is an order COUNT,
  // not revenue - multiplying a count by some assumed average price
  // would be fabricating a number no one measured. Bucketed into the
  // same WITA-calendar months /operations itself uses. A month with no
  // bucket here genuinely has no synced Odoo data for that period (sync
  // started partway through this app's history) - not a zero month.
  const offlineRevenueByMonth = new Map<string, number>();
  if (months.length) {
    const { data: dailySales, error: dailySalesError } = await supabase.rpc("ops_sales_daily", {
      p_from: `${months[0].date}T00:00:00+08:00`,
      p_to: new Date().toISOString(),
    });
    if (!dailySalesError) {
      for (const row of (dailySales ?? []) as { day: string; revenue: number }[]) {
        const monthKey = `${row.day.slice(0, 7)}-01`;
        offlineRevenueByMonth.set(
          monthKey,
          (offlineRevenueByMonth.get(monthKey) ?? 0) + Number(row.revenue),
        );
      }
    }
    for (const m of months) {
      const offline = offlineRevenueByMonth.get(m.date);
      if (offline !== undefined) m.metrics.offline_sales_idr_real = offline;
    }
  }
  const hasOfflineRevenueData = offlineRevenueByMonth.size > 0;

  const selected =
    months.find((m) => m.date === monthParam) ?? months[months.length - 1];
  const selectedIndex = months.findIndex((m) => m.date === selected?.date);
  const prior = selectedIndex > 0 ? months[selectedIndex - 1] : undefined;
  const yoyDate = selected
    ? `${Number(selected.date.slice(0, 4)) - 1}${selected.date.slice(4)}`
    : undefined;
  const yoy = months.find((m) => m.date === yoyDate);

  const metaRoas =
    selected?.metrics.meta_ad_spend_idr && selected?.metrics.online_sales_idr
      ? selected.metrics.online_sales_idr / selected.metrics.meta_ad_spend_idr
      : undefined;

  // "Last ad" and "Best ad" pull from the real Meta Ads Manager imports
  // (ad_performance_snapshots), a separate dataset from the financials
  // sheet above - run after the Promise.all since the second query
  // depends on the first (the most recent reporting period).
  const { data: lastEditRows } = await supabase
    .from("ad_performance_snapshots")
    .select(
      "ad_id, reporting_start, reporting_end, last_significant_edit, results, cost_per_results, purchases, cost_per_purchase_idr, ads ( ad_name )",
    )
    .not("last_significant_edit", "is", null)
    // Several ads are often edited in the same bulk action and share an
    // identical timestamp - among ties for "most recently edited", the
    // tie-break favours whichever was cheapest per result, so this
    // doesn't resolve to an arbitrary row.
    .order("last_significant_edit", { ascending: false })
    .order("cost_per_results", { ascending: true, nullsFirst: false })
    .limit(1);
  const lastEditSnapshot = (lastEditRows?.[0] ?? null) as unknown as AdSnapshotRow | null;

  const { data: latestPeriodRow } = await supabase
    .from("ad_performance_snapshots")
    .select("reporting_end")
    .order("reporting_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  let bestLastMonthSnapshot: AdSnapshotRow | null = null;
  let bestAdMonthLabel: string | null = null;
  if (latestPeriodRow) {
    bestAdMonthLabel = MONTH_LABEL.format(
      new Date(latestPeriodRow.reporting_end + "T00:00:00Z"),
    );
    const { data: periodSnapshots } = await supabase
      .from("ad_performance_snapshots")
      .select(
        "ad_id, reporting_start, reporting_end, last_significant_edit, results, cost_per_results, purchases, cost_per_purchase_idr, ads ( ad_name )",
      )
      .eq("reporting_end", latestPeriodRow.reporting_end);
    const rows = (periodSnapshots ?? []) as unknown as AdSnapshotRow[];

    // Prefer ranking by results/cost-per-result (this export tracks
    // checkout-initiate as "Results" - see the Paid Media CSV adapter
    // notes); fall back to purchases/CPA for older imports that had a
    // real Purchases column instead.
    const byResults = rows
      .filter((r) => (r.results ?? 0) > 0 && r.cost_per_results !== null)
      .sort((a, b) => Number(a.cost_per_results) - Number(b.cost_per_results));
    const byPurchases = rows
      .filter((r) => (r.purchases ?? 0) > 0 && r.cost_per_purchase_idr !== null)
      .sort((a, b) => Number(a.cost_per_purchase_idr) - Number(b.cost_per_purchase_idr));
    bestLastMonthSnapshot = byResults[0] ?? byPurchases[0] ?? null;
  }

  function adSnapshotToEntry(s: AdSnapshotRow | null, metricCaption: (s: AdSnapshotRow) => string): AdTileEntry | null {
    if (!s || !s.ads) return null;
    return {
      name: s.ads.ad_name,
      caption: metricCaption(s),
      href: `/marketing/paid-media?start=${s.reporting_start}&end=${s.reporting_end}`,
    };
  }

  const lastAdEntry = adSnapshotToEntry(lastEditSnapshot, (s) =>
    s.last_significant_edit
      ? `edited ${new Date(s.last_significant_edit).toLocaleDateString()}`
      : "",
  );
  const bestAdEntry = adSnapshotToEntry(bestLastMonthSnapshot, (s) =>
    s.results !== null && s.cost_per_results !== null
      ? `${s.results} result${s.results === 1 ? "" : "s"} · ${currencyFormatter.format(Number(s.cost_per_results))}/result`
      : `${s.purchases} purchase${s.purchases === 1 ? "" : "s"} · ${currencyFormatter.format(Number(s.cost_per_purchase_idr))} CPA`,
  );

  const tileAreas = [
    { key: "financials", title: "Budget & Spend", hrefPrefix: "/marketing/financials" },
    { key: "content", title: "Content Pipeline", hrefPrefix: "/marketing/creative" },
    { key: "kols", title: "KOLs", hrefPrefix: "/marketing/kols" },
  ];
  const tiles = tileAreas.map((area) => {
    const bad = attentionItems.find((i) => i.href.startsWith(area.hrefPrefix));
    const goodItem = goodItems.find((i) => i.href.startsWith(area.hrefPrefix));
    const status: Status = bad ? "attention" : goodItem ? "good" : "neutral";
    const caption = bad?.text ?? goodItem?.text ?? "Nothing computable here yet.";
    return { ...area, status, caption, href: bad?.href ?? goodItem?.href ?? area.hrefPrefix };
  });

  const salesMom = deltaLabel(selected?.metrics.online_sales_idr, prior?.metrics.online_sales_idr);
  const salesMomNum =
    selected?.metrics.online_sales_idr && prior?.metrics.online_sales_idr
      ? selected.metrics.online_sales_idr - prior.metrics.online_sales_idr
      : undefined;
  const salesStatus: Status =
    salesMomNum === undefined ? "neutral" : salesMomNum >= 0 ? "good" : "attention";

  const budgetPercent = selected?.metrics.total_budget_idr
    ? Math.round((selected.metrics.total_spend_idr / selected.metrics.total_budget_idr) * 100)
    : undefined;
  const budgetStatus: Status =
    budgetPercent === undefined
      ? "neutral"
      : budgetPercent > 110
        ? "attention"
        : budgetPercent < 70
          ? "neutral"
          : "good";

  if (isSimple) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Marketing — At a glance</h1>
          <Link
            href={monthParam ? `/marketing?month=${monthParam}` : "/marketing"}
            className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
          >
            Detailed view →
          </Link>
        </div>
        {selected && (
          <p className="mt-1 text-sm text-zinc-500">
            {MONTH_LABEL.format(new Date(selected.date + "T00:00:00Z"))}
          </p>
        )}

        {!selected ? (
          <p className="mt-8 text-sm text-zinc-600 dark:text-zinc-400">No data yet.</p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Hero
              label="Online sales"
              value={fmtIdr(selected.metrics.online_sales_idr)}
              deltaText={salesMom ? `${salesMom} vs last month` : undefined}
              deltaStatus={salesStatus}
            />
            <Hero
              label="Total spend"
              value={fmtIdr(selected.metrics.total_spend_idr)}
              deltaText={
                budgetPercent !== undefined ? `${budgetPercent}% of budget used` : undefined
              }
              deltaStatus={budgetStatus}
            />
            <Hero
              label="Meta ROAS (online)"
              value={
                selected.metrics.meta_roas_online !== undefined
                  ? `${selected.metrics.meta_roas_online.toFixed(2)}x`
                  : metaRoas
                    ? `${metaRoas.toFixed(2)}x`
                    : "-"
              }
              deltaText={selected.metrics.meta_roas_online === undefined ? "*approx" : undefined}
            />
          </div>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <StatusTile
            title="Creative Brief"
            status="neutral"
            caption="What worked, what didn't, and what to make next - see this month's read."
            href="/marketing/creative-brief"
          />
          {tiles.map((t) => (
            <StatusTile
              key={t.key}
              title={t.title}
              status={t.status}
              caption={t.caption}
              href={t.href}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Marketing</h1>
        <Link
          href={monthParam ? `/marketing?view=simple&month=${monthParam}` : "/marketing?view=simple"}
          className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
        >
          Simple view →
        </Link>
      </div>

      <nav className="mt-4 flex flex-wrap gap-2">
        {modules.map((m) =>
          m.href ? (
            <Link
              key={m.label}
              href={m.href}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
            >
              {m.label}
            </Link>
          ) : (
            <span
              key={m.label}
              className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-400 dark:bg-zinc-900"
            >
              {m.label} (soon)
            </span>
          ),
        )}
      </nav>

      {!selected ? (
        <p className="mt-8 text-sm text-zinc-600 dark:text-zinc-400">
          No financials data yet.
        </p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
            {months
              .slice()
              .reverse()
              .map((m) => (
                <Link
                  key={m.date}
                  href={`/marketing?month=${m.date}`}
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

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi
              label="Total spend"
              value={fmtIdr(selected.metrics.total_spend_idr)}
              mom={deltaLabel(selected.metrics.total_spend_idr, prior?.metrics.total_spend_idr)}
              yoy={deltaLabel(selected.metrics.total_spend_idr, yoy?.metrics.total_spend_idr)}
            />
            <Kpi
              label="Online sales"
              value={fmtIdr(selected.metrics.online_sales_idr)}
              mom={deltaLabel(selected.metrics.online_sales_idr, prior?.metrics.online_sales_idr)}
              yoy={deltaLabel(selected.metrics.online_sales_idr, yoy?.metrics.online_sales_idr)}
            />
            <Kpi
              label="In-store orders"
              value={selected.metrics.instore_sales_orders?.toString() ?? "-"}
              mom={deltaLabel(
                selected.metrics.instore_sales_orders,
                prior?.metrics.instore_sales_orders,
              )}
              yoy={deltaLabel(
                selected.metrics.instore_sales_orders,
                yoy?.metrics.instore_sales_orders,
              )}
            />
            <Kpi
              label="WA sales orders"
              value={selected.metrics.wa_sales_orders?.toString() ?? "-"}
              note={selected.metrics.wa_sales_orders === undefined ? "not tracked before Mar '26" : undefined}
            />
            <Kpi
              label="Budget used"
              value={
                selected.metrics.total_budget_idr
                  ? `${Math.round((selected.metrics.total_spend_idr / selected.metrics.total_budget_idr) * 100)}%`
                  : "-"
              }
              note={!selected.metrics.total_budget_idr ? "no budget set that month" : undefined}
            />
            <Kpi
              label="Meta ROAS (online)"
              value={
                selected.metrics.meta_roas_online !== undefined
                  ? `${selected.metrics.meta_roas_online.toFixed(2)}x`
                  : metaRoas
                    ? `${metaRoas.toFixed(2)}x*`
                    : "-"
              }
              note={
                selected.metrics.meta_roas_online === undefined
                  ? "*approx (online sales / spend) - not in Unit Economics tab for this month"
                  : undefined
              }
            />
            <Kpi
              label="Blended ROAS (online)"
              value={
                selected.metrics.blended_roas_online !== undefined
                  ? `${selected.metrics.blended_roas_online.toFixed(2)}x`
                  : "-"
              }
              note={selected.metrics.blended_roas_online === undefined ? "not in Unit Economics tab yet" : undefined}
            />
            <Kpi
              label="Meta CAC (online)"
              value={fmtIdr(selected.metrics.meta_cac_online_idr)}
              note={selected.metrics.meta_cac_online_idr === undefined ? "not in Unit Economics tab yet" : undefined}
            />
            <Kpi
              label="Marketing P/N"
              value={fmtIdr(selected.metrics.full_marketing_pn_idr ?? selected.metrics.meta_pn_idr)}
              note={
                selected.metrics.full_marketing_pn_idr === undefined
                  ? selected.metrics.meta_pn_idr !== undefined
                    ? "Meta-only P/N shown - Full Marketing P/N not tracked before Apr '26"
                    : "not in Unit Economics tab yet"
                  : undefined
              }
            />
            <AdPulseTile
              lastAd={lastAdEntry}
              bestAd={bestAdEntry}
              bestAdMonthLabel={bestAdMonthLabel}
            />
          </div>
          {!lastAdEntry && (
            <p className="mt-2 text-xs text-zinc-500">
              No Meta Ads CSV imported yet - the &quot;Ads pulse&quot; box fills in once one is.{" "}
              <Link href="/marketing/import" className="underline">
                Import one
              </Link>
              .
            </p>
          )}

          <p className="mt-3 text-xs text-zinc-500">
            From the Unit Economics (&quot;Ecom Breakdown&quot;) tab. Still not shown:
            offline/WA-side ROAS, CAC and first-time contribution - those
            columns are blank in the source for every month so far, not
            something this app can compute on its own.
          </p>
        </>
      )}

      {(attentionItems.length > 0 || goodItems.length > 0) && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-amber-900 dark:text-amber-400">
                Needs attention {attentionItems.length > 0 && `(${attentionItems.length})`}
              </h2>
              <Link
                href="/marketing/insights"
                className="text-xs text-amber-900 hover:underline dark:text-amber-400"
              >
                Full insights →
              </Link>
            </div>
            {attentionItems.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm text-amber-800 dark:text-amber-500">
                {attentionItems.map((item) => (
                  <li key={item.text}>
                    <Link href={item.href} className="hover:underline">
                      {item.text}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-amber-800 dark:text-amber-500">Nothing flagged.</p>
            )}
          </div>

          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
            <h2 className="text-sm font-medium text-emerald-900 dark:text-emerald-400">
              Looking good {goodItems.length > 0 && `(${goodItems.length})`}
            </h2>
            {goodItems.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm text-emerald-800 dark:text-emerald-500">
                {goodItems.map((item) => (
                  <li key={item.text}>
                    <Link href={item.href} className="hover:underline">
                      {item.text}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-500">
                Nothing to highlight yet.
              </p>
            )}
          </div>
        </div>
      )}

      {months.length > 1 &&
        (() => {
          const spendSeries: Period[] = months.map((m) => ({
            date: m.date,
            value: m.metrics.total_spend_idr ?? 0,
          }));
          const salesSeries: Period[] = months.map((m) => ({
            date: m.date,
            value: m.metrics.online_sales_idr ?? 0,
          }));
          // Online sales is the thing marketing spend is trying to move, so
          // it's the one series worth projecting forward - spend itself is
          // a decision this chart is meant to inform, not an outcome to
          // predict. Same engine /forecast uses elsewhere in this app
          // (Holt, no seasonal component - see that module's own notes on
          // why), reused as-is rather than inventing a second method here.
          const salesForecast = forecast(salesSeries, { horizon: 3 });

          // Only the months with a real synced value - not forced to 0,
          // which would misread as "no in-store sales that month" when
          // it really means "before the Odoo sync covered this period".
          const offlineMonths = months.filter((m) => m.metrics.offline_sales_idr_real !== undefined);

          const seasonIndex = buildSeasonIndex(arrivalRows);
          const hasSeasonData = arrivalRows.length > 0;
          const seasonByMonth = new Map(seasonIndex.map((p) => [p.month, p]));
          const yearsAveraged = seasonIndex[0]?.yearsAveraged ?? 0;

          type XPt = { date: string; isForecast: boolean };
          const xPoints: XPt[] = [
            ...months.map((m) => ({ date: m.date, isForecast: false })),
            ...salesForecast.forecast.map((f) => ({ date: f.date, isForecast: true })),
          ];
          const forecastStartIdx = months.length;

          const CHART_W = 820;
          const CHART_H = 320;
          const PAD_L = 64;
          const PAD_R = 50;
          const PAD_T = 28;
          const PAD_B = 32;
          const plotW = CHART_W - PAD_L - PAD_R;
          const plotH = CHART_H - PAD_T - PAD_B;
          const xFor = (i: number) =>
            PAD_L + (xPoints.length <= 1 ? 0 : (i / (xPoints.length - 1)) * plotW);

          const maxRupiah = Math.max(
            1,
            ...spendSeries.map((p) => p.value),
            ...salesSeries.map((p) => p.value),
            ...offlineMonths.map((m) => m.metrics.offline_sales_idr_real!),
            ...salesForecast.forecast.map((f) => f.high),
          );
          const rupiahStep = niceStep(maxRupiah / 4);
          const rupiahMax = rupiahStep * 4;
          const yForRupiah = (v: number) =>
            PAD_T + plotH - (Math.min(v, rupiahMax) / rupiahMax) * plotH;

          const maxPct = Math.max(1, ...seasonIndex.map((p) => p.indexPct)) * 1.15;
          const yForPct = (v: number) => PAD_T + plotH - (Math.min(v, maxPct) / maxPct) * plotH;

          const spendPts: Point[] = months.map((m, i) => ({
            x: xFor(i),
            y: yForRupiah(m.metrics.total_spend_idr ?? 0),
          }));
          const salesPts: Point[] = months.map((m, i) => ({
            x: xFor(i),
            y: yForRupiah(m.metrics.online_sales_idr ?? 0),
          }));
          // Broken into segments rather than one continuous line, so a
          // gap in real Odoo sync coverage shows as a gap, not an
          // interpolated guess across months with no data.
          const offlineSegments: Point[][] = [];
          {
            let current: Point[] = [];
            months.forEach((m, i) => {
              const v = m.metrics.offline_sales_idr_real;
              if (v === undefined) {
                if (current.length) offlineSegments.push(current);
                current = [];
              } else {
                current.push({ x: xFor(i), y: yForRupiah(v) });
              }
            });
            if (current.length) offlineSegments.push(current);
          }
          const lastRealSales = salesSeries[salesSeries.length - 1]?.value ?? 0;
          const forecastLine: Point[] = [
            { x: xFor(forecastStartIdx - 1), y: yForRupiah(lastRealSales) },
            ...salesForecast.forecast.map((f, i) => ({
              x: xFor(forecastStartIdx + i),
              y: yForRupiah(f.expected),
            })),
          ];
          const forecastBandTop: Point[] = [
            { x: xFor(forecastStartIdx - 1), y: yForRupiah(lastRealSales) },
            ...salesForecast.forecast.map((f, i) => ({
              x: xFor(forecastStartIdx + i),
              y: yForRupiah(f.high),
            })),
          ];
          const forecastBandBottom: Point[] = [
            { x: xFor(forecastStartIdx - 1), y: yForRupiah(lastRealSales) },
            ...salesForecast.forecast.map((f, i) => ({
              x: xFor(forecastStartIdx + i),
              y: yForRupiah(f.low),
            })),
          ];

          // Most recent pair of CONSECUTIVE real months with both spend
          // and in-store revenue on file - a plain MoM comparison, not a
          // claimed cause/effect (one month's co-movement doesn't prove
          // marketing drove the in-store change either way).
          let recentOfflineComparison: {
            fromLabel: string;
            toLabel: string;
            spendPct: number | null;
            offlinePct: number | null;
          } | null = null;
          for (let i = months.length - 1; i > 0; i--) {
            const curr = months[i];
            const prev = months[i - 1];
            const currOffline = curr.metrics.offline_sales_idr_real;
            const prevOffline = prev.metrics.offline_sales_idr_real;
            if (currOffline === undefined || prevOffline === undefined) continue;
            const currSpend = curr.metrics.total_spend_idr;
            const prevSpend = prev.metrics.total_spend_idr;
            recentOfflineComparison = {
              fromLabel: MONTH_LABEL.format(new Date(`${prev.date}T00:00:00Z`)),
              toLabel: MONTH_LABEL.format(new Date(`${curr.date}T00:00:00Z`)),
              spendPct:
                currSpend !== undefined && prevSpend
                  ? Math.round(((currSpend - prevSpend) / prevSpend) * 100)
                  : null,
              offlinePct: prevOffline ? Math.round(((currOffline - prevOffline) / prevOffline) * 100) : null,
            };
            break;
          }

          const seasonPts: Point[] = xPoints.map((p, i) => {
            const m = Number(p.date.slice(5, 7));
            return { x: xFor(i), y: yForPct(seasonByMonth.get(m)?.indexPct ?? 0) };
          });
          const seasonAreaPath = hasSeasonData
            ? `${linePath(seasonPts)} L${xFor(xPoints.length - 1)},${yForPct(0)} L${xFor(0)},${yForPct(0)} Z`
            : "";

          const sortedBySeasonality = [...seasonIndex].sort((a, b) => b.indexPct - a.indexPct);
          const highMonths = sortedBySeasonality
            .filter((p) => p.indexPct > EVEN_SHARE_PCT + 0.5)
            .sort((a, b) => a.month - b.month);
          const lowMonths = sortedBySeasonality
            .filter((p) => p.indexPct < EVEN_SHARE_PCT - 0.5)
            .sort((a, b) => a.month - b.month);

          const SEASON_SCOPE = "mk-season-chart";
          const seasonChartCss = paletteCss(SEASON_SCOPE, ["spend", "sales", "offline", "season"]);

          return (
            <div className={`mt-8 ${SEASON_SCOPE}`}>
              <style dangerouslySetInnerHTML={{ __html: seasonChartCss }} />
              <h2 className="text-lg font-medium">
                Spend, online &amp; in-store sales, and Bali&apos;s tourist season
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Real marketing spend, online sales, and in-store (offline) revenue by month (left
                axis), against Bali&apos;s historical tourist-season pattern (right axis - share
                of a typical year&apos;s foreign arrivals via Ngurah Rai, averaged across{" "}
                {yearsAveraged} real year{yearsAveraged === 1 ? "" : "s"}
                {hasSeasonData ? "" : " - not seeded yet"}). The dashed line is a{" "}
                {salesForecast.forecast.length}-month online-sales projection (same trend-based
                method <Link href="/forecast" className="underline">/forecast</Link> uses) - a
                projection, not a target. In-store revenue is the real Odoo POS sync (same source
                as /operations), not the order-count column on Financials - it only covers months
                the sync has actually run for, so a gap in that line means no synced data yet, not
                zero sales.
              </p>

              {!hasSeasonData && (
                <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
                  Run <code>supabase/migrations/0038_bali_tourist_arrivals.sql</code> to show the
                  tourist-season line and the busy/quiet-month read below.
                </p>
              )}
              {!hasOfflineRevenueData && (
                <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
                  No in-store revenue line yet - either the Odoo sync hasn&apos;t run for any month
                  in this range, or <code>supabase/migrations/0022_variants_and_sales_rollups.sql</code>{" "}
                  hasn&apos;t been run. Check{" "}
                  <Link href="/operations" className="underline">/operations</Link>&apos;s last
                  sync status.
                </p>
              )}

              <svg
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                className="mt-3 h-auto w-full"
                role="img"
                aria-label="Marketing spend, online sales, projected sales, and Bali tourist season by month"
              >
                {[0, 1, 2, 3, 4].map((i) => {
                  const v = rupiahStep * i;
                  return (
                    <g key={`l-${i}`}>
                      <line
                        x1={PAD_L}
                        x2={CHART_W - PAD_R}
                        y1={yForRupiah(v)}
                        y2={yForRupiah(v)}
                        stroke="currentColor"
                        className="text-zinc-100 dark:text-zinc-900"
                        strokeWidth={1}
                      />
                      <text x={PAD_L - 6} y={yForRupiah(v) + 3} textAnchor="end" className="fill-zinc-400 text-[9px]">
                        {formatRupiahCompact(v)}
                      </text>
                    </g>
                  );
                })}
                {hasSeasonData &&
                  [0, 1, 2, 3, 4].map((i) => {
                    const v = (maxPct / 4) * i;
                    return (
                      <text
                        key={`r-${i}`}
                        x={CHART_W - PAD_R + 6}
                        y={yForPct(v) + 3}
                        textAnchor="start"
                        className="fill-zinc-400 text-[9px]"
                      >
                        {v.toFixed(1)}%
                      </text>
                    );
                  })}
                <line
                  x1={xFor(forecastStartIdx - 1)}
                  x2={xFor(forecastStartIdx - 1)}
                  y1={PAD_T}
                  y2={PAD_T + plotH}
                  stroke="currentColor"
                  className="text-zinc-300 dark:text-zinc-700"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
                {hasSeasonData && (
                  <>
                    <path d={seasonAreaPath} fill={paletteVar("season")} opacity={0.12} />
                    <path
                      d={linePath(seasonPts)}
                      fill="none"
                      stroke={paletteVar("season")}
                      strokeWidth={1.5}
                      strokeDasharray="2 2"
                    />
                  </>
                )}
                <path d={linePath(spendPts)} fill="none" stroke={paletteVar("spend")} strokeWidth={2} />
                <path d={linePath(salesPts)} fill="none" stroke={paletteVar("sales")} strokeWidth={2} />
                {offlineSegments.map((seg, i) => (
                  <path
                    key={`offline-${i}`}
                    d={linePath(seg)}
                    fill="none"
                    stroke={paletteVar("offline")}
                    strokeWidth={2}
                  />
                ))}
                <path d={bandPath(forecastBandTop, forecastBandBottom)} fill={paletteVar("sales")} opacity={0.15} />
                <path
                  d={linePath(forecastLine)}
                  fill="none"
                  stroke={paletteVar("sales")}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
                {xPoints.map((p, i) => {
                  const d = new Date(`${p.date}T00:00:00Z`);
                  const show = d.getUTCMonth() === 0 || i === 0 || i === xPoints.length - 1 || i % 3 === 0;
                  if (!show) return null;
                  return (
                    <text
                      key={p.date}
                      x={xFor(i)}
                      y={CHART_H - PAD_B + 14}
                      textAnchor="middle"
                      className={`text-[9px] ${p.isForecast ? "fill-zinc-300 italic dark:fill-zinc-700" : "fill-zinc-400"}`}
                    >
                      {d.getUTCMonth() === 0 ? MONTH_LABEL.format(d) : MONTH_ONLY_LABEL.format(d)}
                    </text>
                  );
                })}
              </svg>

              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: paletteVar("spend") }} />
                  Total spend
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: paletteVar("sales") }} />
                  Online sales (dashed = projected)
                </span>
                {hasOfflineRevenueData && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: paletteVar("offline") }} />
                    In-store sales (real Odoo sync, gaps = not synced that month)
                  </span>
                )}
                {hasSeasonData && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: paletteVar("season") }} />
                    Bali tourist season (right axis)
                  </span>
                )}
              </div>

              {recentOfflineComparison && (
                <p className="mt-3 text-xs text-zinc-500">
                  {recentOfflineComparison.fromLabel} → {recentOfflineComparison.toLabel}: spend{" "}
                  {recentOfflineComparison.spendPct === null
                    ? "n/a"
                    : `${recentOfflineComparison.spendPct > 0 ? "+" : ""}${recentOfflineComparison.spendPct}%`}
                  , in-store sales{" "}
                  {recentOfflineComparison.offlinePct === null
                    ? "n/a"
                    : `${recentOfflineComparison.offlinePct > 0 ? "+" : ""}${recentOfflineComparison.offlinePct}%`}
                  . One month moving together (or not) isn&apos;t proof either way - read this
                  alongside the lines above over a longer stretch before drawing a conclusion.
                </p>
              )}

              {hasSeasonData && (
                <div className="mt-4 rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
                  <p>
                    <strong>Historically busier:</strong>{" "}
                    {highMonths.length ? highMonths.map((p) => monthName(p.month)).join(", ") : "no month stands out"}
                    {" "}- Bali&apos;s dry-season/holiday stretch, above an even{" "}
                    {EVEN_SHARE_PCT.toFixed(1)}%/month share of a typical year&apos;s arrivals.
                  </p>
                  <p className="mt-1">
                    <strong>Historically quieter:</strong>{" "}
                    {lowMonths.length ? lowMonths.map((p) => monthName(p.month)).join(", ") : "no month stands out"}
                    {" "}- worth timing activations, content pushes, or slower-season offers here
                    rather than competing for attention in the busy months, and using the lead time
                    to prep stock and creative ahead of the next busy stretch.
                  </p>
                  <p className="mt-1 text-zinc-500">
                    This is Bali-wide tourist arrival seasonality (Disparda&apos;s own monthly
                    release), not ASASI&apos;s own sales pattern - it&apos;s a real external signal
                    to plan around, not a guarantee your sales move the same way. Compare it against
                    the actual spend/sales lines above for your own pattern before acting on it.
                  </p>
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
}
