import Form from "next/form";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { forecast, type Period, type ForecastResult } from "@/lib/forecast/engine";
import { hasForecastSchema, fetchStockLevels, fetchPeriodDemand } from "@/lib/forecast/data";
import { hasLeadTimeSchema, fetchLeadTimeSettings, fetchEstimatesByProduct, fetchMeasuredDeliveriesByProduct } from "@/lib/leadtime/data";
import { resolveProductLeadTime, type LeadTimeRange, type LeadTimeSettings } from "@/lib/leadtime/resolve";
import { fetchAttributeAliases, canonicalColor, canonicalSize, type AttributeAliasMap } from "@/lib/forecast/aliases";
import {
  hasPoPlanningSchema,
  fetchStyleMerges,
  fetchStyleOptions,
  fetchStyleVariants,
  fetchStyleMonthlyNetUnits,
  fetchStyleDailyNetUnits,
  computeMonthToDate,
  fetchAllocationShares,
  fetchStockoutDays,
  adjustForStockouts,
  fetchUpliftFactors,
  upliftOverlapFraction,
  type StyleOption,
  type StyleVariant,
  type MonthToDate,
} from "@/lib/forecast/style";
import {
  fetchLinkedLeadTimeProductId,
  fetchOpenPoLines,
  computePlanner,
  computeWhatIf,
  buildPoGrid,
  projectStockTrajectory,
  computeOrderByDate,
  coverStatus,
  type OpenPoLine,
  type TrajectoryPoint,
} from "@/lib/forecast/planner";
import { niceStep, smoothPath, smoothBandPath, type Point } from "@/lib/viz/chart-utils";
import { ChartHover, type HoverSlot } from "./chart-hover";
import { syncStockNowAction } from "./overview/actions";
import { LoadSalesHistory } from "./load-history";
import "./dash.css";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_OPTIONS = [6, 12, 24, 0] as const; // 0 = "all"
const NEXT_OPTIONS = [1, 3, 6] as const;
const DEFAULT_LOW_VOLUME_THRESHOLD = 10;

const unitFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const stockSyncFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Makassar", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const monthLabelFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" });
const monthYearLabelFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", year: "numeric" });

function monthStart(date: Date, offsetMonths: number): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offsetMonths, 1));
  return d.toISOString().slice(0, 10);
}
function addDaysIso(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}
function endOfMonthIso(monthIso: string): string {
  const d = new Date(`${monthIso}T00:00:00Z`);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return last.toISOString().slice(0, 10);
}
/**
 * One entry per calendar month from `fromMonthIso` up to (not including)
 * `toMonthIso`, with 0 for a month that had no sales - the sales query only
 * returns months that had any, and a skipped month would otherwise vanish
 * from the chart and shift every later forecast month.
 */
function fillMonths(series: Period[], fromMonthIso: string, toMonthIso: string): Period[] {
  const byMonth = new Map(series.map((p) => [p.date, p.value]));
  const out: Period[] = [];
  const d = new Date(`${fromMonthIso}T00:00:00Z`);
  for (let iso = d.toISOString().slice(0, 10); iso < toMonthIso; iso = d.toISOString().slice(0, 10)) {
    out.push({ date: iso, value: byMonth.get(iso) ?? 0 });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}
function trimToPast<T>(items: T[], pastMonths: number): T[] {
  return pastMonths === 0 ? items : items.slice(-pastMonths);
}
function sampleTrajectory(trajectory: TrajectoryPoint[], dateIso: string): TrajectoryPoint | null {
  let best: TrajectoryPoint | null = null;
  for (const p of trajectory) {
    if (p.date <= dateIso) best = p;
    else break;
  }
  return best ?? trajectory[0] ?? null;
}
function resolveStyleByName(name: string | undefined, styleOptions: StyleOption[]): StyleOption | null {
  if (!name) return null;
  const trimmed = name.trim().toLowerCase();
  return styleOptions.find((s) => s.name.trim().toLowerCase() === trimmed) ?? null;
}
function AssumptionNote({ children, bad }: { children: React.ReactNode; bad?: boolean }) {
  return <p className={`fc-note${bad ? " fc-note-bad" : ""}`}>{children}</p>;
}
function HelpIcon({ text }: { text: string }) {
  return (
    <span title={text} className="fc-help">
      ?
    </span>
  );
}
function TileIcon({ d }: { d: string }) {
  return (
    <span className="fc-tile-icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  );
}
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Preserves the current filters as hidden fields on a sub-form (datalist inputs and checkboxes aren't re-sent unless repeated as hidden fields here). */
function HiddenParams({ params, except }: { params: SearchParams; except: string[] }) {
  return (
    <>
      {Object.entries(params)
        .filter(([k, v]) => !except.includes(k) && v && !Array.isArray(v))
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v as string} />
        ))}
    </>
  );
}

interface SearchParams {
  product?: string; // style name, matched via the datalist type-ahead
  compareProduct?: string; // optional second style name ("+ Compare")
  color?: string; // canonical value
  size?: string;
  store?: string; // storeId, "all" if absent
  past?: string;
  next?: string;
  coverageMonths?: string;
  serviceLevel?: string;
  adjustStockouts?: string;
  lowVolumeThreshold?: string;
  whatIfQty?: string;
}

interface SeriesData {
  key: string;
  label: string;
  templateId: number;
  productIds: number[];
  monthlySeries: Period[];
  mtd: MonthToDate;
  forecastResult: ForecastResult;
  upliftedForecast: { date: string; expected: number; low: number; high: number }[];
  leadTimeResolution: LeadTimeRange;
  dailyForecastRate: number;
  displayMonths: { date: string; value: number; adjusted: boolean }[];
  stockoutDaysByMonth: Map<string, number>;
  backtestMape: number | null;
  drilldownFraction: number | null;
}

