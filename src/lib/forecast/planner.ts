import type { SupabaseClient } from "@supabase/supabase-js";
import type { StyleVariant } from "./style";
import { allocateToVariant, type AllocationShares } from "./style";
import { resolveEtaForPo, type LeadTimeRange } from "@/lib/leadtime/resolve";
import { zScoreForServiceLevel } from "./restock";

/**
 * The PO planner panel's math. Every number here is either a direct
 * input or shown with the line that produced it (`PlannerCalc.steps`) -
 * nothing is computed and hidden, per the brief asking to "show every
 * line of the calculation".
 */

/** The link between a chart style (Odoo template) and the lead-time system's product identity - see migration 0029's comment. Null means unlinked: open-PO-qty and a real lead time can't be computed for this style yet. */
export async function fetchLinkedLeadTimeProductId(
  supabase: SupabaseClient,
  templateId: number,
): Promise<number | null> {
  const { data } = await supabase
    .from("lead_time_name_mappings")
    .select("lead_time_product_id")
    .eq("odoo_template_id", templateId)
    .not("lead_time_product_id", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.lead_time_product_id ?? null;
}

export interface OpenPoLine {
  poNo: string;
  poDate: string;
  qtyOpen: number; // qty_ordered - qty_received_total, clamped to >= 0
  resolvedEtaEarliest: string;
  resolvedEtaLatest: string;
}

/** Every PO for the linked lead-time product that still has qty outstanding (qty_ordered > qty_received_total, treating a null receipt as "nothing received yet" rather than "fully received"). */
export async function fetchOpenPoLines(
  supabase: SupabaseClient,
  leadTimeProductId: number,
  productResolution: LeadTimeRange,
): Promise<OpenPoLine[]> {
  const { data } = await supabase
    .from("purchase_order_lines")
    .select(
      "qty_ordered, qty_received_total, purchase_orders ( po_no, po_date, manual_eta_date )",
    )
    .eq("lead_time_product_id", leadTimeProductId);

  type Row = {
    qty_ordered: number;
    qty_received_total: number | null;
    purchase_orders: { po_no: string; po_date: string; manual_eta_date: string | null } | null;
  };

  const byPo = new Map<string, { poDate: string; manualEta: string | null; qtyOpen: number }>();
  for (const r of (data ?? []) as unknown as Row[]) {
    if (!r.purchase_orders) continue;
    const received = r.qty_received_total ?? 0;
    const open = Math.max(0, r.qty_ordered - received);
    if (open <= 0) continue;
    const existing = byPo.get(r.purchase_orders.po_no);
    if (existing) {
      existing.qtyOpen += open;
    } else {
      byPo.set(r.purchase_orders.po_no, {
        poDate: r.purchase_orders.po_date,
        manualEta: r.purchase_orders.manual_eta_date,
        qtyOpen: open,
      });
    }
  }

  return Array.from(byPo.entries()).map(([poNo, v]) => {
    const eta = resolveEtaForPo(v.poDate, v.manualEta, productResolution);
    return {
      poNo,
      poDate: v.poDate,
      qtyOpen: v.qtyOpen,
      resolvedEtaEarliest: eta.etaDateRange!.earliest,
      resolvedEtaLatest: eta.etaDateRange!.latest,
    };
  });
}

export interface PlannerInputs {
  currentStockOffice: number;
  currentStockStores: number;
  openPoBeforeArrival: number;
  dailyForecastRate: number; // units/day, from the style forecast (monthly expected / 30)
  dailyForecastStdDev: number; // from the forecast's residual std-dev, for safety stock
  daysUntilArrival: number; // late-end lead time, days from today
  coverageDays: number;
  targetServiceLevel: number;
}

export interface PlannerStep {
  label: string;
  value: number;
  formula: string;
}

export interface PlannerCalc {
  stockOnArrival: number;
  forecastUntilArrival: number;
  forecastOverCoverage: number;
  safetyStock: number;
  target: number;
  suggestedPoQty: number;
  steps: PlannerStep[];
  /** True when, even with zero lead time, projected stock would already be negative before an order placed today could possibly arrive - i.e. a stockout that can't be prevented, only shortened. */
  alreadyLate: boolean;
  projectedStockoutInDays: number | null; // null = not projected to run out within the forecast horizon used here
}

/**
 * current_stock + open_PO_before_arrival - forecast_until_arrival, floored
 * at 0 (stock_on_arrival); then target = forecast_over_coverage +
 * safety_stock (safety stock from the forecast's own error distribution,
 * not a fixed % of demand - see zScoreForServiceLevel in ./resolve, the
 * same function the restock alerts use); suggested_PO_qty = target -
 * stock_on_arrival, floored at 0.
 */
export function computePlanner(inputs: PlannerInputs): PlannerCalc {
  const currentStock = inputs.currentStockOffice + inputs.currentStockStores;
  const forecastUntilArrival = inputs.dailyForecastRate * inputs.daysUntilArrival;
  const stockOnArrivalRaw = currentStock + inputs.openPoBeforeArrival - forecastUntilArrival;
  const stockOnArrival = Math.max(0, stockOnArrivalRaw);

  const forecastOverCoverage = inputs.dailyForecastRate * inputs.coverageDays;
  const z = zScoreForServiceLevel(inputs.targetServiceLevel);
  const safetyStock = z * inputs.dailyForecastStdDev * Math.sqrt(inputs.coverageDays);
  const target = forecastOverCoverage + safetyStock;
  const suggestedPoQty = Math.max(0, Math.round(target - stockOnArrival));

  const alreadyLate = stockOnArrivalRaw < 0;
  const projectedStockoutInDays =
    inputs.dailyForecastRate > 0 ? Math.floor(currentStock / inputs.dailyForecastRate) : null;

  const steps: PlannerStep[] = [
    {
      label: "Current stock (office + stores)",
      value: currentStock,
      formula: `${inputs.currentStockOffice} (office) + ${inputs.currentStockStores} (stores)`,
    },
    {
      label: "Open PO qty landing before arrival",
      value: inputs.openPoBeforeArrival,
      formula: "Sum of open PO lines for this product whose resolved ETA is before today + late lead time",
    },
    {
      label: "Forecast demand until arrival",
      value: Math.round(forecastUntilArrival),
      formula: `${inputs.dailyForecastRate.toFixed(2)} units/day x ${inputs.daysUntilArrival} days`,
    },
    {
      label: "Stock on arrival",
      value: Math.round(stockOnArrival),
      formula: `max(0, current stock + open PO - forecast until arrival)${alreadyLate ? " - raw value was negative, see \"already late\" flag" : ""}`,
    },
    {
      label: "Forecast demand over coverage window",
      value: Math.round(forecastOverCoverage),
      formula: `${inputs.dailyForecastRate.toFixed(2)} units/day x ${inputs.coverageDays} coverage days`,
    },
    {
      label: `Safety stock (z=${z.toFixed(2)} for ${Math.round(inputs.targetServiceLevel * 100)}% service level)`,
      value: Math.round(safetyStock),
      formula: `z x forecast error std-dev (${inputs.dailyForecastStdDev.toFixed(2)}/day) x sqrt(${inputs.coverageDays} days)`,
    },
    {
      label: "Target stock (forecast over coverage + safety stock)",
      value: Math.round(target),
      formula: "Forecast over coverage + safety stock",
    },
    {
      label: "Suggested PO quantity",
      value: suggestedPoQty,
      formula: "max(0, target - stock on arrival)",
    },
  ];

  return {
    stockOnArrival,
    forecastUntilArrival,
    forecastOverCoverage,
    safetyStock,
    target,
    suggestedPoQty,
    steps,
    alreadyLate,
    projectedStockoutInDays,
  };
}

export interface WhatIfResult {
  stockAfterLanding: number;
  projectedStockoutDate: string | null; // null = doesn't run out within a year at the current forecast rate
}

/** "What if I order X" - projects stock forward from the arrival date at the current forecast rate, assuming the quantity entered lands on the late ETA (the conservative assumption, consistent with everything else here using the late end for alerting). */
export function computeWhatIf(
  orderQty: number,
  calc: PlannerCalc,
  dailyForecastRate: number,
  arrivalDateIso: string,
): WhatIfResult {
  const stockAfterLanding = calc.stockOnArrival + orderQty;
  if (dailyForecastRate <= 0) {
    return { stockAfterLanding, projectedStockoutDate: null };
  }
  const daysOfCover = stockAfterLanding / dailyForecastRate;
  if (daysOfCover > 365) return { stockAfterLanding, projectedStockoutDate: null };
  const stockoutDate = new Date(
    new Date(`${arrivalDateIso}T00:00:00Z`).getTime() + daysOfCover * 24 * 60 * 60 * 1000,
  );
  return { stockAfterLanding, projectedStockoutDate: stockoutDate.toISOString().slice(0, 10) };
}

export interface TrajectoryPoint {
  date: string;
  /** Pessimistic: an open PO only counts once it lands at its LATE eta. */
  low: number;
  /** Optimistic: an open PO counts from its EARLY eta. The gap between low/high at a given date is the small band the brief asks for around each PO's ETA uncertainty. */
  high: number;
}

/**
 * Projects stock forward day by day from `currentStock`: a flat
 * `dailyForecastRate` draws it down (no within-month seasonality, same
 * simplification as the rest of this module), and each open PO in
 * `openPoLines` steps it back up once its resolved ETA is reached -
 * `low` uses each PO's late ETA, `high` its early ETA. A new
 * hypothetical "what if" order can be passed the same way, as one more
 * entry in `openPoLines`.
 */
export function projectStockTrajectory(
  currentStock: number,
  dailyForecastRate: number,
  openPoLines: { qtyOpen: number; resolvedEtaEarliest: string; resolvedEtaLatest: string }[],
  startDateIso: string,
  horizonDays: number,
): TrajectoryPoint[] {
  const startMs = new Date(`${startDateIso}T00:00:00Z`).getTime();
  const points: TrajectoryPoint[] = [];

  for (let day = 0; day <= horizonDays; day++) {
    const dateIso = new Date(startMs + day * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const demandSoFar = dailyForecastRate * day;
    let landedLow = 0;
    let landedHigh = 0;
    for (const po of openPoLines) {
      if (po.resolvedEtaLatest <= dateIso) landedLow += po.qtyOpen;
      if (po.resolvedEtaEarliest <= dateIso) landedHigh += po.qtyOpen;
    }
    points.push({
      date: dateIso,
      low: Math.max(0, currentStock - demandSoFar + landedLow),
      high: Math.max(0, currentStock - demandSoFar + landedHigh),
    });
  }
  return points;
}

export interface OrderByResult {
  /** First date the pessimistic (low) trajectory reaches the safety-stock level - null if it never does within the projected horizon. */
  crossesSafetyStockDate: string | null;
  /** crossesSafetyStockDate minus the late lead time - the last day an order can be placed and still (pessimistically) land before stock reaches the safety-stock floor. Null when crossesSafetyStockDate is null. */
  orderByDate: string | null;
  /** True when orderByDate is already in the past - an order placed today will land after stock was projected to already be at/under the safety-stock level. */
  alreadyLate: boolean;
}

export function computeOrderByDate(
  trajectory: TrajectoryPoint[],
  safetyStockLevel: number,
  lateLeadTimeDays: number,
  todayIso: string,
): OrderByResult {
  const crossing = trajectory.find((p) => p.low <= safetyStockLevel);
  if (!crossing) {
    return { crossesSafetyStockDate: null, orderByDate: null, alreadyLate: false };
  }
  const orderByMs = new Date(`${crossing.date}T00:00:00Z`).getTime() - lateLeadTimeDays * 24 * 60 * 60 * 1000;
  const orderByDate = new Date(orderByMs).toISOString().slice(0, 10);
  return { crossesSafetyStockDate: crossing.date, orderByDate, alreadyLate: orderByDate < todayIso };
}

export type CoverStatus = "ok" | "low" | "risk";

export interface CoverSummary {
  weeksOfCover: number | null; // null = no forecasted demand to divide by (can't be computed, not infinite)
  status: CoverStatus;
}

/**
 * "risk" = projected to run out before a PO placed today could even
 * arrive (the late lead time) - matches `PlannerCalc.alreadyLate`.
 * "low" = lasts past arrival but not through the full coverage window
 * after it. "ok" = comfortably covers lead time + coverage. These
 * thresholds reuse the same lead-time/coverage numbers already on
 * screen rather than introducing a separate, unexplained cutoff.
 */
export function coverStatus(
  currentStock: number,
  dailyForecastRate: number,
  lateLeadTimeDays: number,
  coverageDays: number,
): CoverSummary {
  if (dailyForecastRate <= 0) return { weeksOfCover: null, status: "ok" };
  const daysOfCover = currentStock / dailyForecastRate;
  const weeksOfCover = daysOfCover / 7;
  let status: CoverStatus = "ok";
  if (daysOfCover < lateLeadTimeDays) status = "risk";
  else if (daysOfCover < lateLeadTimeDays + coverageDays) status = "low";
  return { weeksOfCover, status };
}

export interface GridCell {
  color: string | null;
  size: string | null;
  suggestedQty: number | null; // null = no trailing-mix basis to allocate from (see allocateToVariant)
  cmtPriceIdr: number | null;
}

/** The colour x size grid in the PO sheet's own layout (style, colour, size, qty, CMT price) - cmtPriceIdr comes from the most recent purchase_order_lines.unit_price_idr seen for that exact colour+size, when any exists. */
export async function buildPoGrid(
  supabase: SupabaseClient,
  variants: StyleVariant[],
  suggestedStyleQty: number,
  shares: AllocationShares,
  leadTimeProductId: number | null,
): Promise<GridCell[]> {
  let priceByColorSize = new Map<string, number>();
  if (leadTimeProductId) {
    const { data } = await supabase
      .from("purchase_order_lines")
      .select("colorway, size, unit_price_idr, po_id")
      .eq("lead_time_product_id", leadTimeProductId)
      .order("po_id", { ascending: false });
    priceByColorSize = new Map();
    for (const r of data ?? []) {
      const key = `${r.colorway ?? ""}:${r.size ?? ""}`;
      if (!priceByColorSize.has(key) && r.unit_price_idr != null) {
        priceByColorSize.set(key, r.unit_price_idr);
      }
    }
  }

  return variants.map((v) => ({
    color: v.color,
    size: v.size,
    suggestedQty: allocateToVariant(suggestedStyleQty, v.color, v.size, shares),
    cmtPriceIdr: priceByColorSize.get(`${v.color ?? ""}:${v.size ?? ""}`) ?? null,
  }));
}

