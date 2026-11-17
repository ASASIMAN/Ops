import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessModule } from "@/components/shell/nav-config";
import { BarList, TrendChart } from "@/components/ui/charts";
import { Card, EmptyState } from "@/components/ui/card";
import { FilterLinks } from "@/components/ui/filter-links";
import { PeriodPicker } from "@/components/ui/period-picker";
import { Stat } from "@/components/ui/stat";
import { change, idr, idrCompact, num } from "@/lib/biz/format";
import { fetchMarketingMonths } from "@/lib/biz/marketing";
import { monthsTouched, resolvePeriod, type Period } from "@/lib/biz/period";
import { fetchDaily, fetchExtras, fetchShops, fetchTotals } from "@/lib/biz/sales";
import { bucketsFor, seriesFor } from "@/lib/biz/trend";
import { baliToday, getShellContext } from "@/lib/shell/context";
import { ASASI_PALETTE, CONTEXT_SERIES_COLOR } from "@/lib/viz/palette";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sales overview" };

const METRICS = [
  { value: "revenue", label: "Revenue" },
  { value: "orders", label: "Orders" },
  { value: "units", label: "Units" },
] as const;
type Metric = (typeof METRICS)[number]["value"];

const GRAINS = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
] as const;

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_LONG = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function SalesOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; store?: string; metric?: string; by?: string }>;
}) {
  const [params, { role }] = await Promise.all([searchParams, getShellContext()]);
  if (!canAccessModule(role, "operations")) {
    return <EmptyState title="Not part of your role">Sales reporting isn&apos;t included in your access.</EmptyState>;
  }

  const today = baliToday();
  const period = resolvePeriod(params, today);
  const metric: Metric = METRICS.find((m) => m.value === params.metric)?.value ?? "revenue";
  const grain: Period["bucket"] = GRAINS.find((g) => g.value === params.by)?.value ?? period.bucket;
  const admin = createAdminClient();

  const { shops } = await fetchShops(admin);
  const shop = shops.find((s) => s.key === params.store);
  const storeIds = shop?.ids ?? null;
  const seesMarketing = canAccessModule(role, "marketing");

  const [totals, prevTotals, daily, prevDaily, extras, prevExtras, marketingMonths] = await Promise.all([
    fetchTotals(admin, period, storeIds),
    fetchTotals(admin, period.prev, storeIds),
    fetchDaily(admin, period, storeIds),
    fetchDaily(admin, period.prev, storeIds),
    fetchExtras(admin, period, storeIds),
    fetchExtras(admin, period.prev, storeIds),
    seesMarketing && !shop ? fetchMarketingMonths(admin) : Promise.resolve(null),
  ]);

  const keep = {
    period: period.key,
    from: period.key === "custom" ? period.from : undefined,
    to: period.key === "custom" ? period.to : undefined,
    store: shop?.key,
    metric: metric === "revenue" ? undefined : metric,
    by: params.by && GRAINS.some((g) => g.value === params.by) ? params.by : undefined,
  };

  const cur = totals.ok ? totals.data : null;
  const prev = prevTotals.ok ? prevTotals.data : null;
  const prevHasSales = Boolean(prev && prev.orders > 0);
  const noCompare = { pct: null, direction: null } as const;
  const noPrevNote = prev && !prevHasSales ? `No sales on file for ${period.prev.label.replace(/^vs /, "")}` : undefined;
  const aov = cur && cur.orders > 0 ? cur.revenue / cur.orders : null;
  const prevAov = prev && prev.orders > 0 ? prev.revenue / prev.orders : null;
  const upo = cur && cur.orders > 0 ? cur.units / cur.orders : null;
  const prevUpo = prev && prev.orders > 0 ? prev.units / prev.orders : null;

  const fmt = metric === "revenue" ? idr : num;
  const axisFmt = metric === "revenue" ? idrCompact : num;
  const buckets = bucketsFor(period, grain);
  const prevBuckets = bucketsFor(period.prev, grain);
  const dailyRows = daily.ok ? daily.data : [];
  const nowSeries = seriesFor(buckets, grain, dailyRows, metric, today);
  const prevSeries = prevDaily.ok ? seriesFor(prevBuckets, grain, prevDaily.data, metric, today) : [];

  // Table rows: every bucket of the period, newest first, with all three measures.
  const tableRows = buckets
    .map((b, i) => ({
      bucket: b,
      revenue: seriesFor([b], grain, dailyRows, "revenue", today)[0],
      orders: seriesFor([b], grain, dailyRows, "orders", today)[0],
      units: seriesFor([b], grain, dailyRows, "units", today)[0],
      index: i,
    }))
    .filter((r) => r.bucket.start <= today)
    .reverse();

  // Average revenue per weekday, over the days that have sales on file.
  const byWeekday = WEEKDAYS.map(() => ({ total: 0, days: 0 }));
  for (const p of dailyRows) {
    const idx = (new Date(`${p.day}T00:00:00Z`).getUTCDay() + 6) % 7;
    byWeekday[idx].total += p.revenue;
    byWeekday[idx].days += 1;
  }
  const showWeekdays = period.days >= 14 && dailyRows.length >= 7;

  // Online vs in-store, for whole calendar months inside the period.
  const mkByMonth = new Map((marketingMonths ?? []).map((m) => [m.month, m.metrics]));
  const posByMonth = new Map<string, number>();
  for (const p of dailyRows) {
    const m = `${p.day.slice(0, 7)}-01`;
    posByMonth.set(m, (posByMonth.get(m) ?? 0) + p.revenue);
  }
  const channelMonths = monthsTouched(period)
    .map((m) => ({ month: m, inStore: posByMonth.get(m), online: mkByMonth.get(m)?.online_sales_idr }))
    .filter((r) => r.inStore !== undefined || r.online !== undefined)
    .reverse();

  return (
    <>
      <div className="as-page-head">
        <div>
          <h1 className="as-page-title">Sales overview</h1>
          <p className="as-page-desc">
            {shop ? shop.name : "All stores"} <span className="text-faint">·</span> {period.rangeLabel}{" "}
            <span className="text-faint">·</span> compared {period.prev.label.replace(/^vs /, "with ")}. In-store sales
            from the Odoo POS sync, net of discounts and excluding tax.
          </p>
        </div>
        <PeriodPicker basePath="/sales" period={period} keep={keep} />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <FilterLinks
          basePath="/sales"
          param="store"
          value={shop?.key}
          options={shops.map((s) => ({ value: s.key, label: s.name }))}
          allLabel="All stores"
          keep={keep}
          label="Store"
        />
        <Link href={`/sales/stores?period=${period.key}${period.key === "custom" ? `&from=${period.from}&to=${period.to}` : ""}`} className="as-link">
          Compare stores
        </Link>
      </div>

      {!totals.ok && <p className="as-notice as-notice-bad mb-4">Sales figures couldn&apos;t be loaded: {totals.error}</p>}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Revenue" value={cur ? idr(cur.revenue) : null} change={prevHasSales ? change(cur?.revenue, prev?.revenue) : noCompare} compareLabel={period.prev.label} note={noPrevNote} />
        <Stat label="Orders" value={cur ? num(cur.orders) : null} change={prevHasSales ? change(cur?.orders, prev?.orders) : noCompare} compareLabel={period.prev.label} />
        <Stat label="Average order" value={aov !== null ? idr(aov) : null} change={change(aov, prevAov)} compareLabel={period.prev.label} note={cur && cur.orders === 0 ? "No orders in this period" : undefined} />
        <Stat label="Units sold" value={cur ? num(cur.units) : null} change={prevHasSales ? change(cur?.units, prev?.units) : noCompare} compareLabel={period.prev.label} href={`/sales/products?period=${period.key}${shop ? `&store=${shop.key}` : ""}`} />
        <Stat label="Units per order" value={upo !== null ? upo.toFixed(2) : null} change={change(upo, prevUpo)} compareLabel={period.prev.label} />
        <Stat
          label="Line discounts"
          value={extras.ok ? idr(extras.data.discountValue) : null}
          change={extras.ok && prevExtras.ok ? change(extras.data.discountValue, prevExtras.data.discountValue) : undefined}
          compareLabel={period.prev.label}
          note={extras.ok ? `${num(extras.data.discountedLines)} discounted line${extras.data.discountedLines === 1 ? "" : "s"}` : !extras.ok && extras.missing ? "Needs migration 0040" : undefined}
          invert
        />
        <Stat
          label="Returns"
          value={extras.ok ? `${num(extras.data.returnUnits)} unit${extras.data.returnUnits === 1 ? "" : "s"}` : null}
          change={extras.ok && prevExtras.ok ? change(extras.data.returnUnits, prevExtras.data.returnUnits) : undefined}
          compareLabel={period.prev.label}
          note={extras.ok ? `${idr(extras.data.returnValue)} refunded · negative-quantity lines` : !extras.ok && extras.missing ? "Needs migration 0040" : undefined}
          invert
        />
        <Stat
          label="Loyalty redemptions"
          value={extras.ok ? idr(extras.data.redemptionValue) : null}
          change={extras.ok && prevExtras.ok ? change(extras.data.redemptionValue, prevExtras.data.redemptionValue) : undefined}
          compareLabel={period.prev.label}
          note={extras.ok ? `${num(extras.data.redemptionLines)} "Redeem" line${extras.data.redemptionLines === 1 ? "" : "s"}, already taken off revenue` : !extras.ok && extras.missing ? "Needs migration 0040" : undefined}
          invert
        />
      </div>

      <Card
        className="mt-6"
        title={`${METRICS.find((m) => m.value === metric)!.label} over time`}
        note={`${grain === "day" ? "Per day" : grain === "week" ? "Per week (Monday start)" : "Per month"}, Bali time. Gaps are days with nothing synced.`}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <FilterLinks basePath="/sales" param="metric" value={metric} options={[...METRICS]} keep={keep} label="Measure" />
          <FilterLinks basePath="/sales" param="by" value={grain} options={[...GRAINS]} keep={keep} label="Granularity" />
        </div>
        <div className="as-card-pad">
          {nowSeries.some((v) => v !== null) ? (
            <TrendChart
              ariaLabel={`${metric} over the selected period against the comparison period`}
              xLabels={buckets.map((b) => b.label)}
              tipTitles={buckets.map((b) => b.title)}
              format={fmt}
              axisFormat={axisFmt}
              size="full"
              height={280}
              series={[
                { label: period.rangeLabel, color: ASASI_PALETTE[0].light, values: nowSeries },
                ...(prevSeries.some((v) => v !== null)
                  ? [
                      {
                        label: period.prev.label.replace(/^vs /, ""),
                        color: CONTEXT_SERIES_COLOR,
                        dashed: true,
                        values: buckets.map((_, i) => prevSeries[i] ?? null),
                        tipLabels: buckets.map((_, i) => prevBuckets[i]?.title ?? "Comparison"),
                      },
                    ]
                  : []),
              ]}
            />
          ) : (
            <EmptyState title="No sales in this period">Nothing has been synced from Odoo for {period.rangeLabel}.</EmptyState>
          )}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title={grain === "day" ? "Daily sales" : grain === "week" ? "Weekly sales" : "Monthly sales"}
          note={`${shop ? shop.name : "All stores"}, newest first`}
          href={`/operations?from=${period.from}&to=${period.to}${shop ? shop.ids.map((id) => `&store=${id}`).join("") : ""}`}
          hrefLabel="Line detail"
        >
          {tableRows.some((r) => r.revenue !== null) ? (
            <div className="as-table-wrap max-h-[30rem] overflow-y-auto">
              <table className="as-table">
                <thead>
                  <tr>
                    <th>{grain === "day" ? "Day" : grain === "week" ? "Week" : "Month"}</th>
                    <th className="as-num">Revenue</th>
                    <th className="as-num">Orders</th>
                    <th className="as-num">Average order</th>
                    <th className="as-num">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.bucket.start}>
                      <td>{r.bucket.title}</td>
                      {r.revenue === null ? (
                        <td colSpan={4} className="as-num text-faint">
                          nothing synced
                        </td>
                      ) : (
                        <>
                          <td className="as-num">{idr(r.revenue)}</td>
                          <td className="as-num">{num(r.orders ?? 0)}</td>
                          <td className="as-num">{r.orders ? idr(r.revenue / r.orders) : "-"}</td>
                          <td className="as-num">{num(r.units ?? 0)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No sales in this period" />
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Average by weekday" note="Mean revenue per trading day on file">
            {showWeekdays ? (
              <BarList
                rows={WEEKDAYS.map((name, i) => ({
                  key: name,
                  label: name,
                  sub: `${byWeekday[i].days} day${byWeekday[i].days === 1 ? "" : "s"}`,
                  value: byWeekday[i].days ? byWeekday[i].total / byWeekday[i].days : 0,
                  valueText: byWeekday[i].days ? idr(byWeekday[i].total / byWeekday[i].days) : "no data",
                }))}
              />
            ) : (
              <EmptyState title="Needs a longer period">Pick two weeks or more to compare weekdays.</EmptyState>
            )}
          </Card>
        </div>
      </div>

      {seesMarketing && !shop && (
        <Card
          className="mt-4"
          title="Online vs in-store"
          note="In-store is this page's POS revenue; online is the whole-month figure from the Financials sheet. A month still in progress has no online figure until it is reported."
          href="/marketing/financials"
          hrefLabel="Financials"
        >
          {channelMonths.length > 0 ? (
            <div className="as-table-wrap">
              <table className="as-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="as-num">In-store (POS)</th>
                    <th className="as-num">Online (sheet)</th>
                    <th className="as-num">Online share</th>
                  </tr>
                </thead>
                <tbody>
                  {channelMonths.map((r) => (
                    <tr key={r.month}>
                      <td>{MONTH_LONG.format(new Date(`${r.month}T00:00:00Z`))}</td>
                      <td className="as-num">{r.inStore !== undefined ? idr(r.inStore) : <span className="text-faint">not synced</span>}</td>
                      <td className="as-num">{r.online !== undefined ? idr(r.online) : <span className="text-faint">not reported</span>}</td>
                      <td className="as-num">
                        {r.inStore !== undefined && r.online !== undefined && r.inStore + r.online > 0
                          ? `${((r.online / (r.inStore + r.online)) * 100).toFixed(1)}%`
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Nothing on file for these months" />
          )}
        </Card>
      )}
    </>
  );
}
