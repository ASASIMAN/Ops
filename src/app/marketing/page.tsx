import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

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

const modules = [
  { href: "/marketing/paid-media", label: "Paid Media", status: "live" as const },
  { href: "/marketing/financials", label: "Financials", status: "live" as const },
  { href: "/marketing/import", label: "Data Import", status: "live" as const },
  { href: "/marketing/campaigns", label: "Campaign Tracker", status: "live" as const },
  { href: "/marketing/tasks", label: "Tasks", status: "live" as const },
  { href: "/marketing/creative", label: "Creative Planner", status: "live" as const },
  { href: "/marketing/kols", label: "KOL CRM", status: "live" as const },
  { href: null, label: "Organic Social", status: "soon" as const },
  { href: null, label: "Web & Ecom", status: "soon" as const },
  { href: null, label: "Retail & Local", status: "soon" as const },
];

interface MonthMetrics {
  date: string;
  metrics: Record<string, number>;
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

export default async function MarketingOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const supabase = createAdminClient();

  const [{ data: factRows }, { data: assumptionRows }, { data: adSnapshots }] =
    await Promise.all([
      supabase
        .from("facts_daily")
        .select("date, metric, value")
        .eq("source", "financials_sheet")
        .order("date", { ascending: true }),
      supabase.from("assumptions").select("key, value"),
      supabase
        .from("ad_performance_snapshots")
        .select("cost_per_purchase_idr, purchases, reporting_start, reporting_end, ads ( ad_name )")
        .order("reporting_start", { ascending: false }),
    ]);

