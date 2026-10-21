import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { forecast } from "@/lib/forecast/engine";
import { hasForecastSchema, fetchStockLevels } from "@/lib/forecast/data";
import { hasLeadTimeSchema, fetchLeadTimeSettings, fetchEstimatesByProduct, fetchMeasuredDeliveriesByProduct } from "@/lib/leadtime/data";
import { resolveProductLeadTime, type LeadTimeRange } from "@/lib/leadtime/resolve";
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
  fetchForecastEvents,
} from "@/lib/forecast/style";
import {
  fetchLinkedLeadTimeProductId,
  fetchOpenPoLines,
  computePlanner,
  computeWhatIf,
  buildPoGrid,
} from "@/lib/forecast/planner";
import { niceStep, linePath, bandPath, type Point } from "@/lib/viz/chart-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_MONTHS_SHOWN = 12;
const HISTORY_MONTHS_FOR_YOY_CHECK = 13;

const unitFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const monthLabelFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", year: "2-digit" });

function monthStart(date: Date, offsetMonths: number): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offsetMonths, 1));
  return d.toISOString().slice(0, 10);
}
function addDaysIso(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}
function daysInMonthOf(monthIso: string): number {
  const d = new Date(`${monthIso}T00:00:00Z`);
  return new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getDate();
}

function AssumptionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
      {children}
    </p>
  );
}

interface SearchParams {
  style?: string;
  store?: string;
  color?: string;
  size?: string;
  coverageMonths?: string;
  serviceLevel?: string;
  adjustStockouts?: string;
  yoyOverlay?: string;
  whatIfQty?: string;
}

