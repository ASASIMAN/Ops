import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessModule } from "@/components/shell/nav-config";
import { TrendChart, type TrendSeries } from "@/components/ui/charts";
import { Card, EmptyState, NeedsMigration } from "@/components/ui/card";
import { PeriodPicker } from "@/components/ui/period-picker";
import { SubmitButton } from "@/components/ui/submit-button";
import { change, changeText, idr, idrCompact, num, pct } from "@/lib/biz/format";
import { addDays, addMonths, baliStartTs, daysBetween, resolvePeriod, startOfMonth } from "@/lib/biz/period";
import { ROLLUPS_MIGRATION, fetchSalesByShop, fetchSeriesByShop, fetchShops } from "@/lib/biz/sales";
import { bucketsFor } from "@/lib/biz/trend";
import { baliToday, getShellContext } from "@/lib/shell/context";
import { ASASI_PALETTE, CONTEXT_SERIES_COLOR } from "@/lib/viz/palette";
import { saveStoreTargetsAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stores" };

const MONTH_LONG = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const TARGET_EDITORS = ["admin", "ops"];

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; store?: string; tm?: string; saved?: string; error?: string }>;
}) {
  const [params, { role }] = await Promise.all([searchParams, getShellContext()]);
  if (!canAccessModule(role, "operations")) {
    return <EmptyState title="Not part of your role">Sales reporting isn&apos;t included in your access.</EmptyState>;
  }

  const today = baliToday();
  const period = resolvePeriod(params, today);
  const admin = createAdminClient();
  const canEditTargets = TARGET_EDITORS.includes(role);

  // Targets are per calendar month; default to the month the period ends in.
  const targetMonth = params.tm && /^\d{4}-\d{2}-01$/.test(params.tm) ? params.tm : startOfMonth(period.to);
  const monthEnd = addDays(addMonths(targetMonth, 1), -1);
  const monthLastDayWithSales = monthEnd < today ? monthEnd : today;
  const monthWindow = { fromTs: baliStartTs(targetMonth), toTs: baliStartTs(addMonths(targetMonth, 1)) };

  const { shops, shopByStoreId } = await fetchShops(admin);
  const [byShop, prevByShop, series, monthByShop, targetsRes] = await Promise.all([
    fetchSalesByShop(admin, period, shopByStoreId),
    fetchSalesByShop(admin, period.prev, shopByStoreId),
    fetchSeriesByShop(admin, period, period.bucket, shopByStoreId),
    fetchSalesByShop(admin, monthWindow, shopByStoreId),
    admin.from("store_targets").select("store_key, target_idr").eq("month", targetMonth),
  ]);

  const rows = byShop.ok ? byShop.data.filter((s) => s.revenue !== 0 || s.units !== 0) : [];
  const prevByKey = new Map((prevByShop.ok ? prevByShop.data : []).map((s) => [s.key, s]));
  const total = rows.reduce(
    (acc, s) => ({ revenue: acc.revenue + s.revenue, units: acc.units + s.units, orders: acc.orders + (s.orders ?? 0) }),
    { revenue: 0, units: 0, orders: 0 },
  );
  const hasOrders = rows.every((s) => s.orders !== null);
  const prevTotalRevenue = (prevByShop.ok ? prevByShop.data : []).reduce((sum, s) => sum + s.revenue, 0);

  // Trend: the top shops get identity colours; anything beyond the palette folds into "Other".
  const buckets = bucketsFor(period, period.bucket);
  const seriesByKey = new Map((series.ok ? series.data : []).map((s) => [s.key, s]));
  const ranked = rows.map((r) => r.key).filter((k) => seriesByKey.has(k));
  const identity = ranked.slice(0, ASASI_PALETTE.length);
  const rest = ranked.slice(ASASI_PALETTE.length);
  const valueAt = (key: string, start: string) => seriesByKey.get(key)?.points.get(start)?.revenue ?? null;
  const trend: TrendSeries[] = identity.map((key, i) => ({
    label: seriesByKey.get(key)!.name,
    color: ASASI_PALETTE[i].light,
    values: buckets.map((b) => (b.start > today ? null : valueAt(key, b.start))),
  }));
  if (rest.length) {
    trend.push({
      label: `Other (${rest.length})`,
      color: CONTEXT_SERIES_COLOR,
      values: buckets.map((b) => {
        if (b.start > today) return null;
        const parts = rest.map((k) => valueAt(k, b.start)).filter((v): v is number => v !== null);
        return parts.length ? parts.reduce((a, v) => a + v, 0) : null;
      }),
    });
  }

  const targetsMissing = Boolean(targetsRes.error);
  const targetByKey = new Map(((targetsRes.data ?? []) as { store_key: string; target_idr: number }[]).map((t) => [t.store_key, Number(t.target_idr)]));
  const monthActual = new Map((monthByShop.ok ? monthByShop.data : []).map((s) => [s.key, s.revenue]));
  const daysInMonth = daysBetween(targetMonth, monthEnd);
  const daysElapsed = targetMonth > today ? 0 : daysBetween(targetMonth, monthLastDayWithSales);

  const periodQuery = `period=${period.key}${period.key === "custom" ? `&from=${period.from}&to=${period.to}` : ""}`;
  const selfHref = (tm: string) => `/sales/stores?${periodQuery}&tm=${tm}`;

  return (
    <>
      <div className="as-page-head">
        <div>
          <h1 className="as-page-title">Stores</h1>
          <p className="as-page-desc">
            {period.rangeLabel} <span className="text-faint">·</span> compared {period.prev.label.replace(/^vs /, "with ")}.
            Registers of the same shop are counted together.
          </p>
        </div>
        <PeriodPicker basePath="/sales/stores" period={period} keep={{ tm: params.tm }} />
      </div>

      {!byShop.ok && <p className="as-notice as-notice-bad mb-4">Store figures couldn&apos;t be loaded: {byShop.error}</p>}

      <Card title="Store comparison" note={period.rangeLabel}>
        {rows.length > 0 ? (
          <div className="as-table-wrap">
            <table className="as-table">
              <thead>
                <tr>
                  <th>Store</th>
                  <th className="as-num">Revenue</th>
                  <th style={{ width: "16%" }}>Share</th>
                  <th className="as-num">{period.prev.label}</th>
                  <th className="as-num">Orders</th>
                  <th className="as-num">Average order</th>
                  <th className="as-num">Units</th>
                  <th className="as-num">Units / order</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const c = change(s.revenue, prevByKey.get(s.key)?.revenue);
                  const share = total.revenue > 0 ? (s.revenue / total.revenue) * 100 : 0;
                  return (
                    <tr key={s.key} className={params.store === s.key ? "bg-surface-2" : undefined}>
                      <td>
                        <Link href={`/sales?${periodQuery}&store=${encodeURIComponent(s.key)}`}>{s.name}</Link>
                      </td>
                      <td className="as-num">{idr(s.revenue)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="as-bar flex-1">
                            <span style={{ width: `${Math.max(0, share)}%` }} />
                          </div>
                          <span className="w-9 text-right text-xs text-muted">{pct(share, 0)}</span>
                        </div>
                      </td>
                      <td className={`as-num ${c.direction === "up" ? "as-up" : c.direction === "down" ? "as-down" : "text-faint"}`}>
                        {changeText(c) ?? "nothing to compare"}
                      </td>
                      <td className="as-num">{s.orders !== null ? num(s.orders) : "-"}</td>
                      <td className="as-num">{s.orders ? idr(s.revenue / s.orders) : "-"}</td>
                      <td className="as-num">{num(s.units)}</td>
                      <td className="as-num">{s.orders ? (s.units / s.orders).toFixed(2) : "-"}</td>
                    </tr>
                  );
                })}
                <tr className="font-medium">
                  <td>All stores</td>
                  <td className="as-num">{idr(total.revenue)}</td>
                  <td />
                  <td className="as-num">{changeText(change(total.revenue, prevTotalRevenue)) ?? ""}</td>
                  <td className="as-num">{hasOrders ? num(total.orders) : "-"}</td>
                  <td className="as-num">{hasOrders && total.orders ? idr(total.revenue / total.orders) : "-"}</td>
                  <td className="as-num">{num(total.units)}</td>
                  <td className="as-num">{hasOrders && total.orders ? (total.units / total.orders).toFixed(2) : "-"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No store sales in this period">Nothing has been synced from Odoo for {period.rangeLabel}.</EmptyState>
        )}
        {!hasOrders && rows.length > 0 && (
          <p className="border-t border-line px-5 py-3 text-xs text-muted">
            Orders and average order per store need <code className="font-mono">{ROLLUPS_MIGRATION}</code>.
          </p>
        )}
      </Card>

      <Card
        className="mt-4"
        title="Revenue by store over time"
        note={`${period.bucket === "day" ? "Per day" : period.bucket === "week" ? "Per week" : "Per month"}, Bali time`}
      >
        <div className="as-card-pad">
          {!series.ok && series.missing ? (
            <NeedsMigration file={ROLLUPS_MIGRATION} />
          ) : trend.some((s) => s.values.some((v) => v !== null)) ? (
            <TrendChart
              ariaLabel="Revenue per store over the selected period"
              size="full"
              height={280}
              xLabels={buckets.map((b) => b.label)}
              tipTitles={buckets.map((b) => b.title)}
              format={idr}
              axisFormat={idrCompact}
              series={trend}
            />
          ) : (
            <EmptyState title="No store sales in this period" />
          )}
        </div>
      </Card>

      <Card
        className="mt-4"
        title={`Targets · ${MONTH_LONG.format(new Date(`${targetMonth}T00:00:00Z`))}`}
        note={
          daysElapsed === 0
            ? "This month hasn't started."
            : `${daysElapsed} of ${daysInMonth} days elapsed (${pct((daysElapsed / daysInMonth) * 100, 0)} of the month). Actual is revenue so far that month.`
        }
      >
        <div className="flex items-center gap-4 border-b border-line px-5 py-3">
          <Link href={selfHref(addMonths(targetMonth, -1))} className="as-link" scroll={false}>
            ← {MONTH_LONG.format(new Date(`${addMonths(targetMonth, -1)}T00:00:00Z`))}
          </Link>
          <Link href={selfHref(addMonths(targetMonth, 1))} className="as-link" scroll={false}>
            {MONTH_LONG.format(new Date(`${addMonths(targetMonth, 1)}T00:00:00Z`))} →
          </Link>
          {params.saved && <span className="as-badge as-badge-good">Targets saved</span>}
          {params.error && <span className="as-badge as-badge-bad">{params.error}</span>}
        </div>
        {targetsMissing ? (
          <NeedsMigration file={ROLLUPS_MIGRATION} />
        ) : (
          <form action={saveStoreTargetsAction}>
            <input type="hidden" name="month" value={targetMonth} />
            <input type="hidden" name="returnTo" value={selfHref(targetMonth)} />
            <div className="as-table-wrap">
              <table className="as-table">
                <thead>
                  <tr>
                    <th>Store</th>
                    <th className="as-num">Target</th>
                    <th className="as-num">Actual</th>
                    <th style={{ width: "30%" }}>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {shops.map((s) => {
                    const target = targetByKey.get(s.key);
                    const actual = monthActual.get(s.key) ?? 0;
                    const reached = target ? (actual / target) * 100 : null;
                    return (
                      <tr key={s.key}>
                        <td>{s.name}</td>
                        <td className="as-num">
                          {canEditTargets ? (
                            <input
                              name={`target:${s.key}`}
                              defaultValue={target !== undefined ? new Intl.NumberFormat("id-ID").format(target) : ""}
                              inputMode="numeric"
                              placeholder="No target"
                              aria-label={`${s.name} target in rupiah`}
                              className="as-input w-44 text-right"
                            />
                          ) : target !== undefined ? (
                            idr(target)
                          ) : (
                            <span className="text-faint">No target</span>
                          )}
                        </td>
                        <td className="as-num">{idr(actual)}</td>
                        <td>
                          {reached !== null ? (
                            <div className="flex items-center gap-3">
                              <div className="as-bar flex-1">
                                <span style={{ width: `${Math.min(100, Math.max(0, reached))}%` }} />
                              </div>
                              <span className="w-12 text-right text-xs">{pct(reached, 0)}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-faint">Set a target to track progress</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {canEditTargets ? (
              <div className="flex items-center gap-4 border-t border-line px-5 py-3">
                <SubmitButton pendingLabel="Saving…">Save targets</SubmitButton>
                <span className="text-xs text-muted">Rupiah, whole month. Leave a field blank for no target.</span>
              </div>
            ) : (
              <p className="border-t border-line px-5 py-3 text-xs text-muted">Targets are set by admin or ops.</p>
            )}
          </form>
        )}
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Staff performance">
          <EmptyState title="No data">
            The Odoo sync brings in each order&apos;s store, time and lines, but not the cashier who rang it up, so sales
            can&apos;t be split by staff member yet.
          </EmptyState>
        </Card>
        <Card title="Store forecasts" href="/forecast/overview" hrefLabel="Forecast overview">
          <div className="as-card-pad text-[0.8125rem] text-muted">
            Revenue and demand forecasts per store, restock timing and forecast accuracy live in Inventory → Forecast
            overview. They are built on the same synced sales shown here.
          </div>
        </Card>
      </div>
    </>
  );
}
