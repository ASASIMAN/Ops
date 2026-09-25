import { createAdminClient } from "@/lib/supabase/admin";
import { syncStockNowAction } from "./actions";
import { paletteCss } from "@/lib/viz/palette";
import { niceStep, linePath, bandPath, type Point } from "@/lib/viz/chart-utils";
import {
  forecast,
  type Period,
  type ForecastResult,
} from "@/lib/forecast/engine";
import {
  demandStatsFromDaily,
  computeReorder,
  combinedRisk,
  suggestedTransferSplit,
  FALLBACK_LEAD_TIME_DAYS,
  FALLBACK_TRANSFER_LEAD_TIME_DAYS,
  type CombinedRisk,
} from "@/lib/forecast/restock";
import {
  fetchPeriodDemand,
  fetchStockLevels,
  fetchReorderSettings,
  fetchProductLookup,
  reorderSettingsFor,
  hasForecastSchema,
} from "@/lib/forecast/data";
import { totalSeries, groupSeries, type DemandRow } from "@/lib/forecast/aggregate";

export const dynamic = "force-dynamic";
// Same reasoning as /operations: several sequential Supabase calls (and,
// via the "Sync stock now" button, several Odoo RPCs) need more than the
// platform's short default duration.
export const maxDuration = 60;

const HISTORY_MONTHS = 12;
const FORECAST_HORIZON_MONTHS = 3;
const RESTOCK_WINDOW_DAYS = 90;
const TOP_N_DEFAULT = 10;
const SELLER_RANGE_DAYS_DEFAULT = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const HIDDEN_STORE_NAMES = new Set(["nsa"]); // pre-opening store - same exclusion as /operations

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const unitFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const pctFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const monthLabelFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "short",
  year: "2-digit",
});

function nowIso() {
  return new Date().toISOString();
}
function monthsAgoIso(n: number) {
  return new Date(new Date().getTime() - n * 30 * DAY_MS).toISOString();
}
function daysAgoIso(n: number) {
  return new Date(new Date().getTime() - n * DAY_MS).toISOString();
}
function isoDay(dateStr: string) {
  return `${dateStr}T00:00:00Z`;
}

/** Unwraps a Supabase call into a typed row array, matching /operations' `rollup<T>` so an un-migrated database degrades with a message instead of throwing. */
async function unwrap<T>(
  call: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: string | null }> {
  const { data, error } = await call;
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as T[], error: null };
}

interface SearchParams {
  store?: string;
  months?: string;
  horizon?: string;
  topN?: string;
  from?: string;
  to?: string;
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-lg font-medium">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
    </div>
  );
}

function AssumptionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
      {children}
    </p>
  );
}