export default async function ForecastChartPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">PO Planning Chart</h1>
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
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">PO Planning Chart</h1>
        <AssumptionNote>
          Not shown yet - run <code>supabase/migrations/0023_forecast_inventory.sql</code> and{" "}
          <code>0029_po_planning.sql</code> in the Supabase SQL editor first.
        </AssumptionNote>
      </div>
    );
  }

  const HIDDEN_STORE_NAMES = new Set(["nsa"]); // pre-opening store - same exclusion as /operations and /forecast/overview
  const { data: storeRows } = await supabase.from("stores").select("id, name").eq("active", true).order("name");
  const stores = (storeRows ?? []).filter((s) => !HIDDEN_STORE_NAMES.has(s.name.trim().toLowerCase()));

  const styleOptions = await fetchStyleOptions(supabase);
  const selectedTemplateId = params.style ? Number(params.style) : styleOptions[0]?.templateId;

  if (!selectedTemplateId) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">PO Planning Chart</h1>
        <p className="mt-2 text-sm text-zinc-500">No products synced yet - run an Odoo sync on Operations first.</p>
      </div>
    );
  }

  const storeId = params.store && params.store !== "all" ? Number(params.store) : null;
  const colorFilter = params.color || null;
  const sizeFilter = params.size || null;
  const coverageMonths = Math.max(1, Number(params.coverageMonths) || 2);
  const coverageDays = coverageMonths * 30;
  const serviceLevel = Math.min(0.999, Math.max(0.5, Number(params.serviceLevel) || 0.9));
  const adjustStockouts = params.adjustStockouts === "on";
  const yoyOverlayRequested = params.yoyOverlay === "on";
  const whatIfQty = params.whatIfQty ? Number(params.whatIfQty) : null;

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const variants = await fetchStyleVariants(supabase, selectedTemplateId);
  const colorOptions = Array.from(new Set(variants.map((v) => v.color).filter((c): c is string => !!c))).sort();
  const sizeOptions = Array.from(new Set(variants.map((v) => v.size).filter((s): s is string => !!s))).sort();

  const drilldownVariants = variants.filter(
    (v) => (!colorFilter || v.color === colorFilter) && (!sizeFilter || v.size === sizeFilter),
  );
  const chartProductIds = drilldownVariants.map((v) => v.productId);
  const styleProductIds = variants.map((v) => v.productId);

  const historyFrom = monthStart(today, -HISTORY_MONTHS_FOR_YOY_CHECK);
  const currentMonthIso = monthStart(today, 0);
  const storeIds = storeId ? [storeId] : null;

  const isDrilldown = !!(colorFilter || sizeFilter);
  const allocationShares = await fetchAllocationShares(supabase, variants, today.toISOString());

  // --- Actual history (monthly, excludes the current in-progress month - that's handled separately as MTD/projected). Real sales, so this stays at whatever scope the chart is filtered to (drilldown or whole style). ---
  const monthlySeries = await fetchStyleMonthlyNetUnits(supabase, chartProductIds, storeIds, historyFrom, currentMonthIso);
  const hasYoyHistory = monthlySeries.length >= HISTORY_MONTHS_FOR_YOY_CHECK;
  const yoyOverlay = yoyOverlayRequested && hasYoyHistory;

  const dailyThisMonth = await fetchStyleDailyNetUnits(
    supabase,
    chartProductIds,
    storeIds,
    currentMonthIso,
    new Date(today.getTime() + DAY_MS).toISOString().slice(0, 10),
  );
  const mtd = computeMonthToDate(dailyThisMonth, today);

  // --- Lead time (linked product, or flagged as unlinked -> global default) ---
  const leadTimeProductId = leadTimeSchemaOk ? await fetchLinkedLeadTimeProductId(supabase, selectedTemplateId) : null;
  const leadTimeSettings = leadTimeSchemaOk
    ? await fetchLeadTimeSettings(supabase)
    : { lateEndBufferPct: 25, globalDefaultMinDays: 42, globalDefaultMaxDays: 56, measuredMinPoCount: 5, firstDeliveryOnly: false };

  let leadTimeResolution: LeadTimeRange;
  if (leadTimeProductId) {
    const [estimatesByProduct, measuredByProduct] = await Promise.all([
      fetchEstimatesByProduct(supabase),
      fetchMeasuredDeliveriesByProduct(supabase, leadTimeSettings.firstDeliveryOnly),
    ]);
    leadTimeResolution = resolveProductLeadTime(
      estimatesByProduct.get(leadTimeProductId) ?? [],
      measuredByProduct.get(leadTimeProductId) ?? [],
      leadTimeSettings,
    );
  } else {
    leadTimeResolution = {
      minDays: leadTimeSettings.globalDefaultMinDays,
      maxDays: leadTimeSettings.globalDefaultMaxDays,
      tier: "default",
      usedFallback: true,
      detail: "This style isn't linked to a lead-time product yet (link it on the Lead Times page) - using the global default range.",
    };
  }

  const forecastHorizonMonths = Math.ceil((leadTimeResolution.maxDays + coverageDays) / 30);

  // --- Forecast: ALWAYS at full style level, per the brief ("forecast at
  // style level, then allocate to colour/size by trailing sales mix") -
  // a colour/size drill-down re-scales this forecast for display rather
  // than fitting a separate, much sparser model on the filtered subset.
  // The planner panel (and backtest below) also always uses this
  // style-level result, regardless of the chart's drill-down. ---
  const styleMonthlySeries = isDrilldown
    ? await fetchStyleMonthlyNetUnits(supabase, styleProductIds, storeIds, historyFrom, currentMonthIso)
    : monthlySeries;
  const forecastResult = forecast(styleMonthlySeries, { horizon: forecastHorizonMonths });

  // Fraction of the style-level forecast this drill-down represents, from
  // the same trailing-mix shares used for the PO grid. Null (not 0) when
  // the selected colour/size has no trailing sales to base a share on -
  // the chart flags this rather than drawing a misleading flat line.
  const drilldownFraction: number | null = !isDrilldown
    ? 1
    : (() => {
        const colorFrac = colorFilter ? allocationShares.colorShare.get(colorFilter) : 1;
        const sizeFrac = sizeFilter ? allocationShares.sizeShare.get(sizeFilter) : 1;
        if (colorFrac === undefined || sizeFrac === undefined) return null;
        return colorFrac * sizeFrac;
      })();

  // --- Uplift factors applied on top of the style-level forecast, then the drill-down fraction ---
  const upliftFactors = poPlanningSchemaOk ? await fetchUpliftFactors(supabase, selectedTemplateId) : [];
  const upliftedForecast = forecastResult.forecast.map((f) => {
    const totalFraction = upliftFactors.reduce((sum, factor) => sum + upliftOverlapFraction(f.date, factor) * (factor.upliftPct / 100), 0);
    const multiplier = (1 + totalFraction) * (drilldownFraction ?? 0);
    return { ...f, expected: f.expected * multiplier, low: f.low * multiplier, high: f.high * multiplier, upliftMultiplier: multiplier };
  });

  // --- Stockout days (whatever history exists since migration 0029) ---
  const { stockoutDays, earliestHistoryDate } = poPlanningSchemaOk
    ? await fetchStockoutDays(supabase, chartProductIds, historyFrom, currentMonthIso)
    : { stockoutDays: [], earliestHistoryDate: null };
  const stockoutDaysByMonth = new Map<string, number>();
  for (const d of stockoutDays) {
    const m = `${d.date.slice(0, 7)}-01`;
    stockoutDaysByMonth.set(m, (stockoutDaysByMonth.get(m) ?? 0) + 1);
  }

  // --- Events (campaigns, user-added markers) ---
  const events = poPlanningSchemaOk
    ? await fetchForecastEvents(
        supabase,
        selectedTemplateId,
        historyFrom,
        addDaysIso(currentMonthIso, 31 * (forecastHorizonMonths + 1)),
      )
    : [];

  // --- Adjust-for-stockouts toggle ---
  const displayMonths: { date: string; value: number; adjusted: boolean }[] = monthlySeries.map((p) => {
    if (!adjustStockouts) return { date: p.date, value: p.value, adjusted: false };
    const stockoutCount = stockoutDaysByMonth.get(p.date) ?? 0;
    const historyCoversWholeMonth = !!earliestHistoryDate && earliestHistoryDate <= p.date;
    const result = adjustForStockouts(p.value, daysInMonthOf(p.date), stockoutCount, historyCoversWholeMonth);
    return { date: p.date, value: result.units, adjusted: result.adjusted };
  });

  // --- Same month last year overlay ---
  const yoyByMonth = new Map<string, number>();
  if (yoyOverlay) {
    for (const p of monthlySeries) {
      const d = new Date(`${p.date}T00:00:00Z`);
      const nextYear = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), 1)).toISOString().slice(0, 10);
      yoyByMonth.set(nextYear, p.value);
    }
  }

  // --- PO planner (always computed at full style level, not the chart's colour/size drill-down) ---
  const stockLevels = await fetchStockLevels(supabase);
  const styleProductIdSet = new Set(styleProductIds);
  let currentStockOffice = 0;
  let currentStockStores = 0;
  for (const r of stockLevels.rows) {
    if (!styleProductIdSet.has(r.productId)) continue;
    if (r.kind === "office") currentStockOffice += r.qty;
    else currentStockStores += r.qty;
  }

  const arrivalDateLate = addDaysIso(todayIso, leadTimeResolution.maxDays);
  const openPoLines = leadTimeProductId ? await fetchOpenPoLines(supabase, leadTimeProductId, leadTimeResolution) : [];
  const openPoBeforeArrival = openPoLines
    .filter((l) => l.resolvedEtaLatest <= arrivalDateLate)
    .reduce((sum, l) => sum + l.qtyOpen, 0);

  const firstForecastMonth = forecastResult.forecast[0];
  const dailyForecastRate = (firstForecastMonth?.expected ?? 0) / 30;
  // Converts the monthly forecast's residual std-dev to a daily figure
  // assuming variance scales linearly with time (a standard but
  // simplifying assumption - daily demand noise isn't literally
  // measured, only monthly) - flagged since it feeds safety stock
  // directly.
  const dailyForecastStdDev = forecastResult.residualStdDev / Math.sqrt(30);

  const plannerCalc = computePlanner({
    currentStockOffice,
    currentStockStores,
    openPoBeforeArrival,
    dailyForecastRate,
    dailyForecastStdDev,
    daysUntilArrival: leadTimeResolution.maxDays,
    coverageDays,
    targetServiceLevel: serviceLevel,
  });

  const whatIf = whatIfQty != null ? computeWhatIf(whatIfQty, plannerCalc, dailyForecastRate, arrivalDateLate) : null;

  const grid = await buildPoGrid(supabase, variants, plannerCalc.suggestedPoQty, allocationShares, leadTimeProductId);

  // --- Backtest accuracy badge (last 3 months, same rolling one-step-ahead method as /forecast/overview §5, and the same style-level series the forecast itself uses) ---
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

  // --- Chart x-axis: history months (minus current) + MTD + Projected + N forecast months ---
  type XPoint = { key: string; label: string; kind: "history" | "mtd" | "projected" | "forecast"; monthIso: string };
  const historyShown = displayMonths.slice(-HISTORY_MONTHS_SHOWN);
  const xPoints: XPoint[] = [
    ...historyShown.map((p) => ({ key: p.date, label: monthLabelFormatter.format(new Date(`${p.date}T00:00:00Z`)), kind: "history" as const, monthIso: p.date })),
    { key: `${currentMonthIso}-mtd`, label: `${monthLabelFormatter.format(new Date(`${currentMonthIso}T00:00:00Z`))} (MTD)`, kind: "mtd" as const, monthIso: currentMonthIso },
    { key: `${currentMonthIso}-proj`, label: `${monthLabelFormatter.format(new Date(`${currentMonthIso}T00:00:00Z`))} (proj.)`, kind: "projected" as const, monthIso: currentMonthIso },
    ...upliftedForecast.map((f) => ({ key: f.date, label: monthLabelFormatter.format(new Date(`${f.date}T00:00:00Z`)), kind: "forecast" as const, monthIso: f.date })),
  ];

  const CHART_W = 820;
  const CHART_H = 300;
  const PAD_L = 56;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 28;
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;
  const xFor = (i: number) => PAD_L + (xPoints.length <= 1 ? 0 : (i / (xPoints.length - 1)) * plotW);

  const maxValue = Math.max(
    1,
    ...historyShown.map((p) => p.value),
    mtd.projectedFullMonthUnits,
    ...upliftedForecast.map((f) => f.high),
    ...(yoyOverlay ? Array.from(yoyByMonth.values()) : []),
  );
  const step = niceStep(maxValue / 4);
  const yMax = step * 5;
  const yFor = (v: number) => PAD_T + plotH - (Math.min(v, yMax) / yMax) * plotH;

  const historyIdxOffset = 0;
  const actualLinePoints: Point[] = historyShown.map((p, i) => ({ x: xFor(historyIdxOffset + i), y: yFor(p.value) }));
  const mtdIdx = historyShown.length;
  const projIdx = historyShown.length + 1;
  const forecastStartIdx = historyShown.length + 2;

  const expectedLine: Point[] = [
    { x: xFor(projIdx), y: yFor(mtd.projectedFullMonthUnits) },
    ...upliftedForecast.map((f, i) => ({ x: xFor(forecastStartIdx + i), y: yFor(f.expected) })),
  ];
  const bandTop: Point[] = [
    { x: xFor(projIdx), y: yFor(mtd.projectedFullMonthUnits) },
    ...upliftedForecast.map((f, i) => ({ x: xFor(forecastStartIdx + i), y: yFor(f.high) })),
  ];
  const bandBottom: Point[] = [
    { x: xFor(projIdx), y: yFor(mtd.projectedFullMonthUnits) },
    ...upliftedForecast.map((f, i) => ({ x: xFor(forecastStartIdx + i), y: yFor(f.low) })),
  ];

  // Zone 1 (a PO placed today would land somewhere in here) and zone 2
  // (the coverage window right after) are mapped onto the month-indexed
  // axis by whichever forecast month each boundary date falls in -
  // whole-month shading, not exact day positions, since the x-axis
  // itself is categorical by month.
  const monthIndexFor = (iso: string): number => {
    const target = iso.slice(0, 7);
    const idx = xPoints.findIndex((p) => p.monthIso.slice(0, 7) === target);
    return idx === -1 ? xPoints.length - 1 : idx;
  };
  // Zone 1: the window when a PO placed today would arrive (today + lead
  // time min..max). Zone 2: the coverage window right after arrival.
  const zone1StartIdx = monthIndexFor(addDaysIso(todayIso, leadTimeResolution.minDays));
  const zone1EndIdx = monthIndexFor(arrivalDateLate); // arrivalDateLate = today + maxDays
  const zone2EndIdx = monthIndexFor(addDaysIso(arrivalDateLate, coverageDays));

  const zoneX = (startIdx: number, endIdx: number) => {
    const x0 = xFor(Math.max(0, startIdx) - 0.4);
    const x1 = xFor(Math.min(xPoints.length - 1, endIdx) + 0.4);
    return { x: Math.min(x0, x1), width: Math.abs(x1 - x0) };
  };
  const zone1 = zoneX(zone1StartIdx, zone1EndIdx);
  const zone2 = zoneX(zone1EndIdx, zone2EndIdx);

  const projectedStockoutMonthIdx =
    plannerCalc.projectedStockoutInDays != null
      ? monthIndexFor(addDaysIso(todayIso, plannerCalc.projectedStockoutInDays))
      : null;


  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PO Planning Chart</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Net units sold per month, forecast, and when a new PO would land - per style.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link href="/forecast/overview" className="text-zinc-500 hover:underline">Forecasting overview →</Link>
          <Link href="/forecast/lead-times" className="text-zinc-500 hover:underline">Lead times →</Link>
        </div>
      </div>

      {!leadTimeSchemaOk && (
        <AssumptionNote>
          Lead-time data isn&apos;t available yet - run{" "}
          <code>supabase/migrations/0027_lead_times.sql</code>,{" "}
          <code>0028_seed_purchase_orders.sql</code>, and{" "}
          <code>0029_po_planning.sql</code>. Using the global default lead
          time (42-56 days) until then.
        </AssumptionNote>
      )}
      {leadTimeSchemaOk && leadTimeResolution.usedFallback && (
        <AssumptionNote>{leadTimeResolution.detail}</AssumptionNote>
      )}
      {!poPlanningSchemaOk && (
        <AssumptionNote>
          Uplift factors, events, and stockout-day tracking aren&apos;t
          available yet - run <code>supabase/migrations/0029_po_planning.sql</code>.
          The chart and planner still work without them (no uplift applied,
          no markers, stockout adjustment is a no-op).
        </AssumptionNote>
      )}
      {poPlanningSchemaOk && earliestHistoryDate === null && (
        <AssumptionNote>
          No stock history recorded yet for stockout-day detection - that
          starts accumulating from the next stock sync onward (see
          migration 0029). Nothing before today can be marked as a
          stockout, even if one happened.
        </AssumptionNote>
      )}
      {isDrilldown && drilldownFraction === null && (
        <AssumptionNote>
          No trailing sales for &quot;{[colorFilter, sizeFilter].filter(Boolean).join(" / ")}&quot;
          in the window used for allocation (colour: 3 months, size: 6) -
          the forecast line/band below is 0 rather than a guess. The
          style-level forecast (all colours/sizes) is unaffected.
        </AssumptionNote>
      )}

      {/* Filters */}
      <form className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 text-xs dark:border-zinc-800" method="get">
        <label className="flex flex-col gap-1">
          Product (style)
          <select name="style" defaultValue={selectedTemplateId} className="w-56 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            {styleOptions.map((s) => (
              <option key={s.templateId} value={s.templateId}>{s.name}</option>
            ))}
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
          Colour
          <select name="color" defaultValue={params.color ?? ""} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            <option value="">All colours</option>
            {colorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Size
          <select name="size" defaultValue={params.size ?? ""} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            <option value="">All sizes</option>
            {sizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Coverage (months)
          <input type="number" name="coverageMonths" min={1} max={12} defaultValue={coverageMonths} className="w-20 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <label className="flex flex-col gap-1">
          Service level
          <input type="number" name="serviceLevel" step="0.01" min={0.5} max={0.99} defaultValue={serviceLevel} className="w-20 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <label className="flex items-center gap-2 pb-1">
          <input type="checkbox" name="adjustStockouts" defaultChecked={adjustStockouts} /> Adjust history for stockouts
        </label>
        {hasYoyHistory && (
          <label className="flex items-center gap-2 pb-1">
            <input type="checkbox" name="yoyOverlay" defaultChecked={yoyOverlay} /> Same month last year
          </label>
        )}
        <button type="submit" className="rounded bg-zinc-800 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900">
          Apply
        </button>
      </form>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Chart */}
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">
              {styleOptions.find((s) => s.templateId === selectedTemplateId)?.name}
              {(colorFilter || sizeFilter) && <span className="text-zinc-500"> - {[colorFilter, sizeFilter].filter(Boolean).join(" / ")}</span>}
            </h2>
            {backtestMape != null && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                Backtest (3mo): {backtestMape.toFixed(0)}% MAPE
              </span>
            )}
          </div>

          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="mt-2 h-auto w-full" role="img" aria-label="Net units sold, forecast, and PO lead-time zones">
            {/* Zone shading */}
            <rect x={zone1.x} y={PAD_T} width={zone1.width} height={plotH} className="fill-blue-200/30 dark:fill-blue-500/10" />
            <rect x={zone2.x} y={PAD_T} width={zone2.width} height={plotH} className="fill-emerald-200/30 dark:fill-emerald-500/10" />

            {/* Y gridlines */}
            {Array.from({ length: 5 }, (_, i) => step * (i + 1)).map((t) => (
              <g key={t}>
                <line x1={PAD_L} x2={CHART_W - PAD_R} y1={yFor(t)} y2={yFor(t)} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeWidth={1} />
                <text x={PAD_L - 6} y={yFor(t) + 3} textAnchor="end" className="fill-zinc-400 text-[9px]">{unitFormatter.format(t)}</text>
              </g>
            ))}

            {/* Forecast band + expected line */}
            <path d={bandPath(bandTop, bandBottom)} className="fill-zinc-300/40 dark:fill-zinc-600/30" />
            <path d={linePath(expectedLine)} fill="none" strokeDasharray="4 3" stroke="currentColor" className="text-zinc-800 dark:text-zinc-200" strokeWidth={2} />

            {/* Actual history line */}
            <path d={linePath(actualLinePoints)} fill="none" stroke="currentColor" className="text-zinc-800 dark:text-zinc-200" strokeWidth={2} />
            {historyShown.map((p, i) => (
              <circle key={p.date} cx={xFor(i)} cy={yFor(p.value)} r={3} className="fill-zinc-800 dark:fill-zinc-200">
                <title>
                  {monthLabelFormatter.format(new Date(`${p.date}T00:00:00Z`))}: {unitFormatter.format(p.value)} units
                  {p.adjusted ? " (adjusted for stockouts)" : ""}
                  {stockoutDaysByMonth.get(p.date) ? `, ${stockoutDaysByMonth.get(p.date)} stockout day(s)` : ""}
                </title>
              </circle>
            ))}

            {/* MTD + projected current-month points - drawn distinctly, never as a full-month actual */}
            <circle cx={xFor(mtdIdx)} cy={yFor(mtd.mtdUnits)} r={3} className="fill-blue-600">
              <title>Month-to-date: {unitFormatter.format(mtd.mtdUnits)} units over {mtd.daysElapsed} of {mtd.daysInMonth} days.</title>
            </circle>
            <circle cx={xFor(projIdx)} cy={yFor(mtd.projectedFullMonthUnits)} r={3} className="fill-blue-600" strokeDasharray="2 2" stroke="currentColor">
              <title>Projected full month (run-rate): {unitFormatter.format(mtd.projectedFullMonthUnits)} units.</title>
            </circle>

            {/* Forecast points */}
            {upliftedForecast.map((f, i) => (
              <circle key={f.date} cx={xFor(forecastStartIdx + i)} cy={yFor(f.expected)} r={3} className="fill-zinc-500">
                <title>
                  {monthLabelFormatter.format(new Date(`${f.date}T00:00:00Z`))} forecast: {unitFormatter.format(f.expected)} ({unitFormatter.format(f.low)}-{unitFormatter.format(f.high)})
                  {f.upliftMultiplier !== 1 ? `, uplift x${f.upliftMultiplier.toFixed(2)}` : ""}
                </title>
              </circle>
            ))}

            {/* Same month last year overlay */}
            {yoyOverlay && xPoints.map((p, i) => {
              const v = yoyByMonth.get(p.monthIso);
              if (v === undefined || p.kind !== "history") return null;
              return (
                <circle key={`yoy-${p.key}`} cx={xFor(i)} cy={yFor(v)} r={2.5} className="fill-none stroke-amber-500" strokeWidth={1.5}>
                  <title>Same month last year: {unitFormatter.format(v)} units.</title>
                </circle>
              );
            })}

            {/* Event markers */}
            {events.map((e) => {
              const idx = monthIndexFor(e.eventDate);
              return (
                <text key={e.eventDate + e.label} x={xFor(idx)} y={PAD_T - 4} textAnchor="middle" className="fill-violet-600 text-[10px] dark:fill-violet-400">
                  ★<title>{e.label}{e.note ? ` - ${e.note}` : ""} ({e.eventDate})</title>
                </text>
              );
            })}

            {/* Projected stockout marker */}
            {projectedStockoutMonthIdx !== null && plannerCalc.projectedStockoutInDays != null && (
              <line x1={xFor(projectedStockoutMonthIdx)} x2={xFor(projectedStockoutMonthIdx)} y1={PAD_T} y2={PAD_T + plotH} stroke="currentColor" className="text-red-500" strokeWidth={1.5} strokeDasharray="3 2">
                <title>Projected stockout in {plannerCalc.projectedStockoutInDays} day(s) if no PO lands first.</title>
              </line>
            )}

            {/* X labels */}
            {xPoints.map((p, i) => (
              <text key={p.key} x={xFor(i)} y={CHART_H - PAD_B + 15} textAnchor="middle" className="fill-zinc-400 text-[8px]">
                {p.label}
              </text>
            ))}
          </svg>

          <p className="mt-1 flex flex-wrap gap-3 text-[10px] text-zinc-400">
            <span><span className="inline-block h-2 w-3 bg-blue-200/60 dark:bg-blue-500/20" /> PO-today arrival window ({leadTimeResolution.minDays}-{leadTimeResolution.maxDays}d)</span>
            <span><span className="inline-block h-2 w-3 bg-emerald-200/60 dark:bg-emerald-500/20" /> Coverage window after arrival ({coverageMonths}mo)</span>
            <span>★ event/campaign</span>
            <span className="text-red-500">┊ projected stockout</span>
          </p>
        </div>

        {/* Planner panel */}
        <div className="rounded-lg border border-zinc-200 p-4 text-xs dark:border-zinc-800">
          <h2 className="text-sm font-medium">PO planner</h2>
          {!leadTimeProductId && (
            <AssumptionNote>
              Not linked to a lead-time product - open PO qty can&apos;t be
              computed. Link it on{" "}
              <Link href="/forecast/lead-times" className="underline">Lead times</Link>.
            </AssumptionNote>
          )}
          {plannerCalc.alreadyLate && (
            <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 font-medium text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              Already late: projected stock would go negative before a PO placed today could arrive.
            </p>
          )}

          <dl className="mt-3 space-y-1.5">
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

          <h3 className="mt-4 text-sm font-medium">What if I order X?</h3>
          <form className="mt-1 flex items-end gap-2" method="get">
            {Object.entries(params).map(([k, v]) => v && k !== "whatIfQty" ? <input key={k} type="hidden" name={k} value={v} /> : null)}
            <input type="number" name="whatIfQty" min={0} defaultValue={params.whatIfQty ?? ""} placeholder="qty" className="w-24 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
            <button type="submit" className="rounded border border-zinc-300 px-2 py-1 hover:border-zinc-500 dark:border-zinc-700">Simulate</button>
          </form>
          {whatIf && (
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              Stock on landing: <strong>{unitFormatter.format(whatIf.stockAfterLanding)}</strong>.{" "}
              {whatIf.projectedStockoutDate
                ? <>Projected to run out around <strong>{whatIf.projectedStockoutDate}</strong>.</>
                : "Not projected to run out within a year at the current forecast rate."}
            </p>
          )}
        </div>
      </div>

      {/* PO sheet grid */}
      <section className="mt-8 mb-16">
        <h2 className="text-lg font-medium">Suggested PO - colour × size</h2>
        <p className="mt-1 text-[10px] text-zinc-500">
          Suggested qty allocates the style-level total ({unitFormatter.format(plannerCalc.suggestedPoQty)} units) by trailing sales mix - colour over the last 3 months, size over the last 6. A blank cell means no trailing sales to base a share on, not zero demand. Every qty/price cell is editable before exporting.
        </p>
        <form action="/api/forecast/export-po" method="post" className="mt-2">
          <input type="hidden" name="styleName" value={styleOptions.find((s) => s.templateId === selectedTemplateId)?.name ?? ""} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
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
                      {styleOptions.find((s) => s.templateId === selectedTemplateId)?.name}
                    </td>
                    <td className="px-2 py-1">{cell.color ?? "-"}</td>
                    <td className="px-2 py-1">{cell.size ?? "-"}</td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        name={`qty_${i}`}
                        defaultValue={cell.suggestedQty != null ? Math.round(cell.suggestedQty) : ""}
                        className="w-20 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-right dark:border-zinc-700"
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        name={`cmt_${i}`}
                        defaultValue={cell.cmtPriceIdr ?? ""}
                        className="w-28 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-right dark:border-zinc-700"
                      />
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
      </section>
    </div>
  );
}
