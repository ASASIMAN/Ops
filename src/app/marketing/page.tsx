import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInsights } from "@/lib/insights";

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

  const [{ data: factRows }, { active: attentionItems, good: goodItems }] = await Promise.all([
    supabase
      .from("facts_daily")
      .select("date, metric, value")
      .eq("source", "financials_sheet")
      .order("date", { ascending: true }),
    getInsights(),
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

  const metaRoas =
    selected?.metrics.meta_ad_spend_idr && selected?.metrics.online_sales_idr
      ? selected.metrics.online_sales_idr / selected.metrics.meta_ad_spend_idr
      : undefined;

  const tileAreas = [
    { key: "financials", title: "Budget & Spend", hrefPrefix: "/marketing/financials" },
    { key: "paid_media", title: "Paid Media", hrefPrefix: "/marketing/paid-media" },
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
              label="Meta ROAS*"
              value={metaRoas ? `${metaRoas.toFixed(2)}x` : "-"}
              deltaText="*approx"
            />
          </div>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
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