  const byMonth = new Map<string, MonthMetrics>();
  for (const row of factRows ?? []) {
    if (!byMonth.has(row.date)) byMonth.set(row.date, { date: row.date, metrics: {} });
    byMonth.get(row.date)!.metrics[row.metric] = Number(row.value);
  }
  const months = Array.from(byMonth.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const selected =
    months.find((m) => m.date === monthParam) ?? months[months.length - 1];
  const selectedIndex = months.findIndex((m) => m.date === selected?.date);
  const prior = selectedIndex > 0 ? months[selectedIndex - 1] : undefined;
  const yoyDate = selected
    ? `${Number(selected.date.slice(0, 4)) - 1}${selected.date.slice(4)}`
    : undefined;
  const yoy = months.find((m) => m.date === yoyDate);

  const assumptions = new Map((assumptionRows ?? []).map((a) => [a.key, a.value]));
  const monthlyBudget = assumptions.get("monthly_marketing_budget_idr");

  const metaRoas =
    selected?.metrics.meta_ad_spend_idr && selected?.metrics.online_sales_idr
      ? selected.metrics.online_sales_idr / selected.metrics.meta_ad_spend_idr
      : undefined;

  // Needs attention: budget pacing on the latest real data (not the
  // browsed month - this is an operational alert, always current).
  const latestMonth = months[months.length - 1];
  const attentionItems: string[] = [];
  if (latestMonth) {
    const spend = latestMonth.metrics.total_spend_idr;
    const budget = latestMonth.metrics.total_budget_idr ?? monthlyBudget;
    if (spend && budget) {
      const percent = Math.round((spend / budget) * 100);
      if (percent > 110) {
        attentionItems.push(
          `${MONTH_LABEL.format(new Date(latestMonth.date + "T00:00:00Z"))} spend is at ${percent}% of budget - over pace. See Financials.`,
        );
      } else if (percent < 70) {
        attentionItems.push(
          `${MONTH_LABEL.format(new Date(latestMonth.date + "T00:00:00Z"))} spend is at only ${percent}% of budget - room to spend more. See Financials.`,
        );
      }
    }
  }

  // CPA outliers in the most recent ad reporting period.
  const latestPeriod = adSnapshots?.[0]
    ? { start: adSnapshots[0].reporting_start, end: adSnapshots[0].reporting_end }
    : null;
  if (latestPeriod) {
    type SnapshotWithAd = {
      cost_per_purchase_idr: number | null;
      purchases: number | null;
      reporting_start: string;
      reporting_end: string;
      ads: { ad_name: string } | null;
    };
    const periodSnapshots = (
      (adSnapshots ?? []) as unknown as SnapshotWithAd[]
    ).filter(
      (s) =>
        s.reporting_start === latestPeriod.start &&
        s.reporting_end === latestPeriod.end &&
        s.cost_per_purchase_idr &&
        Number(s.purchases) > 0,
    );
    if (periodSnapshots.length >= 3) {
      const cpas = periodSnapshots
        .map((s) => Number(s.cost_per_purchase_idr))
        .sort((a, b) => a - b);
      const mid = Math.floor(cpas.length / 2);
      const med = cpas.length % 2 === 0 ? (cpas[mid - 1] + cpas[mid]) / 2 : cpas[mid];
      for (const s of periodSnapshots) {
        const cpa = Number(s.cost_per_purchase_idr);
        if (cpa > med * 2) {
          attentionItems.push(
            `"${s.ads?.ad_name}" costs ${currencyFormatter.format(cpa)} per purchase - more than 2x this period's median (${currencyFormatter.format(med)}). See Paid Media.`,
          );
        }
      }
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Marketing</h1>
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
              label="Meta ROAS*"
              value={metaRoas ? `${metaRoas.toFixed(2)}x` : "-"}
              note="*approx, see Financials"
            />
          </div>

          <p className="mt-3 text-xs text-zinc-500">
            Not shown: blended revenue/ROAS/CAC, Marketing P/N, and walk-in
            attribution - all need data not yet available (online order
            counts and the sheet&apos;s exact P/N formula need the Unit
            Economics tab; walk-in attribution needs the monthly
            attribution counts table). Both are in the Financials Google
            Sheet but haven&apos;t been read yet (Drive access pending).
          </p>
        </>
      )}

      {attentionItems.length > 0 && (
        <div className="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <h2 className="text-sm font-medium text-amber-900 dark:text-amber-400">
            Needs attention
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-800 dark:text-amber-500">
            {attentionItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {months.length > 1 && (
        <div className="mt-8">
          <h2 className="text-lg font-medium">Spend vs. online sales, by month</h2>
          <div className="mt-3 space-y-2">
            {(() => {
              const maxValue = Math.max(
                ...months.map((m) =>
                  Math.max(m.metrics.total_spend_idr ?? 0, m.metrics.online_sales_idr ?? 0),
                ),
              );
              return months
                .slice()
                .reverse()
                .map((m) => (
                  <div key={m.date} className="text-xs">
                    <div className="flex justify-between text-zinc-500">
                      <span>{MONTH_LABEL.format(new Date(m.date + "T00:00:00Z"))}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <div className="h-3 w-16 shrink-0 text-right text-zinc-500">
                        spend
                      </div>
                      <div className="h-3 flex-1 bg-zinc-100 dark:bg-zinc-900">
                        <div
                          className="h-3 bg-zinc-700 dark:bg-zinc-400"
                          style={{
                            width: `${((m.metrics.total_spend_idr ?? 0) / maxValue) * 100}%`,
                          }}
                        />
                      </div>
                      <div className="w-28 shrink-0">{fmtIdr(m.metrics.total_spend_idr)}</div>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <div className="h-3 w-16 shrink-0 text-right text-zinc-500">
                        online
                      </div>
                      <div className="h-3 flex-1 bg-zinc-100 dark:bg-zinc-900">
                        <div
                          className="h-3 bg-emerald-500"
                          style={{
                            width: `${((m.metrics.online_sales_idr ?? 0) / maxValue) * 100}%`,
                          }}
                        />
                      </div>
                      <div className="w-28 shrink-0">{fmtIdr(m.metrics.online_sales_idr)}</div>
                    </div>
                  </div>
                ));
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