function RiskBadge({ risk }: { risk: CombinedRisk }) {
  const styles: Record<CombinedRisk, string> = {
    red: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400",
    yellow: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
  };
  const labels: Record<CombinedRisk, string> = { red: "Both low", yellow: "One low", green: "OK" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[risk]}`}>
      {labels[risk]}
    </span>
  );
}

/** Compares the first vs. second half of a series' fitted level to call a plain rising/falling/flat direction - reuses the same engine fit rather than a separate slope calc. */
function trendDirection(series: Period[]): "rising" | "falling" | "flat" {
  if (series.length < 2) return "flat";
  const result = forecast(series, { horizon: 0 });
  const mid = Math.floor(result.fitted.length / 2);
  const firstHalf = result.fitted.slice(0, Math.max(mid, 1));
  const secondHalf = result.fitted.slice(mid);
  const avg = (pts: typeof result.fitted) =>
    pts.reduce((s, p) => s + p.level, 0) / (pts.length || 1);
  const a = avg(firstHalf);
  const b = avg(secondHalf);
  if (a === 0) return b > 0 ? "rising" : "flat";
  const change = (b - a) / Math.abs(a);
  if (change > 0.1) return "rising";
  if (change < -0.1) return "falling";
  return "flat";
}

function TrendArrow({ direction }: { direction: "rising" | "falling" | "flat" }) {
  if (direction === "rising") return <span className="text-emerald-600 dark:text-emerald-400">▲</span>;
  if (direction === "falling") return <span className="text-red-600 dark:text-red-400">▼</span>;
  return <span className="text-zinc-400">–</span>;
}

const CHART_W = 720;
const CHART_H = 220;
const PAD_L = 56;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 22;

/** One shared line+band chart for actual/fitted history plus an expected/low/high forecast - used by revenue (§2), demand (§3), and accuracy (§5). */
function ForecastChart({
  fitted,
  forecastPoints,
  valueLabel,
  formatValue,
  ariaLabel,
}: {
  fitted: { date: string; actual: number; level: number }[];
  forecastPoints: { date: string; expected: number; low: number; high: number }[];
  valueLabel: string;
  formatValue: (v: number) => string;
  ariaLabel: string;
}) {
  const allDates = [...fitted.map((f) => f.date), ...forecastPoints.map((f) => f.date)];
  if (allDates.length < 2) {
    return <p className="mt-2 text-xs text-zinc-500">Not enough history yet to chart {valueLabel}.</p>;
  }

  const maxValue = Math.max(
    1,
    ...fitted.map((f) => f.actual),
    ...forecastPoints.map((f) => f.high),
  );
  const step = niceStep(maxValue / 4);
  const yMax = step * 5;
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;

  const xFor = (i: number) => PAD_L + (allDates.length <= 1 ? 0 : (i / (allDates.length - 1)) * plotW);
  const yFor = (v: number) => PAD_T + plotH - (Math.min(v, yMax) / yMax) * plotH;

  const actualPoints: Point[] = fitted.map((f, i) => ({ x: xFor(i), y: yFor(f.actual) }));
  const levelPoints: Point[] = fitted.map((f, i) => ({ x: xFor(i), y: yFor(f.level) }));
  const forecastOffset = fitted.length - 1; // forecast line starts where the fitted trend line ends
  const expectedPoints: Point[] = [
    { x: xFor(forecastOffset), y: yFor(fitted[fitted.length - 1]?.level ?? 0) },
    ...forecastPoints.map((f, i) => ({ x: xFor(forecastOffset + 1 + i), y: yFor(f.expected) })),
  ];
  const bandTop: Point[] = [
    { x: xFor(forecastOffset), y: yFor(fitted[fitted.length - 1]?.level ?? 0) },
    ...forecastPoints.map((f, i) => ({ x: xFor(forecastOffset + 1 + i), y: yFor(f.high) })),
  ];
  const bandBottom: Point[] = [
    { x: xFor(forecastOffset), y: yFor(fitted[fitted.length - 1]?.level ?? 0) },
    ...forecastPoints.map((f, i) => ({ x: xFor(forecastOffset + 1 + i), y: yFor(f.low) })),
  ];

  const ticks = Array.from({ length: 5 }, (_, i) => step * (i + 1));
  const xLabels = allDates.filter((_, i) => i % Math.ceil(allDates.length / 8 || 1) === 0);

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="mt-3 h-auto w-full" role="img" aria-label={ariaLabel}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD_L} x2={CHART_W - PAD_R} y1={yFor(t)} y2={yFor(t)} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeWidth={1} />
          <text x={PAD_L - 6} y={yFor(t) + 3} textAnchor="end" className="fill-zinc-400 text-[9px]">
            {formatValue(t)}
          </text>
        </g>
      ))}
      <path d={bandPath(bandTop, bandBottom)} className="fill-zinc-300/40 dark:fill-zinc-600/30" />
      <path d={linePath(actualPoints)} fill="none" stroke="currentColor" className="text-zinc-400 dark:text-zinc-600" strokeWidth={1.5} />
      <path d={linePath(levelPoints)} fill="none" stroke="currentColor" className="text-zinc-800 dark:text-zinc-200" strokeWidth={2} />
      <path d={linePath(expectedPoints)} fill="none" strokeDasharray="4 3" stroke="currentColor" className="text-zinc-800 dark:text-zinc-200" strokeWidth={2} />
      {xLabels.map((d) => {
        const i = allDates.indexOf(d);
        return (
          <text key={d} x={xFor(i)} y={CHART_H - PAD_B + 14} textAnchor="middle" className="fill-zinc-400 text-[9px]">
            {monthLabelFormatter.format(new Date(isoDay(d)))}
          </text>
        );
      })}
    </svg>
  );
}

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Forecasting</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Not set up yet - SUPABASE_SERVICE_ROLE_KEY is missing.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const supabase = createAdminClient();

  const schemaOk = await hasForecastSchema(supabase);
  if (!schemaOk) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Forecasting</h1>
        <AssumptionNote>
          Not shown yet - run{" "}
          <code>supabase/migrations/0023_forecast_inventory.sql</code> in the
          Supabase SQL editor, then sync stock (Odoo) before this page has
          anything to show.
        </AssumptionNote>
      </div>
    );
  }

  const months = Math.max(3, Number(params.months) || HISTORY_MONTHS);
  const horizon = Math.max(1, Number(params.horizon) || FORECAST_HORIZON_MONTHS);
  const topN = Math.max(1, Number(params.topN) || TOP_N_DEFAULT);
  const selectedStoreId = params.store && params.store !== "all" ? Number(params.store) : null;

  const to = params.to || new Date().toISOString().slice(0, 10);
  const from = params.from || new Date(new Date().getTime() - SELLER_RANGE_DAYS_DEFAULT * DAY_MS).toISOString().slice(0, 10);
  const sellerFromIso = isoDay(from);
  const sellerToIso = isoDay(new Date(new Date(isoDay(to)).getTime() + DAY_MS).toISOString().slice(0, 10));

  const returnTo = `/forecast${new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  ).toString() ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString()}` : ""}`;

  const [
    { data: storeRows },
    { data: lastSalesSync },
    { data: lastStockSync },
    monthlyDemand,
    restockDailyDemand,
    sellerRangeDemand,
    stockLevelsResult,
    reorderSettings,
    productLookup,
    topVariantsResult,
  ] = await Promise.all([
    supabase.from("stores").select("id, name").eq("active", true).order("name"),
    supabase.from("sync_runs").select("status, started_at").eq("sync_type", "sales").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sync_runs").select("status, started_at").eq("sync_type", "stock").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    fetchPeriodDemand(supabase, {
      from: monthsAgoIso(months),
      to: nowIso(),
      bucket: "month",
      storeIds: selectedStoreId ? [selectedStoreId] : null,
    }),
    // Restock (§1) always looks at every store's own stock regardless of
    // the page's store filter - the vendor/transfer alerts are about the
    // physical stock network, not a single store's view of it.
    fetchPeriodDemand(supabase, { from: daysAgoIso(RESTOCK_WINDOW_DAYS), to: nowIso(), bucket: "day", storeIds: null }),
    fetchPeriodDemand(supabase, {
      from: sellerFromIso,
      to: sellerToIso,
      bucket: "day",
      storeIds: selectedStoreId ? [selectedStoreId] : null,
    }),
    fetchStockLevels(supabase),
    fetchReorderSettings(supabase),
    fetchProductLookup(supabase),
    unwrap<{
      product_id: number;
      product_name: string;
      sku: string | null;
      category_name: string | null;
      units: number;
      revenue: number;
    }>(
      supabase.rpc("ops_top_variants", {
        p_from: sellerFromIso,
        p_to: sellerToIso,
        p_store_ids: selectedStoreId ? [selectedStoreId] : null,
        p_colors: null,
        p_sizes: null,
        p_types: null,
        p_limit: 100000, // effectively unlimited at this data volume - need the full ranked list to read off both ends (top *and* bottom sellers)
      }),
    ),
  ]);

  const stores = (storeRows ?? []).filter((s) => !HIDDEN_STORE_NAMES.has(s.name.trim().toLowerCase()));
  const storesById = new Map(stores.map((s) => [s.id, s.name]));

  // ---------------------------------------------------------------------
  // §1 Restock timing & quantity (two-tier)
  // ---------------------------------------------------------------------
  const officeQtyByProduct = new Map<number, number>();
  const storeQtyByProductThenStore = new Map<number, Map<number, number>>();
  for (const r of stockLevelsResult.rows) {
    if (r.kind === "office") {
      officeQtyByProduct.set(r.productId, (officeQtyByProduct.get(r.productId) ?? 0) + r.qty);
    } else if (r.storeId != null) {
      if (!storeQtyByProductThenStore.has(r.productId)) storeQtyByProductThenStore.set(r.productId, new Map());
      const m = storeQtyByProductThenStore.get(r.productId)!;
      m.set(r.storeId, (m.get(r.storeId) ?? 0) + r.qty);
    }
  }

  const restockUniverse = new Set<number>([
    ...officeQtyByProduct.keys(),
    ...storeQtyByProductThenStore.keys(),
    ...restockDailyDemand.rows.map((r) => r.product_id),
  ]);

  const companySeriesByProduct = groupSeries(restockDailyDemand.rows, (r) => r.product_id, "units");
  const storeSeriesByProductThenStore = new Map<number, Map<number, Period[]>>();
  for (const r of restockDailyDemand.rows) {
    if (r.store_id == null) continue;
    if (!storeSeriesByProductThenStore.has(r.product_id)) storeSeriesByProductThenStore.set(r.product_id, new Map());
    const byStore = storeSeriesByProductThenStore.get(r.product_id)!;
    const existing = byStore.get(r.store_id) ?? [];
    existing.push({ date: r.bucket_date, value: r.units });
    byStore.set(r.store_id, existing);
  }

  interface RestockRow {
    productId: number;
    name: string;
    sku: string | null;
    officeQty: number;
    storeQtys: { storeId: number; storeName: string; qty: number; isLow: boolean }[];
    vendorIsLow: boolean;
    vendorSuggestedQty: number;
    usedFallbackLeadTime: boolean;
    risk: CombinedRisk;
    transferSplit: { storeId: number; storeName: string; qty: number }[];
  }

  const restockRows: RestockRow[] = [];
  for (const productId of restockUniverse) {
    const product = productLookup.get(productId);
    const officeQty = officeQtyByProduct.get(productId) ?? 0;
    const storeQtyMap = storeQtyByProductThenStore.get(productId) ?? new Map<number, number>();
    const combinedQty = officeQty + Array.from(storeQtyMap.values()).reduce((a, b) => a + b, 0);

    const companySeries = companySeriesByProduct.get(productId) ?? [];
    const companyStats = demandStatsFromDaily(companySeries);
    const settings = reorderSettingsFor(productId, reorderSettings);
    const vendorCalc = computeReorder(
      companyStats,
      combinedQty,
      settings.leadTimeDays,
      settings.targetServiceLevel,
      FALLBACK_LEAD_TIME_DAYS,
    );

    const storeSeriesMap = storeSeriesByProductThenStore.get(productId) ?? new Map<number, Period[]>();
    const storeQtys: RestockRow["storeQtys"] = [];
    const storeRatesForSplit: { storeId: number; dailyRate: number }[] = [];
    let anyStoreLow = false;
    for (const store of stores) {
      const qty = storeQtyMap.get(store.id) ?? 0;
      const series = storeSeriesMap.get(store.id) ?? [];
      const stats = demandStatsFromDaily(series);
      const calc = computeReorder(stats, qty, null, settings.targetServiceLevel, FALLBACK_TRANSFER_LEAD_TIME_DAYS);
      if (calc.isLow) anyStoreLow = true;
      storeQtys.push({ storeId: store.id, storeName: store.name, qty, isLow: calc.isLow });
      storeRatesForSplit.push({ storeId: store.id, dailyRate: stats.dailyRate });
    }

    // Only worth showing on SKUs that actually touch the store network -
    // skip pure noise rows with zero stock everywhere and no recent sales.
    if (combinedQty === 0 && companySeries.every((p) => p.value === 0)) continue;

    const risk = combinedRisk(vendorCalc.isLow, anyStoreLow);
    const split =
      vendorCalc.suggestedOrderQty > 0
        ? suggestedTransferSplit(vendorCalc.suggestedOrderQty, storeRatesForSplit).map((s) => ({
            storeId: s.storeId,
            storeName: storesById.get(s.storeId) ?? "?",
            qty: s.qty,
          }))
        : [];

    restockRows.push({
      productId,
      name: product?.name ?? `#${productId}`,
      sku: product?.sku ?? null,
      officeQty,
      storeQtys,
      vendorIsLow: vendorCalc.isLow,
      vendorSuggestedQty: vendorCalc.suggestedOrderQty,
      usedFallbackLeadTime: vendorCalc.usedFallbackLeadTime,
      risk,
      transferSplit: split,
    });
  }

  const riskOrder: Record<CombinedRisk, number> = { red: 0, yellow: 1, green: 2 };
  restockRows.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk] || a.name.localeCompare(b.name));
  const flaggedRestockRows = restockRows.filter((r) => r.risk !== "green");
  const anyUsedFallbackLeadTime = restockRows.some((r) => r.usedFallbackLeadTime);

  // ---------------------------------------------------------------------
  // §2 Revenue forecast & §3 demand forecast share the same monthly rows -
  // only the value field (revenue vs. units) differs.
  // ---------------------------------------------------------------------
  function buildForecast(rows: DemandRow[], field: "revenue" | "units"): ForecastResult {
    return forecast(totalSeries(rows, field), { horizon });
  }

  const revenueForecast = buildForecast(monthlyDemand.rows, "revenue");
  const demandForecast = buildForecast(monthlyDemand.rows, "units");

  const revenueByStore = groupSeries(monthlyDemand.rows, (r) => r.store_id, "revenue");
  const revenueByStoreForecast = Array.from(revenueByStore.entries()).map(([storeId, series]) => ({
    storeId,
    storeName: storesById.get(storeId) ?? `#${storeId}`,
    result: forecast(series, { horizon }),
  }));

  const revenueByCategory = groupSeries(monthlyDemand.rows, (r) => r.category_id, "revenue");
  const categoryNameById = new Map<number, string>();
  for (const p of productLookup.values()) {
    if (p.categoryId != null && p.categoryName) categoryNameById.set(p.categoryId, p.categoryName);
  }
  const revenueByCategoryForecast = Array.from(revenueByCategory.entries())
    .map(([categoryId, series]) => ({
      categoryId,
      categoryName: categoryNameById.get(categoryId) ?? `#${categoryId}`,
      result: forecast(series, { horizon: 1 }),
      totalRevenue: series.reduce((s, p) => s + p.value, 0),
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  const demandBySku = groupSeries(monthlyDemand.rows, (r) => r.product_id, "units");
  const demandBySkuForecast = Array.from(demandBySku.entries())
    .map(([productId, series]) => ({
      productId,
      name: productLookup.get(productId)?.name ?? `#${productId}`,
      sku: productLookup.get(productId)?.sku ?? null,
      result: forecast(series, { horizon: 1 }),
    }))
    .sort((a, b) => (b.result.forecast[0]?.expected ?? 0) - (a.result.forecast[0]?.expected ?? 0))
    .slice(0, topN);

  // ---------------------------------------------------------------------
  // §4 Top & low sellers, cross-referenced with stock
  // ---------------------------------------------------------------------
  const soldVariants = topVariantsResult.rows;
  const soldProductIds = new Set(soldVariants.map((v) => v.product_id));
  const topSellers = soldVariants.slice(0, topN);
  const bottomSellers = soldVariants
    .slice(-topN)
    .reverse()
    .filter((v) => !topSellers.some((t) => t.product_id === v.product_id));

  const sellerTrendProductIds = [...topSellers, ...bottomSellers].map((v) => v.product_id);
  const sellerDailySeriesByProduct = groupSeries(
    sellerRangeDemand.rows.filter((r) => sellerTrendProductIds.includes(r.product_id)),
    (r) => r.product_id,
    "units",
  );

  function stockRiskFor(productId: number): { atRisk: boolean; officeQty: number } {
    const row = restockRows.find((r) => r.productId === productId);
    return { atRisk: row ? row.risk !== "green" : false, officeQty: officeQtyByProduct.get(productId) ?? 0 };
  }

  const deadStockZeroSale = Array.from(officeQtyByProduct.entries())
    .filter(([productId, qty]) => qty > 0 && !soldProductIds.has(productId))
    .map(([productId, qty]) => ({
      productId,
      name: productLookup.get(productId)?.name ?? `#${productId}`,
      sku: productLookup.get(productId)?.sku ?? null,
      officeQty: qty,
    }))
    .sort((a, b) => b.officeQty - a.officeQty)
    .slice(0, topN);

  // ---------------------------------------------------------------------
  // §5 Forecast vs. actual - rolling-origin backtest over the same
  // monthly company series §2/§3 already forecast from. Each point
  // forecasts month i from months [0..i) only, so it's a genuine
  // out-of-sample check, not the in-sample fit shown in the chart above.
  // ---------------------------------------------------------------------
  const companyMonthly = totalSeries(monthlyDemand.rows, "revenue");
  interface BacktestPoint {
    date: string;
    predicted: number;
    actual: number;
    ape: number | null; // null when actual = 0 - can't express a % error against zero
    cumulativeMape: number | null;
  }
  const backtest: BacktestPoint[] = [];
  {
    let apeSum = 0;
    let apeCount = 0;
    for (let i = 1; i < companyMonthly.length; i++) {
      const train = companyMonthly.slice(0, i);
      const actual = companyMonthly[i].value;
      const predicted = forecast(train, { horizon: 1 }).forecast[0]?.expected ?? 0;
      const ape = actual !== 0 ? Math.abs(predicted - actual) / Math.abs(actual) : null;
      if (ape !== null) {
        apeSum += ape;
        apeCount++;
      }
      backtest.push({
        date: companyMonthly[i].date,
        predicted,
        actual,
        ape,
        cumulativeMape: apeCount > 0 ? (apeSum / apeCount) * 100 : null,
      });
    }
  }
  const overallMape =
    backtest.length && backtest.some((b) => b.ape !== null)
      ? (backtest.reduce((s, b) => s + (b.ape ?? 0), 0) / backtest.filter((b) => b.ape !== null).length) * 100
      : null;

  const skuBacktestMape = demandBySkuForecast.slice(0, 5).map(({ productId, name, sku }) => {
    const series = demandBySku.get(productId) ?? [];
    let apeSum = 0;
    let apeCount = 0;
    for (let i = 1; i < series.length; i++) {
      const train = series.slice(0, i);
      const actual = series[i].value;
      if (actual === 0) continue;
      const predicted = forecast(train, { horizon: 1 }).forecast[0]?.expected ?? 0;
      apeSum += Math.abs(predicted - actual) / Math.abs(actual);
      apeCount++;
    }
    return { productId, name, sku, mape: apeCount > 0 ? (apeSum / apeCount) * 100 : null, points: apeCount };
  });

  const storeOptions = stores;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <style dangerouslySetInnerHTML={{ __html: paletteCss("fc-scope", ["a", "b", "c"]) }} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Forecasting</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Restock alerts, revenue &amp; demand forecasts, and accuracy tracking - built on the same synced Odoo sales data as Operations.
          </p>
        </div>
        <form action={syncStockNowAction}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <button
            type="submit"
            className="rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
          >
            Sync stock now
          </button>
        </form>
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        Last sales sync: {lastSalesSync ? `${lastSalesSync.status} (${new Date(lastSalesSync.started_at).toLocaleString()})` : "never"}
        {" · "}
        Last stock sync: {lastStockSync ? `${lastStockSync.status} (${new Date(lastStockSync.started_at).toLocaleString()})` : "never"}
      </p>

      <form className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 text-xs dark:border-zinc-800" method="get">
        <label className="flex flex-col gap-1">
          Store (§2-3)
          <select name="store" defaultValue={params.store ?? "all"} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            <option value="all">All stores combined</option>
            {storeOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          History (months)
          <input type="number" name="months" min={3} max={36} defaultValue={months} className="w-20 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <label className="flex flex-col gap-1">
          Forecast horizon (months)
          <input type="number" name="horizon" min={1} max={12} defaultValue={horizon} className="w-20 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <label className="flex flex-col gap-1">
          Top/bottom N (§3-5)
          <input type="number" name="topN" min={1} max={50} defaultValue={topN} className="w-20 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <label className="flex flex-col gap-1">
          Sellers from (§4)
          <input type="date" name="from" defaultValue={from} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <label className="flex flex-col gap-1">
          Sellers to (§4)
          <input type="date" name="to" defaultValue={to} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <button type="submit" className="rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900">
          Apply
        </button>
      </form>

      {/* ------------------------------------------------------------- */}
      {/* §1 Restock timing & quantity                                   */}
      {/* ------------------------------------------------------------- */}
      <section className="mt-10">
        <SectionHeading
          title="Restock timing & quantity"
          subtitle={`Combined risk per SKU across office + ${stores.length} stores. Vendor alert compares combined stock to demand over lead time; store alerts are independent of office stock. ${restockDailyDemand.rows.length === 0 ? "" : `Demand rate from the last ${RESTOCK_WINDOW_DAYS} days.`}`}
        />
        {restockUniverse.size === 0 ? (
          <AssumptionNote>No stock data yet - use &quot;Sync stock now&quot; above.</AssumptionNote>
        ) : (
          <>
            {anyUsedFallbackLeadTime && (
              <AssumptionNote>
                Vendor lead time isn&apos;t loaded for these SKUs yet, so a
                placeholder of {FALLBACK_LEAD_TIME_DAYS} days is used for the
                vendor-level reorder point below (flagged per-row with *).
                Store-transfer timing always uses a placeholder internal
                transfer lead time of {FALLBACK_TRANSFER_LEAD_TIME_DAYS} days
                - there&apos;s no source for real transfer times yet either.
                Update <code>vendor_reorder_settings</code> once real numbers
                are available; no code change needed.
              </AssumptionNote>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="px-2 py-1">SKU</th>
                    <th className="px-2 py-1 text-right">Office qty</th>
                    <th className="px-2 py-1">Store stock (low = *)</th>
                    <th className="px-2 py-1 text-center">Risk</th>
                    <th className="px-2 py-1 text-right">Vendor order qty</th>
                    <th className="px-2 py-1">Suggested split of that order</th>
                  </tr>
                </thead>
                <tbody>
                  {flaggedRestockRows.length === 0 ? (
                    <tr><td colSpan={6} className="px-2 py-3 text-center text-zinc-500">Nothing flagged - all tracked SKUs are above their reorder point.</td></tr>
                  ) : (
                    flaggedRestockRows.map((r) => (
                      <tr key={r.productId} className="border-t border-zinc-100 dark:border-zinc-900">
                        <td className="px-2 py-1">{r.name}{r.sku ? ` (${r.sku})` : ""}</td>
                        <td className="px-2 py-1 text-right">{unitFormatter.format(r.officeQty)}</td>
                        <td className="px-2 py-1">
                          {r.storeQtys.map((s) => `${s.storeName}: ${unitFormatter.format(s.qty)}${s.isLow ? "*" : ""}`).join(", ")}
                        </td>
                        <td className="px-2 py-1 text-center"><RiskBadge risk={r.risk} /></td>
                        <td className="px-2 py-1 text-right">
                          {r.vendorIsLow ? `${unitFormatter.format(r.vendorSuggestedQty)}${r.usedFallbackLeadTime ? "*" : ""}` : "-"}
                        </td>
                        <td className="px-2 py-1">
                          {r.transferSplit.length ? r.transferSplit.map((s) => `${s.storeName}: ${unitFormatter.format(s.qty)}`).join(", ") : "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[10px] text-zinc-400">
              {flaggedRestockRows.length} of {restockRows.length} tracked SKUs flagged. &quot;Both low&quot; = office and at least one store are both under their reorder point (most urgent - a transfer alone can&apos;t fix it). &quot;One low&quot; = only one layer is low.
            </p>
          </>
        )}
      </section>

      {/* ------------------------------------------------------------- */}
      {/* §2 Revenue forecast                                            */}
      {/* ------------------------------------------------------------- */}
      <section className="mt-10">
        <SectionHeading
          title="Revenue forecast"
          subtitle={`${selectedStoreId ? storesById.get(selectedStoreId) ?? "Selected store" : "All stores combined"} - trailing ${months} months, ${horizon}-month forecast band (${demandForecast.method === "holt" ? "Holt exponential smoothing" : "moving average"}).`}
        />
        <ForecastChart
          fitted={revenueForecast.fitted}
          forecastPoints={revenueForecast.forecast}
          valueLabel="revenue"
          formatValue={(v) => currencyFormatter.format(v)}
          ariaLabel="Monthly revenue, actual and forecast"
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">Per store, next {horizon} month(s) total</h3>
            <table className="mt-1 w-full text-left text-xs">
              <tbody>
                {revenueByStoreForecast
                  .sort((a, b) => a.storeName.localeCompare(b.storeName))
                  .map(({ storeId, storeName, result }) => (
                    <tr key={storeId} className="border-t border-zinc-100 dark:border-zinc-900">
                      <td className="px-2 py-1">{storeName}</td>
                      <td className="px-2 py-1 text-right">
                        {currencyFormatter.format(result.forecast.reduce((s, f) => s + f.expected, 0))}
                        <span className="ml-1 text-zinc-400">
                          ({currencyFormatter.format(result.forecast.reduce((s, f) => s + f.low, 0))}-
                          {currencyFormatter.format(result.forecast.reduce((s, f) => s + f.high, 0))})
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="text-sm font-medium">By category, next month</h3>
            <table className="mt-1 w-full text-left text-xs">
              <tbody>
                {revenueByCategoryForecast.slice(0, 8).map(({ categoryId, categoryName, result }) => (
                  <tr key={categoryId} className="border-t border-zinc-100 dark:border-zinc-900">
                    <td className="px-2 py-1">{categoryName}</td>
                    <td className="px-2 py-1 text-right">{currencyFormatter.format(result.forecast[0]?.expected ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* §3 Monthly demand forecast                                     */}
      {/* ------------------------------------------------------------- */}
      <section className="mt-10">
        <SectionHeading
          title="Monthly demand forecast"
          subtitle={`Units - ${selectedStoreId ? storesById.get(selectedStoreId) ?? "Selected store" : "all stores combined"}. Solid line = actual, dark line = smoothed trend, dashed = forecast. Same engine that feeds §1's restock alerts.`}
        />
        <ForecastChart
          fitted={demandForecast.fitted}
          forecastPoints={demandForecast.forecast}
          valueLabel="units"
          formatValue={(v) => unitFormatter.format(v)}
          ariaLabel="Monthly unit demand, actual and forecast"
        />
        <h3 className="mt-4 text-sm font-medium">Top {topN} SKUs by next month&apos;s forecasted demand</h3>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead>
              <tr className="text-zinc-500">
                <th className="px-2 py-1">SKU</th>
                <th className="px-2 py-1 text-right">Next month forecast</th>
                <th className="px-2 py-1 text-right">Range</th>
              </tr>
            </thead>
            <tbody>
              {demandBySkuForecast.map((s) => (
                <tr key={s.productId} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="px-2 py-1">{s.name}{s.sku ? ` (${s.sku})` : ""}</td>
                  <td className="px-2 py-1 text-right">{unitFormatter.format(s.result.forecast[0]?.expected ?? 0)}</td>
                  <td className="px-2 py-1 text-right text-zinc-400">
                    {unitFormatter.format(s.result.forecast[0]?.low ?? 0)}-{unitFormatter.format(s.result.forecast[0]?.high ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* §4 Top & low sellers                                           */}
      {/* ------------------------------------------------------------- */}
      <section className="mt-10">
        <SectionHeading
          title="Top & low sellers"
          subtitle={`${from} to ${to}${selectedStoreId ? ` - ${storesById.get(selectedStoreId)}` : " - all stores"}. Trend compares the first vs. second half of this range.`}
        />
        <div className="mt-3 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">Top {topN}</h3>
            <table className="mt-1 w-full text-left text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <th className="px-2 py-1">SKU</th>
                  <th className="px-2 py-1 text-right">Units</th>
                  <th className="px-2 py-1 text-center">Trend</th>
                  <th className="px-2 py-1 text-center">Stock risk</th>
                </tr>
              </thead>
              <tbody>
                {topSellers.map((v) => {
                  const { atRisk } = stockRiskFor(v.product_id);
                  const dir = trendDirection(sellerDailySeriesByProduct.get(v.product_id) ?? []);
                  return (
                    <tr key={v.product_id} className="border-t border-zinc-100 dark:border-zinc-900">
                      <td className="px-2 py-1">{v.product_name}{v.sku ? ` (${v.sku})` : ""}</td>
                      <td className="px-2 py-1 text-right">{unitFormatter.format(v.units)}</td>
                      <td className="px-2 py-1 text-center"><TrendArrow direction={dir} /></td>
                      <td className="px-2 py-1 text-center">{atRisk ? <span className="text-red-600 dark:text-red-400">Stockout risk</span> : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="text-sm font-medium">Bottom {topN}</h3>
            <table className="mt-1 w-full text-left text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <th className="px-2 py-1">SKU</th>
                  <th className="px-2 py-1 text-right">Units</th>
                  <th className="px-2 py-1 text-center">Trend</th>
                  <th className="px-2 py-1 text-center">Dead stock?</th>
                </tr>
              </thead>
              <tbody>
                {bottomSellers.map((v) => {
                  const { officeQty } = stockRiskFor(v.product_id);
                  const dir = trendDirection(sellerDailySeriesByProduct.get(v.product_id) ?? []);
                  return (
                    <tr key={v.product_id} className="border-t border-zinc-100 dark:border-zinc-900">
                      <td className="px-2 py-1">{v.product_name}{v.sku ? ` (${v.sku})` : ""}</td>
                      <td className="px-2 py-1 text-right">{unitFormatter.format(v.units)}</td>
                      <td className="px-2 py-1 text-center"><TrendArrow direction={dir} /></td>
                      <td className="px-2 py-1 text-center">{officeQty > 0 ? `${unitFormatter.format(officeQty)} at office` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        {deadStockZeroSale.length > 0 && (
          <>
            <h3 className="mt-4 text-sm font-medium">Zero sales this period, but stock sitting at office</h3>
            <p className="mt-0.5 text-[10px] text-zinc-500">
              Not captured by the ranking above (it never sold in range) - flagged separately since it&apos;s the clearest dead-stock signal.
            </p>
            <table className="mt-1 w-full max-w-md text-left text-xs">
              <tbody>
                {deadStockZeroSale.map((d) => (
                  <tr key={d.productId} className="border-t border-zinc-100 dark:border-zinc-900">
                    <td className="px-2 py-1">{d.name}{d.sku ? ` (${d.sku})` : ""}</td>
                    <td className="px-2 py-1 text-right">{unitFormatter.format(d.officeQty)} at office</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* ------------------------------------------------------------- */}
      {/* §5 Forecast vs. actual                                         */}
      {/* ------------------------------------------------------------- */}
      <section className="mt-10 mb-16">
        <SectionHeading
          title="Forecast vs. actual"
          subtitle={`Rolling one-month-ahead backtest, company-wide revenue${selectedStoreId ? ` (${storesById.get(selectedStoreId)})` : ""}. Each point forecasts using only the months before it - a genuine out-of-sample check.`}
        />
        {backtest.length === 0 ? (
          <AssumptionNote>Not enough monthly history yet to backtest - need at least 2 months of synced sales.</AssumptionNote>
        ) : (
          <>
            <p className="mt-2 text-sm">
              Overall MAPE: <span className="font-medium">{overallMape != null ? `${pctFormatter.format(overallMape)}%` : "n/a"}</span>{" "}
              <span className="text-xs text-zinc-500">({backtest.filter((b) => b.ape !== null).length} backtested month(s))</span>
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="px-2 py-1">Month</th>
                    <th className="px-2 py-1 text-right">Predicted</th>
                    <th className="px-2 py-1 text-right">Actual</th>
                    <th className="px-2 py-1 text-right">Error</th>
                    <th className="px-2 py-1 text-right">Cumulative MAPE</th>
                  </tr>
                </thead>
                <tbody>
                  {backtest.map((b) => (
                    <tr key={b.date} className="border-t border-zinc-100 dark:border-zinc-900">
                      <td className="px-2 py-1">{monthLabelFormatter.format(new Date(isoDay(b.date)))}</td>
                      <td className="px-2 py-1 text-right">{currencyFormatter.format(b.predicted)}</td>
                      <td className="px-2 py-1 text-right">{currencyFormatter.format(b.actual)}</td>
                      <td className="px-2 py-1 text-right">{b.ape != null ? `${pctFormatter.format(b.ape * 100)}%` : "n/a (zero actual)"}</td>
                      <td className="px-2 py-1 text-right">{b.cumulativeMape != null ? `${pctFormatter.format(b.cumulativeMape)}%` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[10px] text-zinc-400">
              Cumulative MAPE trending down as more months accumulate is what
              &quot;getting more accurate over time&quot; looks like here -
              with only a few thousand order lines total, expect this to be
              noisy for a while yet.
            </p>

            <h3 className="mt-6 text-sm font-medium">Per-SKU accuracy (top {Math.min(5, demandBySkuForecast.length)} by forecasted demand)</h3>
            <table className="mt-1 w-full max-w-lg text-left text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <th className="px-2 py-1">SKU</th>
                  <th className="px-2 py-1 text-right">MAPE</th>
                  <th className="px-2 py-1 text-right">Backtested months</th>
                </tr>
              </thead>
              <tbody>
                {skuBacktestMape.map((s) => (
                  <tr key={s.productId} className="border-t border-zinc-100 dark:border-zinc-900">
                    <td className="px-2 py-1">{s.name}{s.sku ? ` (${s.sku})` : ""}</td>
                    <td className="px-2 py-1 text-right">{s.mape != null ? `${pctFormatter.format(s.mape)}%` : "n/a"}</td>
                    <td className="px-2 py-1 text-right text-zinc-400">{s.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}
