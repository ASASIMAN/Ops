import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessModule } from "@/components/shell/nav-config";
import { BarList, ColumnChart, TrendChart } from "@/components/ui/charts";
import { Card, EmptyState, NeedsMigration } from "@/components/ui/card";
import { PeriodPicker } from "@/components/ui/period-picker";
import { Stat } from "@/components/ui/stat";
import { change, idr, idrCompact, num, pct } from "@/lib/biz/format";
import { fetchMarketingMonths, fetchMemberStats } from "@/lib/biz/marketing";
import { addMonths, monthsTouched, resolvePeriod, startOfMonth } from "@/lib/biz/period";
import {
  ROLLUPS_MIGRATION,
  fetchByCategory,
  fetchDaily,
  fetchExtras,
  fetchInventorySummary,
  fetchLastSalesSync,
  fetchSalesByShop,
  fetchShops,
  fetchSlowMovers,
  fetchTopProducts,
  fetchTotals,
} from "@/lib/biz/sales";
import { bucketsFor, seriesFor } from "@/lib/biz/trend";
import { baliToday, getShellContext } from "@/lib/shell/context";
import { ASASI_PALETTE, CONTEXT_SERIES_COLOR } from "@/lib/viz/palette";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

const SLOW_MOVER_DAYS = 90;
const MONTH_SHORT = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
const MONTH_LONG = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const SYNC_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Makassar",
});
const monthLabel = (m: string) => MONTH_SHORT.format(new Date(`${m}T00:00:00Z`));

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const [params, { role }] = await Promise.all([searchParams, getShellContext()]);
  const today = baliToday();
  const period = resolvePeriod(params, today);
  const seesSales = canAccessModule(role, "operations");
  const seesInventory = canAccessModule(role, "forecast");
  const seesMarketing = canAccessModule(role, "marketing");
  const seesMembers = canAccessModule(role, "membership");
  const admin = createAdminClient();

  // The channel chart always shows the trailing 12 calendar months,
  // whatever period the tiles are on.
  const chartMonths = Array.from({ length: 12 }, (_, i) => addMonths(startOfMonth(today), i - 11));
  const yearWindow = {
    fromTs: `${chartMonths[0]}T00:00:00+08:00`,
    toTs: `${addMonths(startOfMonth(today), 1)}T00:00:00+08:00`,
  };

  const skip = Promise.resolve(null);
  // One lookup of the shops, shared by both store breakdowns.
  const shops = seesSales ? fetchShops(admin) : null;
  const [
    totals,
    prevTotals,
    daily,
    prevDaily,
    extras,
    prevExtras,
    byShop,
    prevByShop,
    byCategory,
    topProducts,
    yearDaily,
    lastSync,
    inventory,
    slowMovers,
    marketingMonths,
    members,
  ] = await Promise.all([
    seesSales ? fetchTotals(admin, period) : skip,
    seesSales ? fetchTotals(admin, period.prev) : skip,
    seesSales ? fetchDaily(admin, period) : skip,
    seesSales ? fetchDaily(admin, period.prev) : skip,
    seesSales ? fetchExtras(admin, period) : skip,
    seesSales ? fetchExtras(admin, period.prev) : skip,
    shops ? shops.then((s) => fetchSalesByShop(admin, period, s.shopByStoreId)) : skip,
    shops ? shops.then((s) => fetchSalesByShop(admin, period.prev, s.shopByStoreId)) : skip,
    seesSales ? fetchByCategory(admin, period) : skip,
    seesSales ? fetchTopProducts(admin, period, 8) : skip,
    seesSales ? fetchDaily(admin, yearWindow) : skip,
    seesSales ? fetchLastSalesSync(admin) : skip,
    seesInventory ? fetchInventorySummary(admin) : skip,
    seesInventory ? fetchSlowMovers(admin, SLOW_MOVER_DAYS, 8) : skip,
    seesMarketing ? fetchMarketingMonths(admin) : skip,
    seesMembers ? fetchMemberStats(admin, period.fromTs, period.toTs) : skip,
  ]);

  const periodQuery = new URLSearchParams({ period: period.key, ...(period.key === "custom" ? { from: period.from, to: period.to } : {}) }).toString();
  const withPeriod = (path: string) => `${path}?${periodQuery}`;

  // ---- sales -------------------------------------------------------------
  const cur = totals?.ok ? totals.data : null;
  const prev = prevTotals?.ok ? prevTotals.data : null;
  const prevHasSales = Boolean(prev && prev.orders > 0);
  const aov = cur && cur.orders > 0 ? cur.revenue / cur.orders : null;
  const prevAov = prev && prev.orders > 0 ? prev.revenue / prev.orders : null;

  const buckets = bucketsFor(period, period.bucket);
  const prevBuckets = bucketsFor(period.prev, period.bucket);
  const trendNow = daily?.ok ? seriesFor(buckets, period.bucket, daily.data, "revenue", today) : null;
  const trendPrev = prevDaily?.ok ? seriesFor(prevBuckets, period.bucket, prevDaily.data, "revenue", today) : null;

  const shopRows = byShop?.ok ? byShop.data.filter((s) => s.revenue !== 0 || s.units !== 0) : null;
  const prevShop = new Map((prevByShop?.ok ? prevByShop.data : []).map((s) => [s.key, s]));
  const totalShopRevenue = (shopRows ?? []).reduce((sum, s) => sum + s.revenue, 0);

  const categoryRows = byCategory?.ok ? byCategory.data.filter((c) => c.revenue > 0) : null;
  const totalCategoryRevenue = (categoryRows ?? []).reduce((sum, c) => sum + c.revenue, 0);

  // ---- inventory ---------------------------------------------------------
  const stock = inventory?.ok ? inventory.data : null;
  const stockUnits = stock ? stock.reduce((sum, l) => sum + l.units, 0) : null;
  const stockValue = stock ? stock.reduce((sum, l) => sum + l.retailValue, 0) : null;

  // ---- marketing (monthly sheet figures) ----------------------------------
  const mkByMonth = new Map((marketingMonths ?? []).map((m) => [m.month, m.metrics]));
  const touched = monthsTouched(period);
  const reported = touched.filter((m) => mkByMonth.get(m)?.total_spend_idr !== undefined);
  const latestReported = [...(marketingMonths ?? [])].reverse().find((m) => m.metrics.total_spend_idr !== undefined);
  // Period spend only counts months that are both in the period and on file;
  // if none are, the tiles fall back to the latest month on file and say so.
  const mkMonths = reported.length ? reported : latestReported ? [latestReported.month] : [];
  const mkIsFallback = reported.length === 0 && mkMonths.length > 0;
  const sumMetric = (metric: string) => {
    const values = mkMonths.map((m) => mkByMonth.get(m)?.[metric]).filter((v): v is number => v !== undefined);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const mkSpend = sumMetric("total_spend_idr");
  const mkOnline = sumMetric("online_sales_idr");
  const mkLast = mkMonths.length ? mkByMonth.get(mkMonths[mkMonths.length - 1]) : undefined;
  const mkLastLabel = mkMonths.length ? monthLabel(mkMonths[mkMonths.length - 1]) : "";
  const mkTag =
    mkMonths.length === 0
      ? undefined
      : mkMonths.length === 1
        ? monthLabel(mkMonths[0])
        : `${monthLabel(mkMonths[0])} - ${monthLabel(mkMonths[mkMonths.length - 1])}`;
  const mkCoverage = mkIsFallback
    ? `Nothing reported yet for ${period.rangeLabel}; latest month on file`
    : reported.length < touched.length
      ? `${reported.length} of ${touched.length} months in this period reported`
      : touched.length > 1
        ? `${touched.length} months, whole-month figures`
        : "Whole-month figure";

  // In-store revenue per calendar month from the POS sync, for the channel chart.
  const posByMonth = new Map<string, number>();
  if (yearDaily?.ok) {
    for (const p of yearDaily.data) {
      const m = startOfMonth(p.day);
      posByMonth.set(m, (posByMonth.get(m) ?? 0) + p.revenue);
    }
  }
  const channelInStore = chartMonths.map((m) => posByMonth.get(m) ?? null);
  const channelOnline = chartMonths.map((m) => mkByMonth.get(m)?.online_sales_idr ?? null);
  const channelSpend = chartMonths.map((m) => mkByMonth.get(m)?.total_spend_idr ?? null);
  const chartTitles = chartMonths.map((m) => MONTH_LONG.format(new Date(`${m}T00:00:00Z`)));
  const chartLabels = chartMonths.map(monthLabel);

  const olive = ASASI_PALETTE[0].light;
  const copper = ASASI_PALETTE[1].light;
  const blue = ASASI_PALETTE[2].light;

  return (
    <>
      <div className="as-page-head">
        <div>
          <h1 className="as-page-title">Dashboard</h1>
          <p className="as-page-desc">
            {period.rangeLabel} <span className="text-faint">·</span> compared {period.prev.label.replace(/^vs /, "with ")}
            {lastSync && (
              <>
                {" "}
                <span className="text-faint">·</span> sales synced {SYNC_TIME.format(new Date(lastSync.startedAt))} (Bali)
              </>
            )}
          </p>
        </div>
        <PeriodPicker basePath="/dashboard" period={period} />
      </div>

      {seesSales && totals && !totals.ok && (
        <p className="as-notice as-notice-bad mb-4">Sales figures couldn&apos;t be loaded: {totals.error}</p>
      )}

      {seesSales && (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat
              label="Revenue"
              tag="In-store"
              value={cur ? idr(cur.revenue) : null}
              change={prevHasSales ? change(cur?.revenue, prev?.revenue) : { pct: null, direction: null }}
              compareLabel={period.prev.label}
              note={prev && !prevHasSales ? `No sales on file for ${period.prev.label.replace(/^vs /, "")}` : undefined}
              href={withPeriod("/sales")}
            />
            <Stat
              label="Orders"
              value={cur ? num(cur.orders) : null}
              change={prevHasSales ? change(cur?.orders, prev?.orders) : { pct: null, direction: null }}
              compareLabel={period.prev.label}
              href={withPeriod("/sales")}
            />
            <Stat
              label="Average order"
              value={aov !== null ? idr(aov) : null}
              change={change(aov, prevAov)}
              compareLabel={period.prev.label}
              note={cur && cur.orders === 0 ? "No orders in this period" : undefined}
              href={withPeriod("/sales")}
            />
            <Stat
              label="Units sold"
              value={cur ? num(cur.units) : null}
              change={prevHasSales ? change(cur?.units, prev?.units) : { pct: null, direction: null }}
              compareLabel={period.prev.label}
              href={withPeriod("/sales/products")}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat
              label="Line discounts"
              value={extras?.ok ? idr(extras.data.discountValue) : null}
              change={extras?.ok && prevExtras?.ok ? change(extras.data.discountValue, prevExtras.data.discountValue) : undefined}
              compareLabel={period.prev.label}
              note={
                extras?.ok
                  ? `${num(extras.data.discountedLines)} discounted line${extras.data.discountedLines === 1 ? "" : "s"}${
                      extras.data.redemptionLines ? ` · ${idr(extras.data.redemptionValue)} loyalty redemptions` : ""
                    }`
                  : extras && extras.missing
                    ? "Needs migration 0040"
                    : undefined
              }
              invert
              href={withPeriod("/sales")}
            />
            <Stat
              label="Returns"
              value={extras?.ok ? `${num(extras.data.returnUnits)} unit${extras.data.returnUnits === 1 ? "" : "s"}` : null}
              change={extras?.ok && prevExtras?.ok ? change(extras.data.returnUnits, prevExtras.data.returnUnits) : undefined}
              compareLabel={period.prev.label}
              note={
                extras?.ok
                  ? `${idr(extras.data.returnValue)} refunded`
                  : extras && extras.missing
                    ? "Needs migration 0040"
                    : undefined
              }
              invert
              href={withPeriod("/sales")}
            />
            {seesInventory ? (
              <Stat
                label="Stock on hand"
                tag="At retail"
                value={stockValue !== null ? idr(stockValue) : null}
                note={
                  stockUnits !== null
                    ? `${num(stockUnits)} units across office and stores`
                    : inventory && !inventory.ok && inventory.missing
                      ? "Needs migration 0040"
                      : undefined
                }
                href="/inventory"
              />
            ) : (
              <Stat label="Stock on hand" value={null} note="Not part of your role" />
            )}
            <Stat
              label="Gross margin"
              value={null}
              note="Cost prices aren't synced from Odoo yet, so profit can't be worked out."
            />
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-3">
            <Card
              title="Revenue over time"
              note={`In-store, ${period.bucket === "day" ? "per day" : period.bucket === "week" ? "per week" : "per month"} (Bali time)`}
              href={withPeriod("/sales")}
              className="xl:col-span-2"
            >
              <div className="as-card-pad">
                {trendNow && trendNow.some((v) => v !== null) ? (
                  <TrendChart
                    ariaLabel="In-store revenue over the selected period, against the comparison period"
                    xLabels={buckets.map((b) => b.label)}
                    tipTitles={buckets.map((b) => b.title)}
                    format={idr}
                    axisFormat={idrCompact}
                    series={[
                      { label: period.rangeLabel, color: olive, values: trendNow },
                      ...(trendPrev && trendPrev.some((v) => v !== null)
                        ? [
                            {
                              label: period.prev.label.replace(/^vs /, ""),
                              color: CONTEXT_SERIES_COLOR,
                              dashed: true,
                              values: buckets.map((_, i) => trendPrev[i] ?? null),
                              tipLabels: buckets.map((_, i) => prevBuckets[i]?.title ?? "Comparison"),
                            },
                          ]
                        : []),
                    ]}
                  />
                ) : (
                  <EmptyState title="No sales in this period">
                    Nothing has been synced from Odoo for {period.rangeLabel}.
                  </EmptyState>
                )}
              </div>
            </Card>

            <Card title="Revenue by store" note={period.rangeLabel} href={withPeriod("/sales/stores")}>
              {shopRows && shopRows.length > 0 ? (
                <BarList
                  rows={shopRows.map((s) => {
                    const c = change(s.revenue, prevShop.get(s.key)?.revenue);
                    return {
                      key: s.key,
                      label: s.name,
                      sub:
                        s.orders !== null
                          ? `${num(s.orders)} orders · ${totalShopRevenue > 0 ? pct((s.revenue / totalShopRevenue) * 100, 0) : "-"} of revenue`
                          : undefined,
                      value: Math.max(0, s.revenue),
                      valueText: idr(s.revenue),
                      aside:
                        c.pct !== null ? (
                          <span className={c.direction === "up" ? "as-up" : c.direction === "down" ? "as-down" : undefined}>
                            {c.direction === "up" ? "▲" : c.direction === "down" ? "▼" : "•"} {Math.abs(c.pct).toFixed(1)}%
                          </span>
                        ) : undefined,
                      href: `${withPeriod("/sales/stores")}&store=${encodeURIComponent(s.key)}`,
                    };
                  })}
                />
              ) : (
                <EmptyState title="No store sales in this period" />
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card title="Sales by category" note={period.rangeLabel} href={withPeriod("/sales/products")}>
              {byCategory && !byCategory.ok && byCategory.missing ? (
                <NeedsMigration file={ROLLUPS_MIGRATION} />
              ) : categoryRows && categoryRows.length > 0 ? (
                <BarList
                  rows={categoryRows.slice(0, 7).map((c) => ({
                    key: String(c.id ?? c.name),
                    label: c.name,
                    sub: `${num(c.units)} units · ${totalCategoryRevenue > 0 ? pct((c.revenue / totalCategoryRevenue) * 100, 0) : "-"} of revenue`,
                    value: c.revenue,
                    valueText: idr(c.revenue),
                    href: `${withPeriod("/sales/products")}&category=${encodeURIComponent(c.name)}`,
                  }))}
                />
              ) : (
                <EmptyState title="No category sales in this period" />
              )}
            </Card>

            <Card title="Best sellers" note={`By units, ${period.rangeLabel}`} href={withPeriod("/sales/products")}>
              {topProducts?.ok && topProducts.data.length > 0 ? (
                <div className="as-table-wrap">
                  <table className="as-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="as-num">Units</th>
                        <th className="as-num">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topProducts.data.map((p) => (
                        <tr key={p.templateId}>
                          <td>
                            <Link href={`${withPeriod("/sales/products")}&product=${encodeURIComponent(p.name)}`}>{p.name}</Link>
                          </td>
                          <td className="as-num">{num(p.units)}</td>
                          <td className="as-num">{idrCompact(p.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="Nothing sold in this period" />
              )}
            </Card>

            {seesInventory && (
              <Card title="Slow-moving stock" note={`Fewest units sold in the last ${SLOW_MOVER_DAYS} days, still in stock`} href="/inventory">
                {slowMovers && !slowMovers.ok && slowMovers.missing ? (
                  <NeedsMigration file={ROLLUPS_MIGRATION} />
                ) : slowMovers?.ok && slowMovers.data.length > 0 ? (
                  <div className="as-table-wrap">
                    <table className="as-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th className="as-num">Sold</th>
                          <th className="as-num">On hand</th>
                        </tr>
                      </thead>
                      <tbody>
                        {slowMovers.data.map((p) => (
                          <tr key={p.templateId}>
                            <td>
                              <Link href={`/inventory?q=${encodeURIComponent(p.name)}`}>{p.name}</Link>
                            </td>
                            <td className="as-num">{num(p.unitsSold)}</td>
                            <td className="as-num">{num(p.onHand)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title="No stock on file">Run a stock sync from Forecast to load on-hand quantities.</EmptyState>
                )}
              </Card>
            )}
          </div>
        </>
      )}

      {seesMarketing && (
        <>
          <h2 className="as-eyebrow mb-3 mt-10">Marketing</h2>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat label="Marketing spend" tag={mkTag} value={mkSpend !== null ? idr(mkSpend) : null} note={mkMonths.length ? mkCoverage : "No months reported yet"} href="/marketing/financials" />
            <Stat label="Online sales" tag={mkTag} value={mkOnline !== null ? idr(mkOnline) : null} note={mkMonths.length ? mkCoverage : "No months reported yet"} href="/marketing" />
            <Stat
              label="Blended ROAS"
              tag={mkLast?.blended_roas_online !== undefined ? `Online · ${mkLastLabel}` : undefined}
              value={mkLast?.blended_roas_online !== undefined ? `${mkLast.blended_roas_online.toFixed(2)}x` : null}
              note={mkLast?.blended_roas_online !== undefined ? "As recorded on the Unit Economics sheet" : "Not recorded for this month"}
              href="/marketing"
            />
            <Stat
              label="Blended CAC"
              tag={mkLast?.blended_cac_online_idr !== undefined ? `Online · ${mkLastLabel}` : undefined}
              value={mkLast?.blended_cac_online_idr !== undefined ? idr(mkLast.blended_cac_online_idr) : null}
              note={mkLast?.blended_cac_online_idr !== undefined ? "As recorded on the Unit Economics sheet" : "Not recorded for this month"}
              href="/marketing"
            />
          </div>

          {/* Three charts, three scales: in-store revenue is tens of times
              larger than online sales, which is larger again than spend, so
              stacking or sharing an axis would flatten the smaller two. */}
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            {seesSales && (
              <Card title="In-store revenue" note="Last 12 months · Odoo POS sync" href="/sales?period=year">
                <div className="as-card-pad">
                  {channelInStore.some((v) => v !== null) ? (
                    <ColumnChart
                      size="third"
                      ariaLabel="In-store revenue by month"
                      xLabels={chartLabels}
                      tipTitles={chartTitles}
                      format={idr}
                      axisFormat={idrCompact}
                      missingNote="not synced"
                      stacks={[{ label: "In-store", color: olive, values: channelInStore }]}
                    />
                  ) : (
                    <EmptyState title="No POS sales on file for the last 12 months" />
                  )}
                </div>
              </Card>
            )}
            <Card title="Online sales" note="Last 12 months · Financials sheet" href="/marketing" hrefLabel="Marketing">
              <div className="as-card-pad">
                {channelOnline.some((v) => v !== null) ? (
                  <ColumnChart
                    size="third"
                    ariaLabel="Online sales by month"
                    xLabels={chartLabels}
                    tipTitles={chartTitles}
                    format={idr}
                    axisFormat={idrCompact}
                    missingNote="not reported"
                    stacks={[{ label: "Online", color: copper, values: channelOnline }]}
                  />
                ) : (
                  <EmptyState title="No online sales reported for the last 12 months" />
                )}
              </div>
            </Card>
            <Card title="Marketing spend" note="Last 12 months · Financials sheet" href="/marketing/financials" hrefLabel="Financials">
              <div className="as-card-pad">
                {channelSpend.some((v) => v !== null) ? (
                  <ColumnChart
                    size="third"
                    ariaLabel="Marketing spend by month"
                    xLabels={chartLabels}
                    tipTitles={chartTitles}
                    format={idr}
                    axisFormat={idrCompact}
                    missingNote="not reported"
                    stacks={[{ label: "Total spend", color: blue, values: channelSpend }]}
                  />
                ) : (
                  <EmptyState title="No spend reported for the last 12 months" />
                )}
              </div>
            </Card>
          </div>
          <p className="mt-2 text-xs text-muted">
            Each chart has its own scale - in-store revenue, online sales and spend differ by orders of magnitude, so
            compare their shapes month to month, not their heights against each other.
          </p>
        </>
      )}

      {(seesMembers || seesSales) && (
        <>
          <h2 className="as-eyebrow mb-3 mt-10">Customers</h2>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {seesMembers && (
              <>
                <Stat
                  label="Members"
                  value={members ? num(members.total) : null}
                  note={members ? "Signed up through the in-store QR" : "Membership isn't set up yet"}
                  href="/membership"
                />
                <Stat
                  label="New members"
                  value={members ? num(members.joinedInPeriod) : null}
                  note={members ? `Joined ${period.rangeLabel}` : undefined}
                  href="/membership"
                />
              </>
            )}
            <div className="as-stat col-span-2">
              <div className="as-stat-label">New vs returning customers · repeat purchase rate</div>
              <div className="as-stat-value" data-empty="true">
                No data
              </div>
              <div className="as-stat-foot">
                POS orders are synced without a customer attached and the online store isn&apos;t connected, so there is
                nothing to tell a first purchase from a repeat one. Syncing the customer on each Odoo order, or
                connecting Shopify, would make this measurable.
              </div>
            </div>
          </div>
        </>
      )}

      {!seesSales && !seesMarketing && !seesMembers && (
        <EmptyState title="Nothing to show">Your role doesn&apos;t include any reporting sections yet.</EmptyState>
      )}
    </>
  );
}