export default async function ForecastChartPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Forecast</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">Not set up yet - SUPABASE_SERVICE_ROLE_KEY is missing.</p>
      </div>
    );
  }

  const params = await searchParams;
  const supabase = createAdminClient();

  const [forecastSchemaOk, leadTimeSchemaOk, poPlanningSchemaOk] = await Promise.all([
    hasForecastSchema(supabase),
    hasLeadTimeSchema(supabase),
    hasPoPlanningSchema(supabase),
  ]);
  if (!forecastSchemaOk) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Forecast</h1>
        <AssumptionNote>
          Not shown yet - run <code>supabase/migrations/0023_forecast_inventory.sql</code> and <code>0029_po_planning.sql</code> in the Supabase SQL editor first.
        </AssumptionNote>
      </div>
    );
  }

  const aliases: AttributeAliasMap = await fetchAttributeAliases(supabase);
  const merges = await fetchStyleMerges(supabase);
  const { data: storeRows } = await supabase.from("stores").select("id, name").eq("active", true).order("name");
  const HIDDEN_STORE_NAMES = new Set(["nsa"]);
  const stores = (storeRows ?? []).filter((s) => !HIDDEN_STORE_NAMES.has(s.name.trim().toLowerCase()));

  // Only products sold in the POS (Odoo's "Available in POS", not archived) - see fetchStyleOptions.
  const styleOptions = await fetchStyleOptions(supabase, merges, { posOnly: true });
  if (!styleOptions.length) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Forecast</h1>
        <p className="mt-2 text-sm text-zinc-500">No products synced yet - run an Odoo sync on Operations first.</p>
      </div>
    );
  }

  const requestedStyle = resolveStyleByName(params.product, styleOptions);
  const productNotFound = !!params.product && !requestedStyle;
  const compareStyle = params.compareProduct ? resolveStyleByName(params.compareProduct, styleOptions) : null;
  const compareNotFound = !!params.compareProduct && !compareStyle;

  const storeId = params.store && params.store !== "all" ? Number(params.store) : null;
  const storeIdsForSales = storeId ? [storeId] : null;
  const pastMonthsParam = Number(params.past);
  const pastMonths = PAST_OPTIONS.includes(pastMonthsParam as (typeof PAST_OPTIONS)[number]) ? pastMonthsParam : 12;
  const coverageMonths = Math.max(1, Number(params.coverageMonths) || 2);
  const coverageDays = coverageMonths * 30;
  const serviceLevel = Math.min(0.999, Math.max(0.5, Number(params.serviceLevel) || 0.9));
  const adjustStockouts = params.adjustStockouts === "on";
  const lowVolumeThreshold = Math.max(0, Number(params.lowVolumeThreshold) || DEFAULT_LOW_VOLUME_THRESHOLD);
  const whatIfQty = params.whatIfQty ? Number(params.whatIfQty) : null;

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const currentMonthIso = monthStart(today, 0);
  const historyFrom = pastMonths === 0 ? "2000-01-01" : monthStart(today, -pastMonths);

  // Monthly net units across ALL products (the Odoo sales sync), loaded only
  // when needed: to pick a default product, and to fill the chart when the
  // selected product has no sales. "All history" is capped at 24 months here
  // to keep the query bounded.
  const allProductsFrom = pastMonths === 0 ? monthStart(today, -24) : historyFrom;
  let allProductsRowsPromise: ReturnType<typeof fetchPeriodDemand> | null = null;
  const loadAllProductsRows = () =>
    (allProductsRowsPromise ??= fetchPeriodDemand(supabase, { from: allProductsFrom, to: currentMonthIso, bucket: "month", storeIds: storeIdsForSales }));

  // No product chosen: open on the best seller in this window rather than the first name alphabetically (which may never have sold).
  let primaryStyle = requestedStyle ?? styleOptions[0];
  let defaultedToBestSeller = false;
  if (!requestedStyle) {
    const { rows } = await loadAllProductsRows();
    const unitsByProduct = new Map<number, number>();
    for (const r of rows) unitsByProduct.set(r.product_id, (unitsByProduct.get(r.product_id) ?? 0) + r.units);
    let bestUnits = 0;
    for (const option of styleOptions) {
      const units = option.productIds.reduce((sum, id) => sum + (unitsByProduct.get(id) ?? 0), 0);
      if (units > bestUnits) {
        bestUnits = units;
        primaryStyle = option;
        defaultedToBestSeller = true;
      }
    }
  }

  const primaryVariants = await fetchStyleVariants(supabase, primaryStyle.templateId, merges);
  const colorOptions = Array.from(new Set(primaryVariants.map((v) => canonicalColor(v.color, aliases)).filter((c): c is string => !!c))).sort();
  const sizeOptions = Array.from(new Set(primaryVariants.map((v) => canonicalSize(v.size, aliases)).filter((s): s is string => !!s))).sort();
  const colorFilter = params.color || null;
  const sizeFilter = params.size || null;

  const filterVariants = (variants: StyleVariant[]) =>
    variants.filter(
      (v) => (!colorFilter || canonicalColor(v.color, aliases) === colorFilter) && (!sizeFilter || canonicalSize(v.size, aliases) === sizeFilter),
    );

  const leadTimeSettings: LeadTimeSettings = leadTimeSchemaOk
    ? await fetchLeadTimeSettings(supabase)
    : { lateEndBufferPct: 25, globalDefaultMinDays: 42, globalDefaultMaxDays: 56, measuredMinPoCount: 5, firstDeliveryOnly: false };
  const [estimatesByProduct, measuredByProduct] = leadTimeSchemaOk
    ? await Promise.all([fetchEstimatesByProduct(supabase), fetchMeasuredDeliveriesByProduct(supabase, leadTimeSettings.firstDeliveryOnly)])
    : [new Map(), new Map()];

  async function resolveLeadTime(templateId: number): Promise<{ productId: number | null; resolution: LeadTimeRange }> {
    const productId = leadTimeSchemaOk ? await fetchLinkedLeadTimeProductId(supabase, templateId, merges) : null;
    const resolution: LeadTimeRange = productId
      ? resolveProductLeadTime(estimatesByProduct.get(productId) ?? [], measuredByProduct.get(productId) ?? [], leadTimeSettings)
      : {
          minDays: leadTimeSettings.globalDefaultMinDays,
          maxDays: leadTimeSettings.globalDefaultMaxDays,
          tier: "default",
          usedFallback: true,
          detail: "Not linked to a lead-time product yet (link it on the Lead Times page) - using the global default range.",
        };
    return { productId, resolution };
  }

  const { productId: primaryLeadTimeProductId, resolution: primaryLeadTimeResolution } = await resolveLeadTime(primaryStyle.templateId);

  const nextMonthsParam = Number(params.next);
  const computedN = Math.max(1, Math.ceil((primaryLeadTimeResolution.maxDays + coverageDays) / 30));
  const nextMonthsDefault = NEXT_OPTIONS.find((v) => v >= computedN) ?? NEXT_OPTIONS[NEXT_OPTIONS.length - 1];
  const nextMonths = NEXT_OPTIONS.includes(nextMonthsParam as (typeof NEXT_OPTIONS)[number]) ? nextMonthsParam : nextMonthsDefault;
  const forecastHorizonMonths = Math.max(nextMonths, computedN);

  async function buildSeries(key: string, label: string, style: StyleOption, variants: StyleVariant[]): Promise<SeriesData> {
    const styleProductIds = variants.map((v) => v.productId);
    const filteredProductIds = filterVariants(variants).map((v) => v.productId);

    // Forecast is always fit on the FULL style (never the filtered colour/size
    // subset, which would be a much sparser series) and then scaled down by
    // the trailing-mix share for the selected colour/size - same rule as
    // the PO grid's own allocation.
    const styleRawSeries = await fetchStyleMonthlyNetUnits(supabase, styleProductIds, storeIdsForSales, historyFrom, currentMonthIso);
    // Fit from the product's first month with sales (months before it launched aren't zero-demand months) through the last full month, zero-filling gaps.
    const styleMonthlySeries = styleRawSeries.length ? fillMonths(styleRawSeries, styleRawSeries[0].date, currentMonthIso) : [];
    // The series ends at the last full month, so the first forecast step is the CURRENT month (shown on the chart as month-to-date + projection); one extra step keeps `forecastHorizonMonths` future months after it. Dates are set by calendar month here.
    const rawForecast = forecast(styleMonthlySeries, { horizon: forecastHorizonMonths + 1 });
    const forecastResult: ForecastResult = { ...rawForecast, forecast: rawForecast.forecast.map((f, i) => ({ ...f, date: monthStart(today, i) })) };

    let drilldownFraction: number | null = 1;
    if (colorFilter || sizeFilter) {
      const shares = await fetchAllocationShares(supabase, variants, today.toISOString(), aliases);
      const colorFrac = colorFilter ? shares.colorShare.get(colorFilter) : 1;
      const sizeFrac = sizeFilter ? shares.sizeShare.get(sizeFilter) : 1;
      drilldownFraction = colorFrac === undefined || sizeFrac === undefined ? null : colorFrac * sizeFrac;
    }

    const upliftFactors = poPlanningSchemaOk ? await fetchUpliftFactors(supabase, style.templateId, merges) : [];
    // Months AFTER the current one.
    const upliftedForecast = forecastResult.forecast.slice(1).map((f) => {
      const totalFraction = upliftFactors.reduce((sum, factor) => sum + upliftOverlapFraction(f.date, factor) * (factor.upliftPct / 100), 0);
      const multiplier = (1 + totalFraction) * (drilldownFraction ?? 0);
      return { date: f.date, expected: f.expected * multiplier, low: f.low * multiplier, high: f.high * multiplier };
    });

    // Displayed actual history IS scoped to the colour/size filter (real data, shown at whatever scope is selected).
    // Every month of the selected window is shown, 0 where nothing sold ("All" starts at the first month with sales).
    const rawMonthlySeries = await fetchStyleMonthlyNetUnits(supabase, filteredProductIds, storeIdsForSales, historyFrom, currentMonthIso);
    const monthlySeries = fillMonths(rawMonthlySeries, pastMonths === 0 ? (rawMonthlySeries[0]?.date ?? currentMonthIso) : historyFrom, currentMonthIso);
    const dailyThisMonth = await fetchStyleDailyNetUnits(supabase, filteredProductIds, storeIdsForSales, currentMonthIso, addDaysIso(todayIso, 1));
    const mtd = computeMonthToDate(dailyThisMonth, today);

    const { stockoutDays, earliestHistoryDate } = poPlanningSchemaOk
      ? await fetchStockoutDays(supabase, filteredProductIds, historyFrom, currentMonthIso)
      : { stockoutDays: [], earliestHistoryDate: null };
    const stockoutDaysByMonth = new Map<string, number>();
    for (const d of stockoutDays) {
      const m = `${d.date.slice(0, 7)}-01`;
      stockoutDaysByMonth.set(m, (stockoutDaysByMonth.get(m) ?? 0) + 1);
    }
    const displayMonths = monthlySeries.map((p) => {
      if (!adjustStockouts) return { date: p.date, value: p.value, adjusted: false };
      const count = stockoutDaysByMonth.get(p.date) ?? 0;
      const historyCoversWholeMonth = !!earliestHistoryDate && earliestHistoryDate <= p.date;
      const d = new Date(`${p.date}T00:00:00Z`);
      const daysInMonth = new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getDate();
      const r = adjustForStockouts(p.value, daysInMonth, count, historyCoversWholeMonth);
      return { date: p.date, value: r.units, adjusted: r.adjusted };
    });

    let backtestMape: number | null = null;
    {
      const points: number[] = [];
      const start = Math.max(1, styleMonthlySeries.length - 3);
      for (let i = start; i < styleMonthlySeries.length; i++) {
        const train = styleMonthlySeries.slice(0, i);
        const actual = styleMonthlySeries[i].value;
        if (actual === 0) continue;
        const predicted = forecast(train, { horizon: 1 }).forecast[0]?.expected ?? 0;
        points.push(Math.abs(predicted - actual) / Math.abs(actual));
      }
      backtestMape = points.length ? (points.reduce((a, b) => a + b, 0) / points.length) * 100 : null;
    }

    const { resolution: leadTimeResolution } = await resolveLeadTime(style.templateId);
    const dailyForecastRate = (upliftedForecast[0]?.expected ?? 0) / 30;

    return {
      key,
      label,
      templateId: style.templateId,
      productIds: filteredProductIds,
      monthlySeries,
      mtd,
      forecastResult,
      upliftedForecast,
      leadTimeResolution,
      dailyForecastRate,
      displayMonths,
      stockoutDaysByMonth,
      backtestMape,
      drilldownFraction,
    };
  }

  const primarySeries = await buildSeries("primary", primaryStyle.name, primaryStyle, primaryVariants);
  let compareSeries: SeriesData | null = null;
  if (compareStyle && compareStyle.templateId !== primaryStyle.templateId) {
    const compareVariants = await fetchStyleVariants(supabase, compareStyle.templateId, merges);
    compareSeries = await buildSeries("compare", compareStyle.name, compareStyle, compareVariants);
  }
  const series = [primarySeries, ...(compareSeries ? [compareSeries] : [])];

  const isEmpty = primarySeries.monthlySeries.every((p) => p.value === 0) && primarySeries.mtd.mtdUnits === 0;
  const avgMonthly = primarySeries.monthlySeries.length
    ? primarySeries.monthlySeries.reduce((s, p) => s + p.value, 0) / primarySeries.monthlySeries.length
    : 0;
  const isLowVolume = avgMonthly > 0 && avgMonthly < lowVolumeThreshold;

  // Selected product has no sales in this window: chart total monthly sales across all products in its place.
  let allProducts: { history: Period[]; forecast: { date: string; expected: number; low: number; high: number }[] } | null = null;
  if (isEmpty) {
    const { rows } = await loadAllProductsRows();
    const byMonth = new Map<string, number>();
    for (const r of rows) byMonth.set(r.bucket_date, (byMonth.get(r.bucket_date) ?? 0) + r.units);
    const history = Array.from(byMonth.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, value]) => ({ date, value }));
    if (history.length) allProducts = { history, forecast: forecast(history, { horizon: nextMonths }).forecast };
  }

  // --- Shared x-axis ---
  const trimmedHistory = trimToPast(primarySeries.displayMonths, pastMonths);
  type XPoint = { key: string; label: string; monthIso: string };
  const xPoints: XPoint[] = [
    ...trimmedHistory.map((p, i) => {
      const d = new Date(`${p.date}T00:00:00Z`);
      const isJanOrFirst = d.getUTCMonth() === 0 || i === 0;
      return { key: p.date, label: isJanOrFirst ? monthYearLabelFormatter.format(d) : monthLabelFormatter.format(d), monthIso: p.date };
    }),
    { key: `${currentMonthIso}-mtd`, label: "MTD", monthIso: currentMonthIso },
    { key: `${currentMonthIso}-proj`, label: "Proj.", monthIso: currentMonthIso },
    ...primarySeries.upliftedForecast.slice(0, nextMonths).map((f) => ({ key: f.date, label: (f.date.slice(5, 7) === "01" ? monthYearLabelFormatter : monthLabelFormatter).format(new Date(`${f.date}T00:00:00Z`)), monthIso: f.date })),
  ];
  const todayIdx = trimmedHistory.length;
  const projIdx = todayIdx + 1;
  const forecastStartIdx = todayIdx + 2;
  const CHART_W = 760;
  const CHART_H = 320;
  const PAD_L = 56;
  const PAD_R = 16;
  const PAD_T = 32;
  const PAD_B = 28;
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;
  const xFor = (i: number) => PAD_L + (xPoints.length <= 1 ? 0 : (i / (xPoints.length - 1)) * plotW);
  const maxUnits = Math.max(
    1,
    ...series.flatMap((s) => trimToPast(s.displayMonths, pastMonths).map((p) => p.value)),
    ...series.map((s) => s.mtd.projectedFullMonthUnits),
    ...series.flatMap((s) => s.upliftedForecast.slice(0, nextMonths).map((f) => f.high)),
  );
  const step = niceStep(maxUnits / 4);
  const yTicks = Math.max(1, Math.ceil(maxUnits / step));
  const yMax = step * yTicks;
  const yFor = (v: number) => PAD_T + plotH - (Math.min(v, yMax) / yMax) * plotH;


  // --- Planner (primary product only) ---
  const planStockLevels = await fetchStockLevels(supabase, primaryVariants.map((v) => v.productId));
  const { data: earliestOrder } = await supabase
    .from("orders")
    .select("order_date")
    .order("order_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data: lastStockSync } = await supabase
    .from("sync_runs")
    .select("status, started_at, error_message")
    .eq("sync_type", "stock")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const stockSyncedAt = planStockLevels.rows.reduce<string | null>((latest, r) => (!latest || r.syncedAt > latest ? r.syncedAt : latest), null);
  const returnTo = `/forecast?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1])).toString()}`;
  let planStockOffice = 0;
  let planStockStores = 0;
  for (const r of planStockLevels.rows) {
    if (!primaryVariants.map((v) => v.productId).includes(r.productId)) continue;
    if (r.kind === "office") planStockOffice += r.qty;
    else planStockStores += r.qty;
  }
  const planOpenPoLines = primaryLeadTimeProductId ? await fetchOpenPoLines(supabase, primaryLeadTimeProductId, primaryLeadTimeResolution) : [];
  const arrivalDateLate = addDaysIso(todayIso, primaryLeadTimeResolution.maxDays);
  const openPoBeforeArrival = planOpenPoLines.filter((l) => l.resolvedEtaLatest <= arrivalDateLate).reduce((sum, l) => sum + l.qtyOpen, 0);

  // Planner always reads the FULL style's own forecast (not a colour/size-scaled one) - the plan is for the whole product.
  const planDailyForecastRate = (primarySeries.forecastResult.forecast[0]?.expected ?? 0) / 30;
  const planDailyForecastStdDev = primarySeries.forecastResult.residualStdDev / Math.sqrt(30);

  const plannerCalc = computePlanner({
    currentStockOffice: planStockOffice,
    currentStockStores: planStockStores,
    openPoBeforeArrival,
    dailyForecastRate: planDailyForecastRate,
    dailyForecastStdDev: planDailyForecastStdDev,
    daysUntilArrival: primaryLeadTimeResolution.maxDays,
    coverageDays,
    targetServiceLevel: serviceLevel,
  });
  const whatIf = whatIfQty != null ? computeWhatIf(whatIfQty, plannerCalc, planDailyForecastRate, arrivalDateLate) : null;

  // Mini stock chart: the real open POs, plus the hypothetical "what if" qty landing at today's min..max lead time, so the chart redraws with it included.
  const whatIfPoLines: OpenPoLine[] =
    whatIfQty != null && whatIfQty > 0
      ? [{ poNo: "what-if", poDate: todayIso, qtyOpen: whatIfQty, resolvedEtaEarliest: addDaysIso(todayIso, primaryLeadTimeResolution.minDays), resolvedEtaLatest: arrivalDateLate }]
      : [];
  const miniHorizonDays = forecastHorizonMonths * 30;
  const trajectory = projectStockTrajectory(planStockOffice + planStockStores, planDailyForecastRate, [...planOpenPoLines, ...whatIfPoLines], todayIso, miniHorizonDays);
  const orderBy = computeOrderByDate(trajectory, plannerCalc.safetyStock, primaryLeadTimeResolution.maxDays, todayIso);

  const planAllocationShares = await fetchAllocationShares(supabase, primaryVariants, today.toISOString(), aliases);
  const grid = await buildPoGrid(supabase, primaryVariants, plannerCalc.suggestedPoQty, planAllocationShares, primaryLeadTimeProductId, aliases);


  // --- Stat tiles ---
  const lastMonth = trimmedHistory[trimmedHistory.length - 1] ?? null;
  const prevMonth = trimmedHistory[trimmedHistory.length - 2] ?? null;
  const soldDeltaPct = lastMonth && prevMonth && prevMonth.value > 0 ? ((lastMonth.value - prevMonth.value) / prevMonth.value) * 100 : null;
  const nextForecast = primarySeries.upliftedForecast[0] ?? null;
  const totalStock = planStockOffice + planStockStores;
  const cover = coverStatus(totalStock, planDailyForecastRate, primaryLeadTimeResolution.maxDays, coverageDays);
  const monthName = (iso: string) => monthLabelFormatter.format(new Date(`${iso}T00:00:00Z`));
  const monthYearName = (iso: string) => monthYearLabelFormatter.format(new Date(`${iso}T00:00:00Z`));
  const filterLabel = [colorFilter, sizeFilter].filter(Boolean).join(" / ");
  const scopeIsNarrowed = !!filterLabel || !!storeId;

  // --- Main chart geometry (per series, placed by month so two products with different histories stay aligned) ---
  const historyIdx = new Map(trimmedHistory.map((p, i) => [p.date, i]));
  const seriesColor = (key: string) => `var(--fc-s-${key === "compare" ? "compare" : "primary"})`;
  const chartSeries = series.map((s) => {
    const history = trimToPast(s.displayMonths, pastMonths).filter((p) => historyIdx.has(p.date));
    const forecastShown = s.upliftedForecast.slice(0, nextMonths);
    return { s, history, forecastShown, color: seriesColor(s.key) };
  });
  const forecastOrigin = (s: SeriesData): Point => ({ x: xFor(projIdx), y: yFor(s.mtd.projectedFullMonthUnits) });

  const mainSlots: HoverSlot[] = xPoints.map((xp, i) => {
    const rows: HoverSlot["rows"] = [];
    for (const { s, history, forecastShown, color } of chartSeries) {
      const name = series.length > 1 ? s.label : "";
      if (i < todayIdx) {
        const p = history.find((h) => h.date === xp.monthIso);
        if (!p) continue;
        const stockoutDays = s.stockoutDaysByMonth.get(p.date);
        rows.push({
          color,
          value: unitFormatter.format(p.value),
          label: name || "units sold",
          note: [p.adjusted ? "adjusted for stockouts" : "", stockoutDays ? `${stockoutDays} stockout day${stockoutDays > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ") || undefined,
        });
      } else if (i === todayIdx) {
        rows.push({ color, value: unitFormatter.format(s.mtd.mtdUnits), label: name || "units so far", note: `day ${s.mtd.daysElapsed} of ${s.mtd.daysInMonth}` });
      } else if (i === projIdx) {
        rows.push({ color, dashed: true, value: unitFormatter.format(s.mtd.projectedFullMonthUnits), label: name || "projected full month" });
      } else {
        const f = forecastShown[i - forecastStartIdx];
        if (!f) continue;
        rows.push({ color, dashed: true, value: unitFormatter.format(f.expected), label: name || "forecast", note: `${unitFormatter.format(f.low)}–${unitFormatter.format(f.high)}` });
      }
    }
    const title =
      i < todayIdx
        ? monthYearName(xp.monthIso)
        : i === todayIdx
          ? `${monthYearName(xp.monthIso)} · month to date`
          : i === projIdx
            ? `${monthYearName(xp.monthIso)} · projected`
            : `${monthYearName(xp.monthIso)} · forecast`;
    return { xPct: (xFor(i) / CHART_W) * 100, title, rows };
  });

  // --- Stock chart (bars, one per month-end) ---
  const STOCK_W = 360;
  const STOCK_H = 320;
  const sPadL = 44;
  const sPadR = 12;
  const sPadT = 32;
  const sPadB = 28;
  const sPlotW = STOCK_W - sPadL - sPadR;
  const sPlotH = STOCK_H - sPadT - sPadB;
  const stockMonths = [currentMonthIso, ...xPoints.slice(forecastStartIdx).map((p) => p.monthIso)];
  const stockSlotW = sPlotW / stockMonths.length;
  const stockBarW = Math.min(24, stockSlotW * 0.6);
  const sXFor = (i: number) => sPadL + stockSlotW * (i + 0.5);
  const stockBars = stockMonths.map((m) => {
    const p = sampleTrajectory(trajectory, endOfMonthIso(m));
    return { monthIso: m, low: p?.low ?? 0, high: p?.high ?? 0 };
  });
  const maxStock = Math.max(1, ...stockBars.map((b) => b.low), plannerCalc.safetyStock);
  const sStep = niceStep(maxStock / 4);
  const sTicks = Math.max(1, Math.ceil(maxStock / sStep));
  const sYMax = sStep * sTicks;
  const sYFor = (v: number) => sPadT + sPlotH - (Math.min(v, sYMax) / sYMax) * sPlotH;
  const crossingMonth = orderBy.crossesSafetyStockDate ? `${orderBy.crossesSafetyStockDate.slice(0, 7)}-01` : null;
  const stockSlots: HoverSlot[] = stockBars.map((b, i) => ({
    xPct: (sXFor(i) / STOCK_W) * 100,
    title: `End of ${monthYearName(b.monthIso)}`,
    rows: [
      { value: unitFormatter.format(b.low), label: b.high > b.low ? "units, if open POs land late" : "units projected" },
      ...(b.high > b.low ? [{ value: unitFormatter.format(b.high), label: "units, if they land early" }] : []),
      { value: unitFormatter.format(plannerCalc.safetyStock), label: "safety stock" },
    ],
  }));

  // --- "Export data": what the sales chart shows, as CSV ---
  const exportLines = [["Product", "Month", "Type", "Units", "Low", "High"].join(",")];
  for (const { s, history, forecastShown } of chartSeries) {
    for (const p of history) exportLines.push([s.label, p.date.slice(0, 7), p.adjusted ? "actual (adjusted for stockouts)" : "actual", Math.round(p.value), "", ""].map(csvField).join(","));
    exportLines.push([s.label, currentMonthIso.slice(0, 7), "month to date", Math.round(s.mtd.mtdUnits), "", ""].map(csvField).join(","));
    exportLines.push([s.label, currentMonthIso.slice(0, 7), "projected full month", Math.round(s.mtd.projectedFullMonthUnits), "", ""].map(csvField).join(","));
    for (const f of forecastShown) exportLines.push([s.label, f.date.slice(0, 7), "forecast", Math.round(f.expected), Math.round(f.low), Math.round(f.high)].map(csvField).join(","));
  }
  const exportHref = `data:text/csv;charset=utf-8,${encodeURIComponent(exportLines.join("\n") + "\n")}`;
  const exportName = `forecast-${primaryStyle.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;

  return (
    <div className="fc-dash">
      {/* Band: title, export, filters */}
      <div className="fc-band">
        <div className="fc-wrap">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1>Forecast</h1>
              <p className="fc-band-sub">
                {primaryStyle.name}
                {filterLabel ? ` · ${filterLabel}` : ""}
                {compareSeries ? ` vs ${compareSeries.label}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/forecast/overview" className="fc-band-link">Overview</Link>
              <Link href="/forecast/lead-times" className="fc-band-link">Lead times</Link>
              <a href={exportHref} download={exportName} className="fc-btn">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" />
                </svg>
                Export data
              </a>
            </div>
          </div>

          <Form action="" className="mt-6 flex flex-wrap items-end gap-3">
            <datalist id="style-options">
              {styleOptions.map((s) => <option key={s.templateId} value={s.name} />)}
            </datalist>
            <label className="fc-field">
              Product
              <input list="style-options" name="product" defaultValue={primaryStyle.name} className="fc-control w-56" />
            </label>
            <label className="fc-field">
              Compare with
              <input list="style-options" name="compareProduct" defaultValue={compareStyle?.name ?? params.compareProduct ?? ""} placeholder="Another product (optional)" className="fc-control w-56" />
            </label>
            <label className="fc-field">
              Colour
              <select name="color" defaultValue={colorFilter ?? ""} className="fc-control">
                <option value="">All colours</option>
                {colorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="fc-field">
              Size
              <select name="size" defaultValue={sizeFilter ?? ""} className="fc-control">
                <option value="">All sizes</option>
                {sizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="fc-field">
              Store
              <select name="store" defaultValue={params.store ?? "all"} className="fc-control">
                <option value="all">All stores</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="fc-field">
              Showing
              <select name="past" defaultValue={pastMonths} className="fc-control">
                <option value={6}>Past 6 months</option>
                <option value={12}>Past 12 months</option>
                <option value={24}>Past 24 months</option>
                <option value={0}>All history</option>
              </select>
            </label>
            <label className="fc-field">
              Forecast
              <select name="next" defaultValue={nextMonths} className="fc-control">
                {NEXT_OPTIONS.map((n) => <option key={n} value={n}>Next {n} month{n > 1 ? "s" : ""}</option>)}
              </select>
            </label>
            <label className="fc-check">
              <input type="checkbox" name="adjustStockouts" defaultChecked={adjustStockouts} /> Adjust for stockouts
            </label>
            <HiddenParams params={params} except={["product", "compareProduct", "color", "size", "store", "past", "next", "adjustStockouts"]} />
            <SubmitButton className="fc-btn" style={{ background: "#fff", color: "#17181c", borderColor: "#fff" }}>
              Apply
            </SubmitButton>
          </Form>
        </div>
      </div>

      <div className="fc-wrap" style={{ paddingBottom: "4rem" }}>
        {/* Stat tiles */}
        <div className="fc-tiles">
          <div className="fc-card fc-tile">
            <div className="fc-tile-top">
              <TileIcon d="M2.5 13.5h11M4.5 11V7.5M8 11V3.5M11.5 11V6" />
              {soldDeltaPct != null && prevMonth && (
                <span className="fc-tile-aside">
                  <span className={`fc-delta ${soldDeltaPct >= 0 ? "fc-delta-up" : "fc-delta-down"}`}>
                    {soldDeltaPct >= 0 ? "▲ +" : "▼ −"}
                    {Math.abs(soldDeltaPct).toFixed(0)}%
                  </span>{" "}
                  vs {monthName(prevMonth.date)}
                </span>
              )}
            </div>
            <div className="fc-tile-value">
              {lastMonth ? unitFormatter.format(lastMonth.value) : "–"}
              <span className="fc-tile-unit">units</span>
            </div>
            <div className="fc-tile-label">{lastMonth ? `Sold in ${monthYearName(lastMonth.date)}` : "No full month of sales yet"}</div>
          </div>

          <div className="fc-card fc-tile">
            <div className="fc-tile-top">
              <TileIcon d="M2.5 11.5 6 8l2.5 2.5 5-5M10 5.5h3.5V9" />
              {nextForecast && (
                <span className="fc-tile-aside">
                  range {unitFormatter.format(nextForecast.low)}–{unitFormatter.format(nextForecast.high)}
                </span>
              )}
            </div>
            <div className="fc-tile-value">
              {nextForecast ? unitFormatter.format(nextForecast.expected) : "–"}
              <span className="fc-tile-unit">units</span>
            </div>
            <div className="fc-tile-label">{nextForecast ? `Forecast for ${monthYearName(nextForecast.date)}` : "No forecast yet"}</div>
          </div>

          <div className="fc-card fc-tile">
            <div className="fc-tile-top">
              <TileIcon d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11V5ZM2.5 5 8 7.5 13.5 5M8 7.5v6" />
              <span className={`fc-badge fc-badge-${cover.status}`}>
                {cover.weeksOfCover == null
                  ? "No forecast demand"
                  : `${cover.status === "risk" ? "At risk" : cover.status === "low" ? "Low" : "OK"} · ${cover.weeksOfCover.toFixed(0)} wk cover`}
              </span>
            </div>
            <div className="fc-tile-value">
              {unitFormatter.format(totalStock)}
              <span className="fc-tile-unit">units</span>
            </div>
            <div className="fc-tile-label">
              Stock on hand · office {unitFormatter.format(planStockOffice)}, stores {unitFormatter.format(planStockStores)}
            </div>
          </div>

          <div className="fc-card fc-tile">
            <div className="fc-tile-top">
              <TileIcon d="M3.5 2.5h9v11h-9zM6 5.5h4M6 8h4M6 10.5h2" />
              {orderBy.orderByDate ? (
                <span className={`fc-badge ${orderBy.alreadyLate ? "fc-badge-risk" : "fc-badge-plain"}`}>
                  {orderBy.alreadyLate ? "Late · " : ""}order by {orderBy.orderByDate}
                </span>
              ) : (
                <span className="fc-tile-aside">no order date needed yet</span>
              )}
            </div>
            <div className="fc-tile-value">
              {unitFormatter.format(plannerCalc.suggestedPoQty)}
              <span className="fc-tile-unit">units</span>
            </div>
            <div className="fc-tile-label">Suggested PO · {coverageMonths}-month cover after arrival</div>
          </div>
        </div>
        <form action={syncStockNowAction} className="mt-3 flex flex-wrap items-center gap-3">
          <input type="hidden" name="returnTo" value={returnTo} />
          <SubmitButton className="fc-btn fc-btn-light" style={{ background: "#fff" }}>Sync stock from Odoo</SubmitButton>
          <span className="fc-card-sub" style={{ marginTop: 0 }}>
            {lastStockSync
              ? `Last stock sync: ${lastStockSync.status}, ${stockSyncFormatter.format(new Date(lastStockSync.started_at))} (Bali time).`
              : "Stock has never been synced from Odoo."}{" "}
            {stockSyncedAt ? "" : `No stock rows are stored for ${primaryStyle.name} - it shows 0 until a sync finds some in Odoo. `}
            Also runs automatically every day with the sales sync.
          </span>
        </form>
        <LoadSalesHistory defaultFromMonth="2025-11" earliestSynced={earliestOrder?.order_date ?? null} />
        {lastStockSync?.status === "error" && (
          <AssumptionNote bad>Last stock sync failed: {lastStockSync.error_message ?? "unknown error"}. Stock on hand below may be out of date.</AssumptionNote>
        )}
        {planStockLevels.unavailable && <AssumptionNote bad>Stock levels couldn&apos;t be read, so stock on hand shows 0.</AssumptionNote>}
        {scopeIsNarrowed && (
          <p className="fc-card-sub">
            Sold and forecast follow the colour, size and store filters. Stock on hand and the suggested PO are always for the whole product across all locations.
          </p>
        )}

        {!leadTimeSchemaOk && (
          <AssumptionNote>
            Lead-time data isn&apos;t available yet - run <code>supabase/migrations/0027_lead_times.sql</code>, <code>0028_seed_purchase_orders.sql</code>, and <code>0029_po_planning.sql</code>. Using the global default lead time (42-56 days) until then.
          </AssumptionNote>
        )}
        {leadTimeSchemaOk && primaryLeadTimeResolution.usedFallback && <AssumptionNote>{primaryLeadTimeResolution.detail}</AssumptionNote>}
        {productNotFound && <AssumptionNote>No product named &quot;{params.product}&quot; - showing {primaryStyle.name} instead.</AssumptionNote>}
        {compareNotFound && <AssumptionNote>No product named &quot;{params.compareProduct}&quot; to compare - ignored.</AssumptionNote>}
        {primaryStyle.name.includes(" (#") && (
          <AssumptionNote>
            Another product in Odoo shares this exact name under a different template id - the id is appended here so both are reachable and this one isn&apos;t silently merged with the other. Worth checking in Odoo whether one is a duplicate.
          </AssumptionNote>
        )}
        {defaultedToBestSeller && (
          <p className="fc-card-sub">No product chosen - showing {primaryStyle.name}, the best seller in this window. Pick another in Product above.</p>
        )}
        {isLowVolume && (
          <AssumptionNote>
            Low volume - averaging {avgMonthly.toFixed(1)} units/month over this window, so the forecast is rough.
          </AssumptionNote>
        )}

        <div className="fc-grid2" style={{ marginTop: "0.875rem" }}>
          {/* Sales chart */}
          <section className="fc-card fc-card-pad">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="fc-card-title">
                  Quantity sold{" "}
                  <HelpIcon text="Solid line = actual net units sold (sales minus returns), one point per month. The current month shows month-to-date and a projected full month separately. Dashed line and shaded band = forecast (expected, with its low-high range), widening further out." />
                </h2>
                <p className="fc-card-sub">Net units per month. Dashed line and band are the forecast and its range.</p>
              </div>
              <div className="fc-legend">
                {chartSeries.map(({ s, color }) => (
                  <span key={s.key} className="fc-key">
                    <span className="fc-key-line" style={{ color }} />
                    {series.length > 1 ? s.label : "Sold"}
                  </span>
                ))}
                <span className="fc-key">
                  <span className="fc-key-line fc-key-dash" style={{ color: "var(--fc-ink-2)" }} />
                  Forecast
                </span>
              </div>
            </div>

            {isEmpty ? (
              <>
                <AssumptionNote>
                  No sales history for {primaryStyle.name}
                  {filterLabel ? ` (${filterLabel})` : ""} in this window{allProducts ? ` - showing monthly sales for all products${storeId ? " in this store" : ""} instead.` : "."}
                </AssumptionNote>
                {allProducts &&
                  (() => {
                    const pts = [
                      ...allProducts.history.map((p) => ({ date: p.date, value: p.value, low: p.value, high: p.value, isForecast: false })),
                      ...allProducts.forecast.map((f) => ({ date: f.date, value: f.expected, low: f.low, high: f.high, isForecast: true })),
                    ];
                    const aStep = niceStep(Math.max(1, ...pts.map((p) => p.high)) / 4);
                    const aTicks = Math.max(1, Math.ceil(Math.max(1, ...pts.map((p) => p.high)) / aStep));
                    const aYMax = aStep * aTicks;
                    const ax = (i: number) => PAD_L + (pts.length <= 1 ? 0 : (i / (pts.length - 1)) * plotW);
                    const ay = (v: number) => PAD_T + plotH - (Math.min(v, aYMax) / aYMax) * plotH;
                    const firstF = allProducts.history.length;
                    const actual: Point[] = pts.slice(0, firstF).map((p, i) => ({ x: ax(i), y: ay(p.value) }));
                    const tail = pts.slice(firstF - 1);
                    const expected: Point[] = tail.map((p, i) => ({ x: ax(firstF - 1 + i), y: ay(p.value) }));
                    const top: Point[] = tail.map((p, i) => ({ x: ax(firstF - 1 + i), y: ay(p.high) }));
                    const bottom: Point[] = tail.map((p, i) => ({ x: ax(firstF - 1 + i), y: ay(p.low) }));
                    const color = "var(--fc-s-primary)";
                    const slots: HoverSlot[] = pts.map((p, i) => ({
                      xPct: (ax(i) / CHART_W) * 100,
                      title: `${monthYearName(p.date)}${p.isForecast ? " · forecast" : ""}`,
                      rows: [
                        {
                          color,
                          dashed: p.isForecast,
                          value: unitFormatter.format(p.value),
                          label: p.isForecast ? "forecast, all products" : "units sold, all products",
                          note: p.isForecast ? `${unitFormatter.format(p.low)}–${unitFormatter.format(p.high)}` : undefined,
                        },
                      ],
                    }));
                    return (
                      <>
                        <h3 className="fc-h3" style={{ marginTop: "1.25rem" }}>All products - monthly sales</h3>
                        <p className="fc-card-sub">Net units per month from the Odoo sales sync, completed months only.</p>
                        <div className="mt-3 overflow-x-auto">
                          <div style={{ minWidth: 560 }}>
                            <ChartHover slots={slots} topPct={(PAD_T / CHART_H) * 100} bottomPct={((PAD_T + plotH) / CHART_H) * 100}>
                              <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="block h-auto w-full" role="img" aria-label="Units sold per month across all products, actual and forecast">
                                {Array.from({ length: aTicks }, (_, i) => aStep * (i + 1)).map((t) => (
                                  <g key={t}>
                                    <line x1={PAD_L} x2={CHART_W - PAD_R} y1={ay(t)} y2={ay(t)} stroke="var(--fc-grid)" strokeWidth={1} />
                                    <text x={PAD_L - 8} y={ay(t) + 4} textAnchor="end" className="fc-chart-text">{unitFormatter.format(t)}</text>
                                  </g>
                                ))}
                                <line x1={PAD_L} x2={CHART_W - PAD_R} y1={ay(0)} y2={ay(0)} stroke="#c9cad0" strokeWidth={1} />
                                <path d={smoothBandPath(top, bottom)} fill={color} opacity={0.12} />
                                <path d={smoothPath(actual)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
                                <path d={smoothPath(expected)} fill="none" stroke={color} strokeWidth={2} strokeDasharray="5 4" />
                                {pts.map((p, i) => (
                                  <circle key={p.date} cx={ax(i)} cy={ay(p.value)} r={4} fill={p.isForecast ? "#fff" : color} stroke={p.isForecast ? color : "#fff"} strokeWidth={2} />
                                ))}
                                {pts.map((p, i) => (
                                  <text key={p.date} x={ax(i)} y={CHART_H - PAD_B + 20} textAnchor="middle" className="fc-chart-text">
                                    {i === 0 || p.date.slice(5, 7) === "01" ? monthYearName(p.date) : monthName(p.date)}
                                  </text>
                                ))}
                              </svg>
                            </ChartHover>
                          </div>
                        </div>
                      </>
                    );
                  })()}
              </>
            ) : (
              <>
                {/* On a phone the chart keeps a readable width and scrolls sideways instead of shrinking its labels. */}
                <div className="mt-3 overflow-x-auto">
                  <div style={{ minWidth: 560 }}>
                  <ChartHover slots={mainSlots} topPct={(PAD_T / CHART_H) * 100} bottomPct={((PAD_T + plotH) / CHART_H) * 100}>
                    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="block h-auto w-full" role="img" aria-label="Quantity sold per month, actual and forecast">
                      {Array.from({ length: yTicks }, (_, i) => step * (i + 1)).map((t) => (
                        <g key={t}>
                          <line x1={PAD_L} x2={CHART_W - PAD_R} y1={yFor(t)} y2={yFor(t)} stroke="var(--fc-grid)" strokeWidth={1} />
                          <text x={PAD_L - 8} y={yFor(t) + 4} textAnchor="end" className="fc-chart-text">{unitFormatter.format(t)}</text>
                        </g>
                      ))}
                      <line x1={PAD_L} x2={CHART_W - PAD_R} y1={yFor(0)} y2={yFor(0)} stroke="#c9cad0" strokeWidth={1} />
                      <line x1={xFor(todayIdx)} x2={xFor(todayIdx)} y1={PAD_T - 6} y2={PAD_T + plotH} stroke="#b4b6bd" strokeWidth={1} />
                      <text x={xFor(todayIdx)} y={PAD_T - 12} textAnchor="middle" className="fc-chart-text" style={{ fill: "var(--fc-ink-2)" }}>Today</text>

                      {chartSeries.map(({ s, history, forecastShown, color }) => {
                        const actualPts: Point[] = history.map((p) => ({ x: xFor(historyIdx.get(p.date)!), y: yFor(p.value) }));
                        const origin = forecastOrigin(s);
                        // One continuous line: the solid actual line runs on from the last full month to this month so far (MTD), and the dashed line picks up from MTD through the projected full month into the forecast.
                        const mtdPt: Point = { x: xFor(todayIdx), y: yFor(s.mtd.mtdUnits) };
                        const actualLine: Point[] = [...actualPts, mtdPt];
                        const expectedLine: Point[] = [mtdPt, origin, ...forecastShown.map((f, i) => ({ x: xFor(forecastStartIdx + i), y: yFor(f.expected) }))];
                        const bandTop: Point[] = [origin, ...forecastShown.map((f, i) => ({ x: xFor(forecastStartIdx + i), y: yFor(f.high) }))];
                        const bandBottom: Point[] = [origin, ...forecastShown.map((f, i) => ({ x: xFor(forecastStartIdx + i), y: yFor(f.low) }))];
                        return (
                          <g key={s.key}>
                            <path d={smoothBandPath(bandTop, bandBottom)} fill={color} opacity={0.12} />
                            <path d={smoothPath(actualLine)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
                            <path d={smoothPath(expectedLine)} fill="none" stroke={color} strokeWidth={2} strokeDasharray="5 4" />
                            {actualPts.map((pt, i) => (
                              <circle key={history[i].date} cx={pt.x} cy={pt.y} r={4} fill={color} stroke="#fff" strokeWidth={2} />
                            ))}
                            {history.map((p) =>
                              s.stockoutDaysByMonth.get(p.date) ? (
                                <rect key={`so-${p.date}`} x={xFor(historyIdx.get(p.date)!) - 2.5} y={PAD_T + plotH + 3} width={5} height={5} fill={color} />
                              ) : null,
                            )}
                            <circle cx={xFor(todayIdx)} cy={yFor(s.mtd.mtdUnits)} r={4} fill={color} stroke="#fff" strokeWidth={2} />
                            <circle cx={xFor(projIdx)} cy={yFor(s.mtd.projectedFullMonthUnits)} r={4} fill="#fff" stroke={color} strokeWidth={2} />
                            {forecastShown.map((f, i) => (
                              <circle key={f.date} cx={xFor(forecastStartIdx + i)} cy={yFor(f.expected)} r={4} fill="#fff" stroke={color} strokeWidth={2} />
                            ))}
                            {s.drilldownFraction === null && (colorFilter || sizeFilter) && (
                              <text x={xFor(forecastStartIdx)} y={PAD_T + plotH - 8} className="fc-chart-text">no recent sales for this colour/size - forecast is 0</text>
                            )}
                          </g>
                        );
                      })}
                      {xPoints.map((p, i) => (
                        <text key={p.key} x={xFor(i)} y={CHART_H - PAD_B + 20} textAnchor="middle" className="fc-chart-text">{p.label}</text>
                      ))}
                    </svg>
                  </ChartHover>
                  </div>
                </div>
                <p className="fc-card-sub">
                  Filled point = actual, hollow = projected or forecast. MTD is this month so far; the dashed line from it runs through the projected full month into the forecast. A small square under the axis marks a month with a recorded stockout day.
                  {series.some((s) => s.backtestMape != null) && (
                    <>
                      {" "}Backtest over the last 3 months:{" "}
                      {series.filter((s) => s.backtestMape != null).map((s) => `${series.length > 1 ? `${s.label} ` : ""}${s.backtestMape!.toFixed(0)}% average error`).join(", ")}.
                    </>
                  )}
                </p>

                <details className="fc-table-toggle mt-3">
                  <summary>View as table</summary>
                  <div className="mt-2 overflow-x-auto">
                    <table className="fc-table">
                      <thead>
                        <tr>
                          <th>Month</th>
                          {chartSeries.map(({ s }) => <th key={s.key} style={{ textAlign: "right" }}>{series.length > 1 ? s.label : "Units"}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {mainSlots.map((slot) => (
                          <tr key={slot.title}>
                            <td>{slot.title}</td>
                            {chartSeries.map(({ s }, si) => {
                              const row = series.length > 1 ? slot.rows.find((r) => r.label === s.label) : slot.rows[si];
                              return (
                                <td key={s.key} style={{ textAlign: "right" }}>
                                  {row ? `${row.value}${row.note && /^\d/.test(row.note) ? ` (${row.note})` : ""}` : "–"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </section>

          {/* Projected stock */}
          <section className="fc-card fc-card-pad">
            <h2 className="fc-card-title">
              Projected stock{" "}
              <HelpIcon text="Stock on hand at the end of each month: today's stock, minus forecast sales, plus open POs once they arrive (counted at their late ETA). The line is the safety-stock level. The dark bar is the month stock is projected to reach it." />
            </h2>
            <p className="fc-card-sub">
              Units on hand at month end{whatIfQty ? `, including a ${unitFormatter.format(whatIfQty)}-unit order placed today` : ""}.
            </p>
            <div className="mt-3">
              <ChartHover slots={stockSlots} topPct={(sPadT / STOCK_H) * 100} bottomPct={((sPadT + sPlotH) / STOCK_H) * 100} crosshair={false}>
                <svg viewBox={`0 0 ${STOCK_W} ${STOCK_H}`} className="block h-auto w-full" role="img" aria-label="Projected stock on hand at the end of each month">
                  {Array.from({ length: sTicks }, (_, i) => sStep * (i + 1)).map((t) => (
                    <g key={t}>
                      <line x1={sPadL} x2={STOCK_W - sPadR} y1={sYFor(t)} y2={sYFor(t)} stroke="var(--fc-grid)" strokeWidth={1} />
                      <text x={sPadL - 8} y={sYFor(t) + 4} textAnchor="end" className="fc-chart-text">{unitFormatter.format(t)}</text>
                    </g>
                  ))}
                  {stockBars.map((b, i) => {
                    const top = sYFor(b.low);
                    const base = sYFor(0);
                    const h = base - top;
                    const r = Math.min(4, h);
                    const x0 = sXFor(i) - stockBarW / 2;
                    const x1 = x0 + stockBarW;
                    if (h <= 0) return null;
                    return (
                      <path
                        key={b.monthIso}
                        d={`M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x1 - r} Q${x1},${top} ${x1},${top + r} V${base} Z`}
                        fill={b.monthIso === crossingMonth ? "var(--fc-ink)" : "var(--fc-bar)"}
                      />
                    );
                  })}
                  <line x1={sPadL} x2={STOCK_W - sPadR} y1={sYFor(0)} y2={sYFor(0)} stroke="#c9cad0" strokeWidth={1} />
                  <line x1={sPadL} x2={STOCK_W - sPadR} y1={sYFor(plannerCalc.safetyStock)} y2={sYFor(plannerCalc.safetyStock)} stroke="var(--fc-bad)" strokeWidth={1.5} />
                  <text x={STOCK_W - sPadR} y={sYFor(plannerCalc.safetyStock) - 6} textAnchor="end" className="fc-chart-text" style={{ fill: "var(--fc-ink-2)" }}>
                    Safety stock {unitFormatter.format(plannerCalc.safetyStock)}
                  </text>
                  {stockBars.map((b, i) => (
                    <text key={b.monthIso} x={sXFor(i)} y={STOCK_H - sPadB + 20} textAnchor="middle" className="fc-chart-text">{monthName(b.monthIso)}</text>
                  ))}
                </svg>
              </ChartHover>
            </div>
            {orderBy.crossesSafetyStockDate ? (
              <AssumptionNote bad={orderBy.alreadyLate}>
                {orderBy.alreadyLate ? "Already late - " : ""}Order by <strong>{orderBy.orderByDate}</strong> to land before stock reaches the safety-stock level (around {orderBy.crossesSafetyStockDate}).
              </AssumptionNote>
            ) : (
              <p className="fc-card-sub">Not projected to reach the safety-stock level within this horizon.</p>
            )}
          </section>
        </div>

        {/* PO planner - collapsed by default; stays open while a what-if is being simulated */}
        <details className="fc-card fc-details" style={{ marginTop: "0.875rem" }} open={whatIfQty != null}>
          <summary>
            <span>
              <span className="fc-card-title">PO planner</span>
              <span className="fc-card-sub" style={{ display: "block" }}>
                How the suggested {unitFormatter.format(plannerCalc.suggestedPoQty)} units for {primaryStyle.name} is worked out, a what-if, and the colour × size split to export.
              </span>
            </span>
          </summary>
          <div className="fc-details-body">
            {!primaryLeadTimeProductId && (
              <AssumptionNote>
                Not linked to a lead-time product - open PO qty can&apos;t be computed. Link it on <Link href="/forecast/lead-times" className="underline">Lead times</Link>.
              </AssumptionNote>
            )}
            {plannerCalc.alreadyLate && (
              <AssumptionNote bad>Already late: projected stock would go negative before a PO placed today could arrive.</AssumptionNote>
            )}

            <dl className="fc-steps" style={{ marginTop: "1rem" }}>
              {plannerCalc.steps.map((s) => (
                <div key={s.label}>
                  <div className="flex justify-between gap-4">
                    <dt style={{ color: "var(--fc-ink-2)" }}>{s.label}</dt>
                    <dd className="font-medium tabular-nums">{unitFormatter.format(s.value)}</dd>
                  </div>
                  <div className="fc-card-sub" style={{ marginTop: "0.15rem" }}>{s.formula}</div>
                </div>
              ))}
            </dl>

            <h3 className="fc-h3">What if I order X?</h3>
            <Form action="" className="mt-2 flex items-end gap-2">
              <HiddenParams params={params} except={["whatIfQty"]} />
              <input type="number" name="whatIfQty" min={0} defaultValue={params.whatIfQty ?? ""} placeholder="Qty" aria-label="Order quantity" className="fc-control fc-control-light w-28" />
              <SubmitButton className="fc-btn fc-btn-light">Simulate</SubmitButton>
            </Form>
            {whatIf && (
              <p className="mt-2 text-sm" style={{ color: "var(--fc-ink-2)" }}>
                Stock on landing: <strong>{unitFormatter.format(whatIf.stockAfterLanding)}</strong>.{" "}
                {whatIf.projectedStockoutDate ? <>Projected to run out around <strong>{whatIf.projectedStockoutDate}</strong>.</> : "Not projected to run out within a year at the current forecast rate."}{" "}
                The Projected stock chart above includes this order.
              </p>
            )}

            <h3 className="fc-h3">Suggested PO - colour × size</h3>
            <p className="fc-card-sub">
              Splits the product total ({unitFormatter.format(plannerCalc.suggestedPoQty)} units) by recent sales mix - colour over the last 3 months, size over the last 6. A blank cell means no recent sales to base a share on, not zero demand. Every qty and price is editable before exporting.
            </p>
            <form action="/api/forecast/export-po" method="post" className="mt-3">
              <input type="hidden" name="styleName" value={primaryStyle.name} />
              <div className="overflow-x-auto">
                <table className="fc-table" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th>Style</th>
                      <th>Colour</th>
                      <th>Size</th>
                      <th style={{ textAlign: "right" }}>Qty</th>
                      <th style={{ textAlign: "right" }}>CMT price (IDR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.map((cell, i) => (
                      <tr key={i}>
                        <td>
                          <input type="hidden" name={`color_${i}`} value={cell.color ?? ""} />
                          <input type="hidden" name={`size_${i}`} value={cell.size ?? ""} />
                          {primaryStyle.name}
                        </td>
                        <td>{cell.color ?? "-"}</td>
                        <td>{cell.size ?? "-"}</td>
                        <td style={{ textAlign: "right" }}>
                          <input type="number" name={`qty_${i}`} defaultValue={cell.suggestedQty != null ? Math.round(cell.suggestedQty) : ""} aria-label="Qty" className="fc-cell-input w-20" />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input type="number" name={`cmt_${i}`} defaultValue={cell.cmtPriceIdr ?? ""} aria-label="CMT price" className="fc-cell-input w-28" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <input type="hidden" name="rowCount" value={grid.length} />
              <SubmitButton className="fc-btn fc-btn-solid mt-4">Export PO to CSV</SubmitButton>
            </form>
          </div>
        </details>
      </div>
    </div>
  );
}
