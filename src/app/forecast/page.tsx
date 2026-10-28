import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { forecast, type Period, type ForecastResult } from "@/lib/forecast/engine";
import { hasForecastSchema, fetchStockLevels } from "@/lib/forecast/data";
import { hasLeadTimeSchema, fetchLeadTimeSettings, fetchEstimatesByProduct, fetchMeasuredDeliveriesByProduct } from "@/lib/leadtime/data";
import { resolveProductLeadTime, type LeadTimeRange, type LeadTimeSettings } from "@/lib/leadtime/resolve";
import { fetchAttributeAliases, canonicalColor, canonicalSize, type AttributeAliasMap } from "@/lib/forecast/aliases";
import {
  hasPoPlanningSchema,
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
  type OpenPoLine,
  type TrajectoryPoint,
} from "@/lib/forecast/planner";
import { paletteCss, paletteVar } from "@/lib/viz/palette";
import { niceStep, linePath, bandPath, type Point } from "@/lib/viz/chart-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_OPTIONS = [6, 12, 24, 0] as const; // 0 = "all"
const NEXT_OPTIONS = [1, 3, 6] as const;
const DEFAULT_LOW_VOLUME_THRESHOLD = 10;

const unitFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
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
function AssumptionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
      {children}
    </p>
  );
}
function HelpIcon({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-zinc-400 text-[9px] leading-none text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
      ?
    </span>
  );
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
  const { data: storeRows } = await supabase.from("stores").select("id, name").eq("active", true).order("name");
  const HIDDEN_STORE_NAMES = new Set(["nsa"]);
  const stores = (storeRows ?? []).filter((s) => !HIDDEN_STORE_NAMES.has(s.name.trim().toLowerCase()));

  const styleOptions = await fetchStyleOptions(supabase);
  if (!styleOptions.length) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Forecast</h1>
        <p className="mt-2 text-sm text-zinc-500">No products synced yet - run an Odoo sync on Operations first.</p>
      </div>
    );
  }

  const primaryStyle = resolveStyleByName(params.product, styleOptions) ?? styleOptions[0];
  const productNotFound = !!params.product && !resolveStyleByName(params.product, styleOptions);
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

  const primaryVariants = await fetchStyleVariants(supabase, primaryStyle.templateId);
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
    const productId = leadTimeSchemaOk ? await fetchLinkedLeadTimeProductId(supabase, templateId) : null;
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
    const styleMonthlySeries = await fetchStyleMonthlyNetUnits(supabase, styleProductIds, storeIdsForSales, historyFrom, currentMonthIso);
    const forecastResult = forecast(styleMonthlySeries, { horizon: forecastHorizonMonths });

    let drilldownFraction: number | null = 1;
    if (colorFilter || sizeFilter) {
      const shares = await fetchAllocationShares(supabase, variants, today.toISOString(), aliases);
      const colorFrac = colorFilter ? shares.colorShare.get(colorFilter) : 1;
      const sizeFrac = sizeFilter ? shares.sizeShare.get(sizeFilter) : 1;
      drilldownFraction = colorFrac === undefined || sizeFrac === undefined ? null : colorFrac * sizeFrac;
    }

    const upliftFactors = poPlanningSchemaOk ? await fetchUpliftFactors(supabase, style.templateId) : [];
    const upliftedForecast = forecastResult.forecast.map((f) => {
      const totalFraction = upliftFactors.reduce((sum, factor) => sum + upliftOverlapFraction(f.date, factor) * (factor.upliftPct / 100), 0);
      const multiplier = (1 + totalFraction) * (drilldownFraction ?? 0);
      return { date: f.date, expected: f.expected * multiplier, low: f.low * multiplier, high: f.high * multiplier };
    });

    // Displayed actual history IS scoped to the colour/size filter (real data, shown at whatever scope is selected).
    const monthlySeries = await fetchStyleMonthlyNetUnits(supabase, filteredProductIds, storeIdsForSales, historyFrom, currentMonthIso);
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
    const compareVariants = await fetchStyleVariants(supabase, compareStyle.templateId);
    compareSeries = await buildSeries("compare", compareStyle.name, compareStyle, compareVariants);
  }
  const series = [primarySeries, ...(compareSeries ? [compareSeries] : [])];

  const isEmpty = primarySeries.monthlySeries.every((p) => p.value === 0) && primarySeries.mtd.mtdUnits === 0;
  const avgMonthly = primarySeries.monthlySeries.length
    ? primarySeries.monthlySeries.reduce((s, p) => s + p.value, 0) / primarySeries.monthlySeries.length
    : 0;
  const isLowVolume = avgMonthly > 0 && avgMonthly < lowVolumeThreshold;

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
    ...primarySeries.upliftedForecast.slice(0, nextMonths).map((f) => ({ key: f.date, label: monthLabelFormatter.format(new Date(`${f.date}T00:00:00Z`)), monthIso: f.date })),
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
  const yMax = step * 5;
  const yFor = (v: number) => PAD_T + plotH - (Math.min(v, yMax) / yMax) * plotH;

  const paletteKeys = series.map((s) => s.key);

  // --- Planner (primary product only) ---
  const planStockLevels = await fetchStockLevels(supabase);
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

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <style dangerouslySetInnerHTML={{ __html: paletteCss("fc-chart", paletteKeys) }} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Forecast</h1>
        <div className="flex items-center gap-3 text-xs">
          <Link href="/forecast/overview" className="text-zinc-500 hover:underline">Forecasting overview →</Link>
          <Link href="/forecast/lead-times" className="text-zinc-500 hover:underline">Lead times →</Link>
        </div>
      </div>

      {!leadTimeSchemaOk && (
        <AssumptionNote>
          Lead-time data isn&apos;t available yet - run <code>supabase/migrations/0027_lead_times.sql</code>, <code>0028_seed_purchase_orders.sql</code>, and <code>0029_po_planning.sql</code>. Using the global default lead time (42-56 days) until then.
        </AssumptionNote>
      )}
      {leadTimeSchemaOk && primaryLeadTimeResolution.usedFallback && <AssumptionNote>{primaryLeadTimeResolution.detail}</AssumptionNote>}
      {productNotFound && <AssumptionNote>No product named &quot;{params.product}&quot; - showing {primaryStyle.name} instead.</AssumptionNote>}
      {compareNotFound && <AssumptionNote>No product named &quot;{params.compareProduct}&quot; to compare - ignored.</AssumptionNote>}

      {/* Filters */}
      <form className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 text-xs dark:border-zinc-800" method="get">
        <datalist id="style-options">
          {styleOptions.map((s) => <option key={s.templateId} value={s.name} />)}
        </datalist>
        <label className="flex flex-col gap-1">
          Product
          <input list="style-options" name="product" defaultValue={primaryStyle.name} className="w-56 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <label className="flex flex-col gap-1">
          + Compare (optional)
          <input list="style-options" name="compareProduct" defaultValue={compareStyle?.name ?? params.compareProduct ?? ""} placeholder="Another product..." className="w-56 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <label className="flex flex-col gap-1">
          Colour
          <select name="color" defaultValue={colorFilter ?? ""} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            <option value="">All colours</option>
            {colorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Size
          <select name="size" defaultValue={sizeFilter ?? ""} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            <option value="">All sizes</option>
            {sizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Store
          <select name="store" defaultValue={params.store ?? "all"} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            <option value="all">All stores</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Past
          <select name="past" defaultValue={pastMonths} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
            <option value={24}>24 months</option>
            <option value={0}>All</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Next
          <select name="next" defaultValue={nextMonths} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            {NEXT_OPTIONS.map((n) => <option key={n} value={n}>{n} month{n > 1 ? "s" : ""}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1">
          <input type="checkbox" name="adjustStockouts" defaultChecked={adjustStockouts} /> Adjust for stockouts
        </label>
        <HiddenParams params={params} except={["product", "compareProduct", "color", "size", "store", "past", "next", "adjustStockouts"]} />
        <button type="submit" className="rounded bg-zinc-800 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900">
          Apply
        </button>
      </form>

      {isLowVolume && (
        <p className="mt-3 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
          Low volume - averaging {avgMonthly.toFixed(1)} units/month over this window, forecast is rough.
        </p>
      )}

      {/* Chart */}
      <div className="mt-4">
        {isEmpty ? (
          <p className="rounded-lg border border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
            No sales history for {primaryStyle.name}{colorFilter || sizeFilter ? ` (${[colorFilter, sizeFilter].filter(Boolean).join(" / ")})` : ""} in this window.
          </p>
        ) : (
          <>
            <h2 className="flex items-center gap-1.5 text-sm font-medium">
              Quantity sold <HelpIcon text="Solid line = actual net units sold (sales minus returns), one marker per month. The current month shows month-to-date (filled dot) and a projected full month (hollow dot) separately. Dashed line + band = forecast low/expected/high, widening further out." />
            </h2>
            <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="mt-2 h-auto w-full" role="img" aria-label="Quantity sold per month, actual and forecast">
              {Array.from({ length: 5 }, (_, i) => step * (i + 1)).map((t) => (
                <g key={t}>
                  <line x1={PAD_L} x2={CHART_W - PAD_R} y1={yFor(t)} y2={yFor(t)} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeWidth={1} strokeDasharray="3 3" />
                  <text x={PAD_L - 6} y={yFor(t) + 3} textAnchor="end" className="fill-zinc-400 text-[9px]">{unitFormatter.format(t)}</text>
                </g>
              ))}
              <line x1={PAD_L} x2={CHART_W - PAD_R} y1={yFor(0)} y2={yFor(0)} stroke="currentColor" className="text-zinc-300 dark:text-zinc-700" strokeWidth={1} />
              <line x1={xFor(todayIdx)} x2={xFor(todayIdx)} y1={PAD_T} y2={PAD_T + plotH} stroke="currentColor" className="text-zinc-400 dark:text-zinc-600" strokeWidth={1} strokeDasharray="2 2" />
              <text x={xFor(todayIdx)} y={PAD_T - 18} textAnchor="middle" className="fill-zinc-500 text-[9px] font-medium">Today</text>
              <text x={xFor(forecastStartIdx)} y={PAD_T - 18} className="fill-zinc-400 text-[10px] italic">Prediction</text>

              {series.map((s) => {
                const historyShown = trimToPast(s.displayMonths, pastMonths);
                const actualPts: Point[] = historyShown.map((p, i) => ({ x: xFor(i), y: yFor(p.value) }));
                const expectedLine: Point[] = [
                  { x: xFor(projIdx), y: yFor(s.mtd.projectedFullMonthUnits) },
                  ...s.upliftedForecast.slice(0, nextMonths).map((f, i) => ({ x: xFor(forecastStartIdx + i), y: yFor(f.expected) })),
                ];
                const bandTop: Point[] = [
                  { x: xFor(projIdx), y: yFor(s.mtd.projectedFullMonthUnits) },
                  ...s.upliftedForecast.slice(0, nextMonths).map((f, i) => ({ x: xFor(forecastStartIdx + i), y: yFor(f.high) })),
                ];
                const bandBottom: Point[] = [
                  { x: xFor(projIdx), y: yFor(s.mtd.projectedFullMonthUnits) },
                  ...s.upliftedForecast.slice(0, nextMonths).map((f, i) => ({ x: xFor(forecastStartIdx + i), y: yFor(f.low) })),
                ];
                const color = paletteVar(s.key);
                return (
                  <g key={s.key}>
                    <path d={bandPath(bandTop, bandBottom)} fill={color} opacity={0.15} />
                    <path d={linePath(actualPts)} fill="none" stroke={color} strokeWidth={2} />
                    <path d={linePath(expectedLine)} fill="none" stroke={color} strokeWidth={2} strokeDasharray="5 4" />
                    {historyShown.map((p, i) => (
                      <circle key={p.date} cx={xFor(i)} cy={yFor(p.value)} r={3} fill={color}>
                        <title>
                          {s.label} - {monthLabelFormatter.format(new Date(`${p.date}T00:00:00Z`))}: {unitFormatter.format(p.value)} units{p.adjusted ? " (adjusted for stockouts)" : ""}
                          {s.stockoutDaysByMonth.get(p.date) ? `, ${s.stockoutDaysByMonth.get(p.date)} stockout day(s)` : ""}
                        </title>
                      </circle>
                    ))}
                    {historyShown.map((p, i) =>
                      s.stockoutDaysByMonth.get(p.date) ? <rect key={`so-${p.date}`} x={xFor(i) - 2} y={PAD_T + plotH + 3} width={4} height={4} fill={color} /> : null,
                    )}
                    <circle cx={xFor(todayIdx)} cy={yFor(s.mtd.mtdUnits)} r={3} fill={color}>
                      <title>{s.label} - month to date: {unitFormatter.format(s.mtd.mtdUnits)} units over {s.mtd.daysElapsed}/{s.mtd.daysInMonth} days.</title>
                    </circle>
                    <circle cx={xFor(projIdx)} cy={yFor(s.mtd.projectedFullMonthUnits)} r={3} fill="white" stroke={color} strokeWidth={1.5}>
                      <title>{s.label} - projected full month: {unitFormatter.format(s.mtd.projectedFullMonthUnits)} units.</title>
                    </circle>
                    {s.upliftedForecast.slice(0, nextMonths).map((f, i) => (
                      <circle key={f.date} cx={xFor(forecastStartIdx + i)} cy={yFor(f.expected)} r={3} fill={color}>
                        <title>{s.label} - {monthLabelFormatter.format(new Date(`${f.date}T00:00:00Z`))} forecast: {unitFormatter.format(f.expected)} ({unitFormatter.format(f.low)}-{unitFormatter.format(f.high)})</title>
                      </circle>
                    ))}
                    {s.drilldownFraction === null && (colorFilter || sizeFilter) && (
                      <text x={xFor(forecastStartIdx)} y={PAD_T + plotH - 6} className="fill-zinc-400 text-[9px]">no trailing data for this colour/size - forecast is 0</text>
                    )}
                  </g>
                );
              })}
              {xPoints.map((p, i) => (
                <text key={p.key} x={xFor(i)} y={CHART_H - PAD_B + 15} textAnchor="middle" className="fill-zinc-400 text-[9px]">{p.label}</text>
              ))}
            </svg>
            <p className="mt-1 text-[10px] text-zinc-400">■ below the axis = a month with a recorded stockout day.</p>

            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {series.map((s) => (
                <div key={s.key} className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: paletteVar(s.key) }} />
                  <span className="font-medium">{s.label}</span>
                  {s.backtestMape != null && <span className="text-zinc-500">backtest (3mo): {s.backtestMape.toFixed(0)}% MAPE</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* PO planner - collapsed by default */}
      <details className="mt-8 mb-16 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">PO planner - {primaryStyle.name}</summary>
        <div className="border-t border-zinc-200 p-4 text-xs dark:border-zinc-800">
          {!primaryLeadTimeProductId && (
            <AssumptionNote>
              Not linked to a lead-time product - open PO qty can&apos;t be computed. Link it on <Link href="/forecast/lead-times" className="underline">Lead times</Link>.
            </AssumptionNote>
          )}
          {plannerCalc.alreadyLate && (
            <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 font-medium text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              Already late: projected stock would go negative before a PO placed today could arrive.
            </p>
          )}

          <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {plannerCalc.steps.map((s) => (
              <div key={s.label}>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">{s.label}</dt>
                  <dd className="font-medium">{unitFormatter.format(s.value)}</dd>
                </div>
                <div className="text-[10px] text-zinc-400">{s.formula}</div>
              </div>
            ))}
          </dl>

          {/* Mini stock chart */}
          <h3 className="mt-4 text-sm font-medium">Projected stock on hand</h3>
          {(() => {
            const MINI_W = 680;
            const MINI_H = 180;
            const mPadL = 48, mPadR = 12, mPadT = 12, mPadB = 20;
            const mPlotW = MINI_W - mPadL - mPadR;
            const mPlotH = MINI_H - mPadT - mPadB;
            const monthSlots = [currentMonthIso, ...xPoints.slice(forecastStartIdx).map((p) => p.monthIso)];
            const mXFor = (i: number) => mPadL + (monthSlots.length <= 1 ? 0 : (i / (monthSlots.length - 1)) * mPlotW);
            const maxStock = Math.max(1, planStockOffice + planStockStores, ...trajectory.map((p) => p.high), plannerCalc.safetyStock);
            const mStep = niceStep(maxStock / 4);
            const mYMax = mStep * 5;
            const mYFor = (v: number) => mPadT + mPlotH - (Math.min(v, mYMax) / mYMax) * mPlotH;

            const lowPts: Point[] = monthSlots.map((m, i) => ({ x: mXFor(i), y: mYFor(sampleTrajectory(trajectory, endOfMonthIso(m))?.low ?? 0) }));
            const highPts: Point[] = monthSlots.map((m, i) => ({ x: mXFor(i), y: mYFor(sampleTrajectory(trajectory, endOfMonthIso(m))?.high ?? 0) }));

            return (
              <svg viewBox={`0 0 ${MINI_W} ${MINI_H}`} className="mt-2 h-auto w-full max-w-2xl" role="img" aria-label="Projected stock on hand">
                {Array.from({ length: 5 }, (_, i) => mStep * (i + 1)).map((t) => (
                  <line key={t} x1={mPadL} x2={MINI_W - mPadR} y1={mYFor(t)} y2={mYFor(t)} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeWidth={1} />
                ))}
                <path d={bandPath(highPts, lowPts)} fill="currentColor" className="text-zinc-400 dark:text-zinc-500" opacity={0.2} />
                <path d={linePath(lowPts)} fill="none" stroke="currentColor" className="text-zinc-700 dark:text-zinc-300" strokeWidth={2} strokeDasharray="5 4" />
                <line x1={mPadL} x2={MINI_W - mPadR} y1={mYFor(plannerCalc.safetyStock)} y2={mYFor(plannerCalc.safetyStock)} stroke="currentColor" className="text-red-500" strokeWidth={1.5}>
                  <title>Safety stock: {unitFormatter.format(plannerCalc.safetyStock)} units.</title>
                </line>
                {orderBy.crossesSafetyStockDate && (
                  <line
                    x1={mXFor(monthSlots.findIndex((m) => m.slice(0, 7) === orderBy.crossesSafetyStockDate!.slice(0, 7)))}
                    x2={mXFor(monthSlots.findIndex((m) => m.slice(0, 7) === orderBy.crossesSafetyStockDate!.slice(0, 7)))}
                    y1={mPadT}
                    y2={mPadT + mPlotH}
                    stroke="currentColor"
                    className={orderBy.alreadyLate ? "text-red-600" : "text-amber-500"}
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                  />
                )}
                {monthSlots.map((m, i) => (
                  <text key={m} x={mXFor(i)} y={MINI_H - mPadB + 13} textAnchor="middle" className="fill-zinc-400 text-[9px]">
                    {i === 0 ? "Today" : monthLabelFormatter.format(new Date(`${m}T00:00:00Z`))}
                  </text>
                ))}
              </svg>
            );
          })()}
          {orderBy.crossesSafetyStockDate ? (
            <p className={`mt-1 text-[10px] ${orderBy.alreadyLate ? "font-medium text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
              {orderBy.alreadyLate ? "Already late - " : ""}Order by <strong>{orderBy.orderByDate}</strong> to land before stock reaches the safety-stock level (~{orderBy.crossesSafetyStockDate}).
            </p>
          ) : (
            <p className="mt-1 text-[10px] text-zinc-400">Not projected to reach the safety-stock level within this horizon.</p>
          )}

          <h3 className="mt-4 text-sm font-medium">What if I order X?</h3>
          <form className="mt-1 flex items-end gap-2" method="get">
            <HiddenParams params={params} except={["whatIfQty"]} />
            <input type="number" name="whatIfQty" min={0} defaultValue={params.whatIfQty ?? ""} placeholder="qty" className="w-24 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
            <button type="submit" className="rounded border border-zinc-300 px-2 py-1 hover:border-zinc-500 dark:border-zinc-700">Simulate</button>
          </form>
          {whatIf && (
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              Stock on landing: <strong>{unitFormatter.format(whatIf.stockAfterLanding)}</strong>.{" "}
              {whatIf.projectedStockoutDate ? <>Projected to run out around <strong>{whatIf.projectedStockoutDate}</strong>.</> : "Not projected to run out within a year at the current forecast rate."}
            </p>
          )}

          <h3 className="mt-6 text-sm font-medium">Suggested PO - colour × size</h3>
          <p className="mt-1 text-[10px] text-zinc-500">
            Suggested qty allocates the style-level total ({unitFormatter.format(plannerCalc.suggestedPoQty)} units) by trailing sales mix - colour over the last 3 months, size over the last 6. A blank cell means no trailing sales to base a share on, not zero demand. Every qty/price cell is editable before exporting.
          </p>
          <form action="/api/forecast/export-po" method="post" className="mt-2">
            <input type="hidden" name="styleName" value={primaryStyle.name} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="px-2 py-1">Style</th>
                    <th className="px-2 py-1">Colour</th>
                    <th className="px-2 py-1">Size</th>
                    <th className="px-2 py-1 text-right">Qty</th>
                    <th className="px-2 py-1 text-right">CMT price (IDR)</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.map((cell, i) => (
                    <tr key={i} className="border-t border-zinc-100 dark:border-zinc-900">
                      <td className="px-2 py-1">
                        <input type="hidden" name={`color_${i}`} value={cell.color ?? ""} />
                        <input type="hidden" name={`size_${i}`} value={cell.size ?? ""} />
                        {primaryStyle.name}
                      </td>
                      <td className="px-2 py-1">{cell.color ?? "-"}</td>
                      <td className="px-2 py-1">{cell.size ?? "-"}</td>
                      <td className="px-2 py-1 text-right">
                        <input type="number" name={`qty_${i}`} defaultValue={cell.suggestedQty != null ? Math.round(cell.suggestedQty) : ""} className="w-20 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-right dark:border-zinc-700" />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input type="number" name={`cmt_${i}`} defaultValue={cell.cmtPriceIdr ?? ""} className="w-28 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-right dark:border-zinc-700" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <input type="hidden" name="rowCount" value={grid.length} />
            <button type="submit" className="mt-3 rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:border-zinc-500 dark:border-zinc-700">
              Export to CSV (opens in Excel)
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}
