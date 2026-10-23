import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { forecast, type Period, type ForecastResult } from "@/lib/forecast/engine";
import { hasForecastSchema, fetchStockLevels, type StockLevelRow } from "@/lib/forecast/data";
import { hasLeadTimeSchema, fetchLeadTimeSettings, fetchEstimatesByProduct, fetchMeasuredDeliveriesByProduct } from "@/lib/leadtime/data";
import { resolveProductLeadTime, type LeadTimeRange, type LeadTimeSettings } from "@/lib/leadtime/resolve";
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
  fetchStockHistory,
  sumStockHistoryByDate,
  matchesScope,
  type StyleOption,
  type StyleVariant,
  type LocationScope,
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
  type CoverStatus,
} from "@/lib/forecast/planner";
import { paletteCss, paletteSlot, paletteVar, type PaletteSlot } from "@/lib/viz/palette";
import { niceStep, linePath, bandPath, type Point } from "@/lib/viz/chart-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SERIES = 4;
const PAST_OPTIONS = [6, 12, 24, 0] as const; // 0 = "all"
const NEXT_OPTIONS = [1, 3, 6] as const;

const unitFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const monthLabelFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" });

function monthStart(date: Date, offsetMonths: number): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offsetMonths, 1));
  return d.toISOString().slice(0, 10);
}
function addDaysIso(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}
/** Next.js gives a repeated form field (e.g. a <select multiple>) as a string[] when there are 2+, but a plain string when there's exactly one - this normalizes both to an array. */
function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
/** Rebuilds a query string from the current params plus overrides, correctly repeating `products` as multiple same-named entries (not comma-joined) so the result round-trips through toArray the same way a real multi-select submission would. */
function buildQuery(params: SearchParams, overrides: Record<string, string | null>): string {
  const next = new URLSearchParams();
  for (const id of toArray(params.products)) next.append("products", id);
  for (const [k, v] of Object.entries(params)) {
    if (k === "products" || !v || Array.isArray(v)) continue;
    next.set(k, v);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  return `/forecast?${next.toString()}`;
}
/** 0 = "all history" (no trimming); otherwise the trailing N months. Centralized because `Array.slice(-0)` is the whole array, not empty - easy to get backwards inline. */
function trimToPast<T>(items: T[], pastMonths: number): T[] {
  return pastMonths === 0 ? items : items.slice(-pastMonths);
}
/** The latest recorded stock snapshot within a given month - `rows` is ascending by date, so this is the last match, not the first (a month's most recent position reads better on a monthly chart than its earliest). */
function stockForMonth(rows: Period[], monthIso: string): number | null {
  let found: number | null = null;
  for (const r of rows) {
    if (r.date.slice(0, 7) === monthIso.slice(0, 7)) found = r.value;
  }
  return found;
}
function endOfMonthIso(monthIso: string): string {
  const d = new Date(`${monthIso}T00:00:00Z`);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return last.toISOString().slice(0, 10);
}
/** Nearest trajectory point at or before the given date - used to sample a daily-stepped stock trajectory onto the chart's monthly x-axis. */
function sampleTrajectory(trajectory: TrajectoryPoint[], dateIso: string): TrajectoryPoint | null {
  let best: TrajectoryPoint | null = null;
  for (const p of trajectory) {
    if (p.date <= dateIso) best = p;
    else break;
  }
  return best ?? trajectory[0] ?? null;
}

function AssumptionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
      {children}
    </p>
  );
}

/** Preserves the current filters as hidden fields on a small sub-form (the planner's "plan for" select, the what-if box) - handles `products` as repeated fields, same as the real multi-select would send. */
function HiddenParams({ params, except }: { params: SearchParams; except: string[] }) {
  return (
    <>
      {!except.includes("products") && toArray(params.products).map((id) => <input key={`products-${id}`} type="hidden" name="products" value={id} />)}
      {Object.entries(params)
        .filter(([k, v]) => k !== "products" && !except.includes(k) && v && !Array.isArray(v))
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v as string} />
        ))}
    </>
  );
}

function HelpIcon({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-zinc-400 text-[9px] leading-none text-zinc-500 dark:border-zinc-600 dark:text-zinc-400"
    >
      ?
    </span>
  );
}

const statusStyles: Record<CoverStatus, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
  low: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
  risk: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400",
};

interface SearchParams {
  products?: string | string[]; // multi-select - the browser sends one repeated key per selection, not a comma-joined value
  splitByStore?: string; // "on"
  store?: string; // tab: "all" | storeId, ignored when splitByStore is on
  past?: string; // 6 | 12 | 24 | 0 (all)
  next?: string; // 1 | 3 | 6
  coverageMonths?: string;
  serviceLevel?: string;
  adjustStockouts?: string;
  yoyOverlay?: string;
  whatIfQty?: string;
  plan?: string; // focus product templateId for the planner card/grid
}

interface SeriesDef {
  key: string;
  label: string;
  color: PaletteSlot;
  templateId: number;
  productIds: number[];
  scope: LocationScope;
  canShowPoStepUps: boolean; // only 'network' and 'office' scopes - a PO doesn't land at a specific store
}

interface SeriesData extends SeriesDef {
  monthlySeries: Period[];
  mtd: MonthToDate;
  forecastResult: ForecastResult;
  upliftedForecast: { date: string; expected: number; low: number; high: number }[];
  leadTimeResolution: LeadTimeRange;
  dailyForecastRate: number;
  currentStock: number;
  stockHistoryByDate: Period[];
  trajectory: TrajectoryPoint[];
  openPoLines: OpenPoLine[];
  displayMonths: { date: string; value: number; adjusted: boolean }[];
  stockoutDaysByMonth: Map<string, number>;
  events: { eventDate: string; label: string; note: string | null }[];
}

export default async function ForecastChartPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
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
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Forecast</h1>
        <AssumptionNote>
          Not shown yet - run <code>supabase/migrations/0023_forecast_inventory.sql</code> and{" "}
          <code>0029_po_planning.sql</code> in the Supabase SQL editor first.
        </AssumptionNote>
      </div>
    );
  }

  const HIDDEN_STORE_NAMES = new Set(["nsa"]);
  const { data: storeRows } = await supabase.from("stores").select("id, name").eq("active", true).order("name");
  const stores = (storeRows ?? []).filter((s) => !HIDDEN_STORE_NAMES.has(s.name.trim().toLowerCase()));

  const styleOptions = await fetchStyleOptions(supabase);
  if (!styleOptions.length) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Forecast</h1>
        <p className="mt-2 text-sm text-zinc-500">No products synced yet - run an Odoo sync on Operations first.</p>
      </div>
    );
  }

  const requestedProductIds = toArray(params.products)
    .map(Number)
    .filter((id) => styleOptions.some((s) => s.templateId === id))
    .slice(0, MAX_SERIES);
  const selectedTemplateIds = requestedProductIds.length ? requestedProductIds : [styleOptions[0].templateId];
  const styleByTemplateId = new Map<number, StyleOption>(styleOptions.map((s) => [s.templateId, s]));

  const splitByStore = params.splitByStore === "on" && selectedTemplateIds.length === 1;
  const storeTab = params.store && params.store !== "all" ? Number(params.store) : null;

  const pastMonthsParam = Number(params.past);
  const pastMonths = PAST_OPTIONS.includes(pastMonthsParam as (typeof PAST_OPTIONS)[number]) ? pastMonthsParam : 12;
  const coverageMonths = Math.max(1, Number(params.coverageMonths) || 2);
  const coverageDays = coverageMonths * 30;
  const serviceLevel = Math.min(0.999, Math.max(0.5, Number(params.serviceLevel) || 0.9));
  const adjustStockouts = params.adjustStockouts === "on";
  const yoyOverlayRequested = params.yoyOverlay === "on";
  const whatIfQty = params.whatIfQty ? Number(params.whatIfQty) : null;

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const currentMonthIso = monthStart(today, 0);
  // Always fetches at least 13 months of history, even if "Past" shows
  // fewer - that's what lets the "same month last year" toggle appear as
  // soon as it's genuinely usable, independent of the display window.
  const historyFrom = pastMonths === 0 ? "2000-01-01" : monthStart(today, -Math.max(pastMonths, 13));

  const leadTimeSettings: LeadTimeSettings = leadTimeSchemaOk
    ? await fetchLeadTimeSettings(supabase)
    : { lateEndBufferPct: 25, globalDefaultMinDays: 42, globalDefaultMaxDays: 56, measuredMinPoCount: 5, firstDeliveryOnly: false };
  const [estimatesByProduct, measuredByProduct] = leadTimeSchemaOk
    ? await Promise.all([fetchEstimatesByProduct(supabase), fetchMeasuredDeliveriesByProduct(supabase, leadTimeSettings.firstDeliveryOnly)])
    : [new Map(), new Map()];

  // --- Build the list of series definitions ---
  const seriesDefs: SeriesDef[] = [];
  if (splitByStore) {
    const templateId = selectedTemplateIds[0];
    seriesDefs.push({
      key: "office",
      label: "Office",
      color: paletteSlot(0),
      templateId,
      productIds: [], // filled below once variants are known
      scope: { kind: "office" },
      canShowPoStepUps: true,
    });
    stores.forEach((s, i) => {
      seriesDefs.push({
        key: `store-${s.id}`,
        label: s.name,
        color: paletteSlot(i + 1),
        templateId,
        productIds: [],
        scope: { kind: "store", storeId: s.id },
        canShowPoStepUps: false,
      });
    });
  } else {
    selectedTemplateIds.forEach((templateId, i) => {
      seriesDefs.push({
        key: `product-${templateId}`,
        label: styleByTemplateId.get(templateId)?.name ?? `#${templateId}`,
        color: paletteSlot(i),
        templateId,
        productIds: [],
        scope: storeTab ? { kind: "store", storeId: storeTab } : { kind: "network" },
        canShowPoStepUps: !storeTab, // a specific store tab isn't where a PO lands either
      });
    });
  }

  const variantsByTemplate = new Map<number, StyleVariant[]>();
  for (const templateId of new Set(seriesDefs.map((d) => d.templateId))) {
    variantsByTemplate.set(templateId, await fetchStyleVariants(supabase, templateId));
  }
  for (const def of seriesDefs) def.productIds = (variantsByTemplate.get(def.templateId) ?? []).map((v) => v.productId);

  const leadTimeProductIdByTemplate = new Map<number, number | null>();
  const leadTimeResolutionByTemplate = new Map<number, LeadTimeRange>();
  const openPoLinesByTemplate = new Map<number, OpenPoLine[]>();
  for (const templateId of new Set(seriesDefs.map((d) => d.templateId))) {
    const leadTimeProductId = leadTimeSchemaOk ? await fetchLinkedLeadTimeProductId(supabase, templateId) : null;
    leadTimeProductIdByTemplate.set(templateId, leadTimeProductId);

    const resolution: LeadTimeRange = leadTimeProductId
      ? resolveProductLeadTime(estimatesByProduct.get(leadTimeProductId) ?? [], measuredByProduct.get(leadTimeProductId) ?? [], leadTimeSettings)
      : {
          minDays: leadTimeSettings.globalDefaultMinDays,
          maxDays: leadTimeSettings.globalDefaultMaxDays,
          tier: "default",
          usedFallback: true,
          detail: "Not linked to a lead-time product yet (link it on the Lead Times page) - using the global default range.",
        };
    leadTimeResolutionByTemplate.set(templateId, resolution);
    openPoLinesByTemplate.set(templateId, leadTimeProductId ? await fetchOpenPoLines(supabase, leadTimeProductId, resolution) : []);
  }

  const nextMonthsParam = Number(params.next);
  const maxLateDays = Math.max(...Array.from(leadTimeResolutionByTemplate.values()).map((r) => r.maxDays));
  const computedN = Math.max(1, Math.ceil((maxLateDays + coverageDays) / 30));
  const nextMonthsDefault = NEXT_OPTIONS.find((v) => v >= computedN) ?? NEXT_OPTIONS[NEXT_OPTIONS.length - 1];
  const nextMonths = NEXT_OPTIONS.includes(nextMonthsParam as (typeof NEXT_OPTIONS)[number]) ? nextMonthsParam : nextMonthsDefault;
  const forecastHorizonMonths = Math.max(nextMonths, computedN);

  const upliftFactorsByTemplate = new Map<number, Awaited<ReturnType<typeof fetchUpliftFactors>>>();
  const eventsByTemplate = new Map<number, Awaited<ReturnType<typeof fetchForecastEvents>>>();
  for (const templateId of new Set(seriesDefs.map((d) => d.templateId))) {
    upliftFactorsByTemplate.set(templateId, poPlanningSchemaOk ? await fetchUpliftFactors(supabase, templateId) : []);
    eventsByTemplate.set(
      templateId,
      poPlanningSchemaOk
        ? await fetchForecastEvents(supabase, templateId, historyFrom, addDaysIso(currentMonthIso, 31 * (forecastHorizonMonths + 1)))
        : [],
    );
  }

  const stockLevelsResult = await fetchStockLevels(supabase);
  const allStockHistoryByTemplate = new Map<number, Awaited<ReturnType<typeof fetchStockHistory>>>();
  for (const templateId of new Set(seriesDefs.map((d) => d.templateId))) {
    const productIds = variantsByTemplate.get(templateId)!.map((v) => v.productId);
    allStockHistoryByTemplate.set(templateId, await fetchStockHistory(supabase, productIds, historyFrom, currentMonthIso));
  }

  const horizonDays = forecastHorizonMonths * 30;

  const series: SeriesData[] = [];
  for (const def of seriesDefs) {
    const storeIdsForSales = def.scope.kind === "store" ? [def.scope.storeId] : null;

    const monthlySeries = await fetchStyleMonthlyNetUnits(supabase, def.productIds, storeIdsForSales, historyFrom, currentMonthIso);
    const dailyThisMonth = await fetchStyleDailyNetUnits(supabase, def.productIds, storeIdsForSales, currentMonthIso, addDaysIso(todayIso, 1));
    const mtd = computeMonthToDate(dailyThisMonth, today);

    const forecastResult = forecast(monthlySeries, { horizon: forecastHorizonMonths });
    const upliftFactors = upliftFactorsByTemplate.get(def.templateId) ?? [];
    const upliftedForecast = forecastResult.forecast.map((f) => {
      const totalFraction = upliftFactors.reduce((sum, factor) => sum + upliftOverlapFraction(f.date, factor) * (factor.upliftPct / 100), 0);
      const multiplier = 1 + totalFraction;
      return { date: f.date, expected: f.expected * multiplier, low: f.low * multiplier, high: f.high * multiplier };
    });

    const { stockoutDays, earliestHistoryDate } = poPlanningSchemaOk
      ? await fetchStockoutDays(supabase, def.productIds, historyFrom, currentMonthIso)
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

    const currentStock = stockLevelsResult.rows
      .filter((r: StockLevelRow) => def.productIds.includes(r.productId) && matchesScope(r, def.scope))
      .reduce((sum, r) => sum + r.qty, 0);

    const stockHistoryByDate = sumStockHistoryByDate(allStockHistoryByTemplate.get(def.templateId) ?? [], def.scope);

    const leadTimeResolution = leadTimeResolutionByTemplate.get(def.templateId)!;
    const dailyForecastRate = (upliftedForecast[0]?.expected ?? 0) / 30;
    const openPoLines = def.canShowPoStepUps ? openPoLinesByTemplate.get(def.templateId) ?? [] : [];
    const trajectory = projectStockTrajectory(currentStock, dailyForecastRate, openPoLines, todayIso, horizonDays);

    series.push({
      ...def,
      monthlySeries,
      mtd,
      forecastResult,
      upliftedForecast,
      leadTimeResolution,
      dailyForecastRate,
      currentStock,
      stockHistoryByDate,
      trajectory,
      openPoLines,
      displayMonths,
      stockoutDaysByMonth,
      events: eventsByTemplate.get(def.templateId) ?? [],
    });
  }

  const hasYoyHistory = series.every((s) => s.monthlySeries.length >= 13);
  const yoyOverlay = yoyOverlayRequested && hasYoyHistory;

  // --- Backtest badges (last 3 months, per series) ---
  const backtestMapeBySeries = new Map<string, number | null>();
  for (const s of series) {
    const points: number[] = [];
    const start = Math.max(1, s.monthlySeries.length - 3);
    for (let i = start; i < s.monthlySeries.length; i++) {
      const train = s.monthlySeries.slice(0, i);
      const actual = s.monthlySeries[i].value;
      if (actual === 0) continue;
      const predicted = forecast(train, { horizon: 1 }).forecast[0]?.expected ?? 0;
      points.push(Math.abs(predicted - actual) / Math.abs(actual));
    }
    backtestMapeBySeries.set(s.key, points.length ? (points.reduce((a, b) => a + b, 0) / points.length) * 100 : null);
  }

  // --- Shared x-axis across both charts: history months (trimmed to `pastMonths`, minus current) + MTD + projected + forecast months ---
  const reference = series[0];
  const trimmedHistory = trimToPast(reference.displayMonths, pastMonths);
  type XPoint = { key: string; label: string; kind: "history" | "mtd" | "projected" | "forecast"; monthIso: string };
  const xPoints: XPoint[] = [
    ...trimmedHistory.map((p) => ({ key: p.date, label: monthLabelFormatter.format(new Date(`${p.date}T00:00:00Z`)), kind: "history" as const, monthIso: p.date })),
    { key: `${currentMonthIso}-mtd`, label: "MTD", kind: "mtd" as const, monthIso: currentMonthIso },
    { key: `${currentMonthIso}-proj`, label: "Proj.", kind: "projected" as const, monthIso: currentMonthIso },
    ...reference.upliftedForecast.slice(0, nextMonths).map((f) => ({ key: f.date, label: monthLabelFormatter.format(new Date(`${f.date}T00:00:00Z`)), kind: "forecast" as const, monthIso: f.date })),
  ];
  const todayIdx = trimmedHistory.length; // the MTD slot - where "Today" sits
  const projIdx = todayIdx + 1;
  const forecastStartIdx = todayIdx + 2;

  const monthIndexFor = (iso: string): number => {
    const target = iso.slice(0, 7);
    const idx = xPoints.findIndex((p) => p.monthIso.slice(0, 7) === target);
    return idx === -1 ? xPoints.length - 1 : idx;
  };

  const CHART_W = 460;
  const CHART_H = 260;
  const PAD_L = 48;
  const PAD_R = 8;
  const PAD_T = 24;
  const PAD_B = 24;
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;
  const xFor = (i: number) => PAD_L + (xPoints.length <= 1 ? 0 : (i / (xPoints.length - 1)) * plotW);

  const maxUnits = Math.max(
    1,
    ...series.flatMap((s) => trimToPast(s.displayMonths, pastMonths).map((p) => p.value)),
    ...series.map((s) => s.mtd.projectedFullMonthUnits),
    ...series.flatMap((s) => s.upliftedForecast.slice(0, nextMonths).map((f) => f.high)),
  );
  const unitsStep = niceStep(maxUnits / 4);
  const unitsYMax = unitsStep * 5;
  const unitsYFor = (v: number) => PAD_T + plotH - (Math.min(v, unitsYMax) / unitsYMax) * plotH;

  const maxStock = Math.max(
    1,
    ...series.map((s) => s.currentStock),
    ...series.flatMap((s) => s.trajectory.map((p) => p.high)),
  );
  const stockStep = niceStep(maxStock / 4);
  const stockYMax = stockStep * 5;
  const stockYFor = (v: number) => PAD_T + plotH - (Math.min(v, stockYMax) / stockYMax) * plotH;

  // --- Zones (from the first series' lead time - zones are shown once, not per-series, to stay legible) ---
  const zoneLeadTime = reference.leadTimeResolution;
  const arrivalDateLate = addDaysIso(todayIso, zoneLeadTime.maxDays);
  const zone1StartIdx = monthIndexFor(addDaysIso(todayIso, zoneLeadTime.minDays));
  const zone1EndIdx = monthIndexFor(arrivalDateLate);
  const zone2EndIdx = monthIndexFor(addDaysIso(arrivalDateLate, coverageDays));
  const zoneX = (startIdx: number, endIdx: number) => {
    const x0 = xFor(Math.max(0, startIdx) - 0.4);
    const x1 = xFor(Math.min(xPoints.length - 1, endIdx) + 0.4);
    return { x: Math.min(x0, x1), width: Math.abs(x1 - x0) };
  };
  const zone1 = zoneX(zone1StartIdx, zone1EndIdx);
  const zone2 = zoneX(zone1EndIdx, zone2EndIdx);

  // --- Focus product for the planner card + grid ---
  const planTemplateId = params.plan && selectedTemplateIds.includes(Number(params.plan)) ? Number(params.plan) : selectedTemplateIds[0];
  const planVariants = variantsByTemplate.get(planTemplateId) ?? (await fetchStyleVariants(supabase, planTemplateId));
  const planLeadTimeResolution = leadTimeResolutionByTemplate.get(planTemplateId)!;
  const planLeadTimeProductId = leadTimeProductIdByTemplate.get(planTemplateId) ?? null;
  const planOpenPoLines = openPoLinesByTemplate.get(planTemplateId) ?? [];

  // Planner is always full-network (office + every store), independent of the charts' store tab / split-by-store display.
  const planProductIds = planVariants.map((v) => v.productId);
  let planStockOffice = 0;
  let planStockStores = 0;
  for (const r of stockLevelsResult.rows) {
    if (!planProductIds.includes(r.productId)) continue;
    if (r.kind === "office") planStockOffice += r.qty;
    else planStockStores += r.qty;
  }
  const planMonthlySeries = await fetchStyleMonthlyNetUnits(supabase, planProductIds, null, historyFrom, currentMonthIso);
  const planForecast = forecast(planMonthlySeries, { horizon: 1 });
  const planDailyForecastRate = (planForecast.forecast[0]?.expected ?? 0) / 30;
  const planDailyForecastStdDev = planForecast.residualStdDev / Math.sqrt(30);

  const openPoBeforeArrival = planOpenPoLines
    .filter((l) => l.resolvedEtaLatest <= addDaysIso(todayIso, planLeadTimeResolution.maxDays))
    .reduce((sum, l) => sum + l.qtyOpen, 0);

  const plannerCalc = computePlanner({
    currentStockOffice: planStockOffice,
    currentStockStores: planStockStores,
    openPoBeforeArrival,
    dailyForecastRate: planDailyForecastRate,
    dailyForecastStdDev: planDailyForecastStdDev,
    daysUntilArrival: planLeadTimeResolution.maxDays,
    coverageDays,
    targetServiceLevel: serviceLevel,
  });
  const whatIf = whatIfQty != null ? computeWhatIf(whatIfQty, plannerCalc, planDailyForecastRate, addDaysIso(todayIso, planLeadTimeResolution.maxDays)) : null;

  const planAllocationShares = await fetchAllocationShares(supabase, planVariants, today.toISOString());
  const grid = await buildPoGrid(supabase, planVariants, plannerCalc.suggestedPoQty, planAllocationShares, planLeadTimeProductId);

  const paletteKeys = series.map((s) => s.key);

  const toggleParam = (key: string, value: string) => buildQuery(params, { [key]: value });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <style dangerouslySetInnerHTML={{ __html: paletteCss("fc-chart", paletteKeys) }} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Forecast</h1>
        <div className="flex items-center gap-3 text-xs">
          <Link href="/forecast/overview" className="text-zinc-500 hover:underline">Forecasting overview →</Link>
          <Link href="/forecast/lead-times" className="text-zinc-500 hover:underline">Lead times →</Link>
        </div>
      </div>

      {/* Store tabs */}
      {!splitByStore && (
        <div className="mt-4 flex gap-4 border-b border-zinc-200 text-sm dark:border-zinc-800">
          <Link href={toggleParam("store", "all")} className={`-mb-px border-b-2 px-1 pb-2 ${!storeTab ? "border-zinc-800 font-medium dark:border-zinc-200" : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
            All stores
          </Link>
          {stores.map((s) => (
            <Link key={s.id} href={toggleParam("store", String(s.id))} className={`-mb-px border-b-2 px-1 pb-2 ${storeTab === s.id ? "border-zinc-800 font-medium dark:border-zinc-200" : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
              {s.name}
            </Link>
          ))}
        </div>
      )}

      {!leadTimeSchemaOk && (
        <AssumptionNote>
          Lead-time data isn&apos;t available yet - run <code>supabase/migrations/0027_lead_times.sql</code>,{" "}
          <code>0028_seed_purchase_orders.sql</code>, and <code>0029_po_planning.sql</code>. Using the global default lead time (42-56 days) until then.
        </AssumptionNote>
      )}
      {!poPlanningSchemaOk && (
        <AssumptionNote>
          Uplift factors, events, and stockout/stock-history tracking aren&apos;t available yet - run{" "}
          <code>supabase/migrations/0029_po_planning.sql</code>. Charts still work without them.
        </AssumptionNote>
      )}
      {series.some((s) => !s.canShowPoStepUps) && (
        <AssumptionNote>
          Open purchase orders land at the office, not at a specific store -
          the stock chart for a single-store view (or store-split mode)
          shows demand draw-down only, with no PO step-up. Switch to
          &quot;All stores&quot; (or the Office series) to see incoming POs.
        </AssumptionNote>
      )}

      {/* Filters */}
      <form className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 text-xs dark:border-zinc-800" method="get">
        {/* store/plan/whatIfQty aren't fields in this form - preserve them so "Apply" doesn't silently reset the tab, the planner's focus product, or an in-progress what-if. */}
        <HiddenParams params={params} except={["products", "splitByStore", "past", "next", "coverageMonths", "serviceLevel", "adjustStockouts", "yoyOverlay"]} />
        <label className="flex flex-col gap-1">
          Products (up to {MAX_SERIES}, overlaid)
          <select name="products" multiple size={Math.min(5, styleOptions.length)} defaultValue={selectedTemplateIds.map(String)} className="w-56 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            {styleOptions.map((s) => (
              <option key={s.templateId} value={s.templateId}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1">
          <input type="checkbox" name="splitByStore" defaultChecked={splitByStore} /> Split one product by store (ignores the tabs above)
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

      {/* Two charts side by side, sharing the x-axis */}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            Units sold per month <HelpIcon text="Solid line = actual net units sold (sales minus returns). The current month shows month-to-date (filled dot) and a projected full month (hollow dot) separately - never plotted as a completed month. Dashed line + band = forecast low/expected/high." />
          </h2>
          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="mt-2 h-auto w-full" role="img" aria-label="Units sold per month, actual and forecast">
            <rect x={zone1.x} y={PAD_T} width={zone1.width} height={plotH} className="fill-blue-200/25 dark:fill-blue-500/10" />
            <rect x={zone2.x} y={PAD_T} width={zone2.width} height={plotH} className="fill-emerald-200/25 dark:fill-emerald-500/10" />
            {Array.from({ length: 5 }, (_, i) => unitsStep * (i + 1)).map((t) => (
              <g key={t}>
                <line x1={PAD_L} x2={CHART_W - PAD_R} y1={unitsYFor(t)} y2={unitsYFor(t)} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeWidth={1} />
                <text x={PAD_L - 5} y={unitsYFor(t) + 3} textAnchor="end" className="fill-zinc-400 text-[8px]">{unitFormatter.format(t)}</text>
              </g>
            ))}
            <line x1={xFor(todayIdx)} x2={xFor(todayIdx)} y1={PAD_T} y2={PAD_T + plotH} stroke="currentColor" className="text-zinc-400 dark:text-zinc-600" strokeWidth={1} strokeDasharray="2 2" />
            <text x={xFor(todayIdx)} y={PAD_T - 8} textAnchor="middle" className="fill-zinc-500 text-[8px]">Today</text>

            {series.map((s) => {
              const historyShown = trimToPast(s.displayMonths, pastMonths);
              const actualPts: Point[] = historyShown.map((p, i) => ({ x: xFor(i), y: unitsYFor(p.value) }));
              const expectedLine: Point[] = [
                { x: xFor(projIdx), y: unitsYFor(s.mtd.projectedFullMonthUnits) },
                ...s.upliftedForecast.slice(0, nextMonths).map((f, i) => ({ x: xFor(forecastStartIdx + i), y: unitsYFor(f.expected) })),
              ];
              const bandTop: Point[] = [
                { x: xFor(projIdx), y: unitsYFor(s.mtd.projectedFullMonthUnits) },
                ...s.upliftedForecast.slice(0, nextMonths).map((f, i) => ({ x: xFor(forecastStartIdx + i), y: unitsYFor(f.high) })),
              ];
              const bandBottom: Point[] = [
                { x: xFor(projIdx), y: unitsYFor(s.mtd.projectedFullMonthUnits) },
                ...s.upliftedForecast.slice(0, nextMonths).map((f, i) => ({ x: xFor(forecastStartIdx + i), y: unitsYFor(f.low) })),
              ];
              const color = paletteVar(s.key);
              const yoyByMonth = new Map<string, number>();
              if (yoyOverlay) {
                for (const p of s.monthlySeries) {
                  const d = new Date(`${p.date}T00:00:00Z`);
                  const nextYear = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), 1)).toISOString().slice(0, 10);
                  yoyByMonth.set(nextYear, p.value);
                }
              }
              return (
                <g key={s.key}>
                  <path d={bandPath(bandTop, bandBottom)} fill={color} opacity={0.15} />
                  <path d={linePath(actualPts)} fill="none" stroke={color} strokeWidth={2} />
                  <path d={linePath(expectedLine)} fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 3" />
                  {historyShown.map((p, i) => (
                    <circle key={p.date} cx={xFor(i)} cy={unitsYFor(p.value)} r={2.5} fill={color}>
                      <title>
                        {s.label} - {monthLabelFormatter.format(new Date(`${p.date}T00:00:00Z`))}: {unitFormatter.format(p.value)} units{p.adjusted ? " (adjusted for stockouts)" : ""}
                        {s.stockoutDaysByMonth.get(p.date) ? `, ${s.stockoutDaysByMonth.get(p.date)} stockout day(s)` : ""}
                      </title>
                    </circle>
                  ))}
                  {yoyOverlay && historyShown.map((p, i) => {
                    const v = yoyByMonth.get(p.date);
                    if (v === undefined) return null;
                    return (
                      <circle key={`yoy-${p.date}`} cx={xFor(i)} cy={unitsYFor(v)} r={2} fill="none" stroke={color} strokeWidth={1} strokeDasharray="1 1">
                        <title>{s.label} - same month last year: {unitFormatter.format(v)} units.</title>
                      </circle>
                    );
                  })}
                  <circle cx={xFor(todayIdx)} cy={unitsYFor(s.mtd.mtdUnits)} r={2.5} fill={color}>
                    <title>{s.label} - month to date: {unitFormatter.format(s.mtd.mtdUnits)} units over {s.mtd.daysElapsed}/{s.mtd.daysInMonth} days.</title>
                  </circle>
                  <circle cx={xFor(projIdx)} cy={unitsYFor(s.mtd.projectedFullMonthUnits)} r={2.5} fill="white" stroke={color} strokeWidth={1.5}>
                    <title>{s.label} - projected full month: {unitFormatter.format(s.mtd.projectedFullMonthUnits)} units.</title>
                  </circle>
                  {s.upliftedForecast.slice(0, nextMonths).map((f, i) => (
                    <circle key={f.date} cx={xFor(forecastStartIdx + i)} cy={unitsYFor(f.expected)} r={2.5} fill={color}>
                      <title>{s.label} - {monthLabelFormatter.format(new Date(`${f.date}T00:00:00Z`))} forecast: {unitFormatter.format(f.expected)} ({unitFormatter.format(f.low)}-{unitFormatter.format(f.high)})</title>
                    </circle>
                  ))}
                  {historyShown.map((p, i) =>
                    s.stockoutDaysByMonth.get(p.date) ? (
                      <rect key={`stockout-${p.date}`} x={xFor(i) - 2} y={PAD_T + plotH + 2} width={4} height={4} fill={color}>
                        <title>{s.label} - {s.stockoutDaysByMonth.get(p.date)} stockout day(s) in {monthLabelFormatter.format(new Date(`${p.date}T00:00:00Z`))}.</title>
                      </rect>
                    ) : null,
                  )}
                  {s.events.map((e) => {
                    const idx = monthIndexFor(e.eventDate);
                    return (
                      <text key={e.eventDate + e.label} x={xFor(idx)} y={PAD_T - 16} textAnchor="middle" fill={color} className="text-[9px]">
                        ★<title>{s.label} - {e.label}{e.note ? ` - ${e.note}` : ""} ({e.eventDate})</title>
                      </text>
                    );
                  })}
                </g>
              );
            })}
            {xPoints.map((p, i) => (
              <text key={p.key} x={xFor(i)} y={CHART_H - PAD_B + 13} textAnchor="middle" className="fill-zinc-400 text-[8px]">{p.label}</text>
            ))}
          </svg>
          <p className="mt-1 text-[9px] text-zinc-400">■ below the axis = a stockout day occurred that month. ★ = event/campaign.</p>
        </div>

        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            Stock on hand <HelpIcon text="Solid line = recorded stock history (only available from whenever the stock sync first ran). Dashed = projected (current stock minus forecasted demand, plus open POs stepping up at their resolved ETA, shown as a small band for the ETA's own min..max range). Red line = the safety-stock level." />
          </h2>
          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="mt-2 h-auto w-full" role="img" aria-label="Projected stock on hand">
            <rect x={zone1.x} y={PAD_T} width={zone1.width} height={plotH} className="fill-blue-200/25 dark:fill-blue-500/10" />
            <rect x={zone2.x} y={PAD_T} width={zone2.width} height={plotH} className="fill-emerald-200/25 dark:fill-emerald-500/10" />
            {Array.from({ length: 5 }, (_, i) => stockStep * (i + 1)).map((t) => (
              <g key={t}>
                <line x1={PAD_L} x2={CHART_W - PAD_R} y1={stockYFor(t)} y2={stockYFor(t)} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeWidth={1} />
                <text x={PAD_L - 5} y={stockYFor(t) + 3} textAnchor="end" className="fill-zinc-400 text-[8px]">{unitFormatter.format(t)}</text>
              </g>
            ))}
            <line x1={xFor(todayIdx)} x2={xFor(todayIdx)} y1={PAD_T} y2={PAD_T + plotH} stroke="currentColor" className="text-zinc-400 dark:text-zinc-600" strokeWidth={1} strokeDasharray="2 2" />
            <text x={xFor(todayIdx)} y={PAD_T - 8} textAnchor="middle" className="fill-zinc-500 text-[8px]">Today</text>

            {series.map((s) => {
              const color = paletteVar(s.key);
              const historySlots = trimmedHistory.map((p) => p.date);
              const historyPts: (Point | null)[] = historySlots.map((date, i) => {
                const v = stockForMonth(s.stockHistoryByDate, date);
                return v !== null ? { x: xFor(i), y: stockYFor(v) } : null;
              });
              const knownHistoryPts = historyPts.filter((p): p is Point => p !== null);

              const projDates = [currentMonthIso, ...xPoints.slice(forecastStartIdx).map((p) => p.monthIso)].map((m) => endOfMonthIso(m));
              const projPts: Point[] = [todayIso, ...projDates].map((dateIso, i) => {
                const sample = sampleTrajectory(s.trajectory, dateIso);
                const idx = i === 0 ? projIdx : forecastStartIdx + i - 1;
                return { x: xFor(idx), y: stockYFor(sample?.low ?? s.currentStock) };
              });
              const projPtsHigh: Point[] = [todayIso, ...projDates].map((dateIso, i) => {
                const sample = sampleTrajectory(s.trajectory, dateIso);
                const idx = i === 0 ? projIdx : forecastStartIdx + i - 1;
                return { x: xFor(idx), y: stockYFor(sample?.high ?? s.currentStock) };
              });

              // The red safety-stock line and "order by" marker come from
              // the planner card's own numbers (one product, full
              // network) - only drawn for whichever series is that same
              // product, so they don't claim to apply to a different
              // product/store overlaid in the same chart.
              const isPlanSeries = s.templateId === planTemplateId;
              const orderBy = isPlanSeries
                ? computeOrderByDate(s.trajectory, plannerCalc.safetyStock, s.leadTimeResolution.maxDays, todayIso)
                : null;

              return (
                <g key={s.key}>
                  {knownHistoryPts.length > 1 && <path d={linePath(knownHistoryPts)} fill="none" stroke={color} strokeWidth={2} />}
                  {knownHistoryPts.map((p, i) => {
                    const date = historySlots[i];
                    if (!p) return null;
                    return (
                      <circle key={date} cx={p.x} cy={p.y} r={2.5} fill={color}>
                        <title>{s.label} - {monthLabelFormatter.format(new Date(`${date}T00:00:00Z`))}: {unitFormatter.format(stockForMonth(s.stockHistoryByDate, date) ?? 0)} on hand.</title>
                      </circle>
                    );
                  })}
                  <path d={bandPath(projPtsHigh, projPts)} fill={color} opacity={0.15} />
                  <path d={linePath(projPts)} fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 3" />
                  <circle cx={xFor(projIdx)} cy={stockYFor(s.currentStock)} r={2.5} fill={color}>
                    <title>{s.label} - current stock: {unitFormatter.format(s.currentStock)}.</title>
                  </circle>
                  {isPlanSeries && (
                    <>
                      <line x1={PAD_L} x2={CHART_W - PAD_R} y1={stockYFor(plannerCalc.safetyStock)} y2={stockYFor(plannerCalc.safetyStock)} stroke="currentColor" className="text-red-500" strokeWidth={1.5}>
                        <title>Safety stock level: {unitFormatter.format(plannerCalc.safetyStock)} units.</title>
                      </line>
                      {orderBy?.crossesSafetyStockDate && (
                        <line
                          x1={xFor(monthIndexFor(orderBy.crossesSafetyStockDate))}
                          x2={xFor(monthIndexFor(orderBy.crossesSafetyStockDate))}
                          y1={PAD_T}
                          y2={PAD_T + plotH}
                          stroke="currentColor"
                          className={orderBy.alreadyLate ? "text-red-600" : "text-amber-500"}
                          strokeWidth={1.5}
                          strokeDasharray="3 2"
                        >
                          <title>
                            {orderBy.alreadyLate ? "Already late - " : ""}Order by {orderBy.orderByDate} to land before stock reaches the safety-stock level (around {orderBy.crossesSafetyStockDate}).
                          </title>
                        </line>
                      )}
                    </>
                  )}
                </g>
              );
            })}
            {xPoints.map((p, i) => (
              <text key={p.key} x={xFor(i)} y={CHART_H - PAD_B + 13} textAnchor="middle" className="fill-zinc-400 text-[8px]">{p.label}</text>
            ))}
          </svg>
          {(() => {
            const planSeries = series.find((s) => s.templateId === planTemplateId);
            if (!planSeries) return null;
            const orderBy = computeOrderByDate(planSeries.trajectory, plannerCalc.safetyStock, planSeries.leadTimeResolution.maxDays, todayIso);
            if (!orderBy.crossesSafetyStockDate) {
              return <p className="mt-1 text-[10px] text-zinc-400">Not projected to reach the safety-stock level within this horizon.</p>;
            }
            return (
              <p className={`mt-1 text-[10px] ${orderBy.alreadyLate ? "font-medium text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                {orderBy.alreadyLate ? "Already late - " : ""}Order by <strong>{orderBy.orderByDate}</strong> to land before stock reaches the safety-stock level (~{orderBy.crossesSafetyStockDate}).
              </p>
            );
          })()}
        </div>
      </div>

      {/* Legend with status badges */}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
        {series.map((s) => {
          const cover = coverStatus(s.currentStock, s.dailyForecastRate, s.leadTimeResolution.maxDays, coverageDays);
          const mape = backtestMapeBySeries.get(s.key);
          return (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: paletteVar(s.key) }} />
              <span className="font-medium">{s.label}</span>
              <span className="text-zinc-500">· {unitFormatter.format(s.currentStock)} pcs</span>
              <span className="text-zinc-500">
                · {cover.weeksOfCover != null ? `${cover.weeksOfCover.toFixed(1)} weeks of cover` : "no forecast yet"}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusStyles[cover.status]}`}>{cover.status}</span>
              {mape != null && <span className="text-[10px] text-zinc-400">backtest (3mo): {mape.toFixed(0)}% MAPE</span>}
            </div>
          );
        })}
      </div>
      <p className="mt-1 flex flex-wrap gap-3 text-[10px] text-zinc-400">
        <span><span className="inline-block h-2 w-3 bg-blue-200/60 dark:bg-blue-500/20" /> PO-today arrival window ({zoneLeadTime.minDays}-{zoneLeadTime.maxDays}d)</span>
        <span><span className="inline-block h-2 w-3 bg-emerald-200/60 dark:bg-emerald-500/20" /> Coverage window after arrival ({coverageMonths}mo)</span>
      </p>

      {/* PO planner card */}
      <section className="mt-8 rounded-lg border border-zinc-200 p-4 text-xs dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">PO planner - {styleByTemplateId.get(planTemplateId)?.name}</h2>
          {selectedTemplateIds.length > 1 && (
            <form method="get" className="flex items-center gap-2">
              <HiddenParams params={params} except={["plan"]} />
              <label className="flex items-center gap-1 text-zinc-500">
                Plan for:
                <select name="plan" defaultValue={planTemplateId} className="rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 dark:border-zinc-700">
                  {selectedTemplateIds.map((id) => <option key={id} value={id}>{styleByTemplateId.get(id)?.name}</option>)}
                </select>
              </label>
              <button type="submit" className="rounded border border-zinc-300 px-2 py-0.5 hover:border-zinc-500 dark:border-zinc-700">Go</button>
            </form>
          )}
        </div>
        <p className="mt-1 text-[10px] text-zinc-500">Always the full network (office + every store), independent of the chart&apos;s tab/split-by-store view above.</p>

        {!planLeadTimeProductId && (
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
      </section>

      {/* PO sheet grid */}
      <section className="mt-8 mb-16">
        <h2 className="text-lg font-medium">Suggested PO - colour × size ({styleByTemplateId.get(planTemplateId)?.name})</h2>
        <p className="mt-1 text-[10px] text-zinc-500">
          Suggested qty allocates the style-level total ({unitFormatter.format(plannerCalc.suggestedPoQty)} units) by trailing sales mix - colour over the last 3 months, size over the last 6. A blank cell means no trailing sales to base a share on, not zero demand. Every qty/price cell is editable before exporting.
        </p>
        <form action="/api/forecast/export-po" method="post" className="mt-2">
          <input type="hidden" name="styleName" value={styleByTemplateId.get(planTemplateId)?.name ?? ""} />
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
                      {styleByTemplateId.get(planTemplateId)?.name}
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
      </section>
    </div>
  );
}
