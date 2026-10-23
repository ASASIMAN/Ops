import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPeriodDemand } from "./data";
import type { Period } from "./engine";

/**
 * Style-level data access for the PO Planning Chart (/forecast's main
 * view). "Style" = an Odoo product template (`odoo_template_id`) -
 * colour/size variants of the same template share one forecast, then
 * get allocated back out by trailing sales mix (see allocateToVariants
 * below). This is a different product identity than the lead-time
 * system's `lead_time_products` (migration 0027) - see that migration's
 * comment and `linkStyleToLeadTimeProduct` in ./planner.ts for how
 * they're connected.
 */

export async function hasPoPlanningSchema(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("forecast_uplift_factors").select("id").limit(1);
  return !error;
}

export interface StyleOption {
  templateId: number;
  name: string;
}

export async function fetchStyleOptions(supabase: SupabaseClient): Promise<StyleOption[]> {
  const { data } = await supabase
    .from("products")
    .select("odoo_template_id, name")
    .order("name");

  const byTemplate = new Map<number, string>();
  for (const r of data ?? []) {
    if (!byTemplate.has(r.odoo_template_id)) byTemplate.set(r.odoo_template_id, r.name);
  }
  return Array.from(byTemplate.entries())
    .map(([templateId, name]) => ({ templateId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface StyleVariant {
  productId: number;
  color: string | null;
  size: string | null;
}

export async function fetchStyleVariants(
  supabase: SupabaseClient,
  templateId: number,
): Promise<StyleVariant[]> {
  const { data } = await supabase
    .from("products")
    .select("id, color, size")
    .eq("odoo_template_id", templateId);
  return (data ?? []).map((r) => ({ productId: r.id, color: r.color, size: r.size }));
}

/** Net units per month (sales minus returns) for a style, optionally restricted to a subset of variants (colour/size drill-down) and stores. Net because order_lines.qty already carries a negative sign on refund lines at the same grain - summing it is already net, not gross. */
export async function fetchStyleMonthlyNetUnits(
  supabase: SupabaseClient,
  productIds: number[],
  storeIds: number[] | null,
  fromIso: string,
  toIso: string,
): Promise<Period[]> {
  const { rows } = await fetchPeriodDemand(supabase, {
    from: fromIso,
    to: toIso,
    bucket: "month",
    storeIds,
    productIds,
  });
  const byMonth = new Map<string, number>();
  for (const r of rows) byMonth.set(r.bucket_date, (byMonth.get(r.bucket_date) ?? 0) + r.units);
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ date, value }));
}

/** Daily net units for a style within one calendar month - used for the current month's month-to-date figure. */
export async function fetchStyleDailyNetUnits(
  supabase: SupabaseClient,
  productIds: number[],
  storeIds: number[] | null,
  fromIso: string,
  toIso: string,
): Promise<Period[]> {
  const { rows } = await fetchPeriodDemand(supabase, {
    from: fromIso,
    to: toIso,
    bucket: "day",
    storeIds,
    productIds,
  });
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.bucket_date, (byDay.get(r.bucket_date) ?? 0) + r.units);
  return Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ date, value }));
}

export interface MonthToDate {
  monthStart: string; // YYYY-MM-01
  mtdUnits: number;
  daysElapsed: number;
  daysInMonth: number;
  /** Simple run-rate projection: mtdUnits scaled to a full month. Never plotted as if it were a completed month's actual - the chart shows both points distinctly. */
  projectedFullMonthUnits: number;
}

export function computeMonthToDate(dailyUnits: Period[], today: Date): MonthToDate {
  const monthStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const daysInMonth = new Date(today.getUTCFullYear(), today.getUTCMonth() + 1, 0).getDate();
  const daysElapsed = today.getUTCDate();
  const mtdUnits = dailyUnits.reduce((sum, p) => sum + p.value, 0);
  return {
    monthStart,
    mtdUnits,
    daysElapsed,
    daysInMonth,
    projectedFullMonthUnits: daysElapsed > 0 ? Math.round((mtdUnits / daysElapsed) * daysInMonth) : 0,
  };
}

/**
 * Trailing-mix allocation shares for colour and size, computed over
 * different windows per the brief (colour: 3 months, size: 6 months)
 * and combined multiplicatively (assumes colour mix and size mix are
 * independent - a simplification, not a measured joint distribution;
 * flagged here since it's the kind of thing that can silently look more
 * precise than it is).
 */
export interface AllocationShares {
  colorShare: Map<string, number>; // color -> 0..1
  sizeShare: Map<string, number>; // size -> 0..1
}

function sharesFromRows(
  rows: { productId: number; units: number }[],
  variants: StyleVariant[],
  dimension: "color" | "size",
): Map<string, number> {
  const variantById = new Map(variants.map((v) => [v.productId, v]));
  const totalsByValue = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const value = variantById.get(r.productId)?.[dimension];
    if (!value) continue;
    totalsByValue.set(value, (totalsByValue.get(value) ?? 0) + r.units);
    total += r.units;
  }
  const shares = new Map<string, number>();
  if (total <= 0) return shares;
  for (const [value, units] of totalsByValue) shares.set(value, units / total);
  return shares;
}

export async function fetchAllocationShares(
  supabase: SupabaseClient,
  variants: StyleVariant[],
  nowIso: string,
): Promise<AllocationShares> {
  const productIds = variants.map((v) => v.productId);
  const monthsAgo = (n: number) => new Date(new Date(nowIso).getTime() - n * 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ rows: colorRows }, { rows: sizeRows }] = await Promise.all([
    fetchPeriodDemand(supabase, { from: monthsAgo(3), to: nowIso, bucket: "month", storeIds: null, productIds }),
    fetchPeriodDemand(supabase, { from: monthsAgo(6), to: nowIso, bucket: "month", storeIds: null, productIds }),
  ]);

  const byProduct = (rows: typeof colorRows) => {
    const totals = new Map<number, number>();
    for (const r of rows) totals.set(r.product_id, (totals.get(r.product_id) ?? 0) + r.units);
    return Array.from(totals.entries()).map(([productId, units]) => ({ productId, units }));
  };

  return {
    colorShare: sharesFromRows(byProduct(colorRows), variants, "color"),
    sizeShare: sharesFromRows(byProduct(sizeRows), variants, "size"),
  };
}

/** Allocates a style-level unit forecast down to one (colour, size) cell. Returns null (not 0) when either share is unknown - e.g. a brand-new colour/size with no trailing sales yet has no basis for a share, and 0 would misrepresent "no data" as "no demand". */
export function allocateToVariant(
  styleUnits: number,
  color: string | null,
  size: string | null,
  shares: AllocationShares,
): number | null {
  const colorShare = color ? shares.colorShare.get(color) : undefined;
  const sizeShare = size ? shares.sizeShare.get(size) : undefined;
  if (colorShare === undefined || sizeShare === undefined) return null;
  return styleUnits * colorShare * sizeShare;
}

export interface StockHistoryRow {
  date: string; // YYYY-MM-DD
  qty: number;
  kind: "office" | "store";
  storeId: number | null;
}

/**
 * Daily stock history for a set of variants, from stock_level_history
 * (migration 0029 - no backfill, same caveat as fetchStockoutDays).
 * Returns one row per (location, day) rather than pre-summed, so the
 * caller can scope it to the whole network, one store, or the office
 * alone - see `LocationScope` below, which is also what decides whether
 * an open PO's arrival can be shown stepping up a given series (it only
 * makes sense for the office or the whole network - a PO doesn't land
 * at a specific store).
 */
export async function fetchStockHistory(
  supabase: SupabaseClient,
  productIds: number[],
  fromIso: string,
  toIso: string,
): Promise<StockHistoryRow[]> {
  if (!productIds.length) return [];
  const { data } = await supabase
    .from("stock_level_history")
    .select("snapshot_date, qty_on_hand, stock_locations ( kind, store_id )")
    .in("product_id", productIds)
    .gte("snapshot_date", fromIso)
    .lt("snapshot_date", toIso);

  type Row = {
    snapshot_date: string;
    qty_on_hand: number;
    stock_locations: { kind: "office" | "store"; store_id: number | null } | null;
  };

  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.stock_locations)
    .map((r) => ({
      date: r.snapshot_date,
      qty: r.qty_on_hand,
      kind: r.stock_locations!.kind,
      storeId: r.stock_locations!.store_id,
    }));
}

/** Which locations a series' stock figures are drawn from. 'network' = office + every store combined (only meaningful when nothing narrower was selected); a specific store or the office alone otherwise. */
export type LocationScope = { kind: "network" } | { kind: "store"; storeId: number } | { kind: "office" };

export function matchesScope(row: { kind: "office" | "store"; storeId: number | null }, scope: LocationScope): boolean {
  if (scope.kind === "network") return true;
  if (scope.kind === "office") return row.kind === "office";
  return row.kind === "store" && row.storeId === scope.storeId;
}

export function sumStockHistoryByDate(rows: StockHistoryRow[], scope: LocationScope): Period[] {
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (!matchesScope(r, scope)) continue;
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.qty);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ date, value }));
}

export interface StockoutDay {
  date: string; // YYYY-MM-DD
}

/**
 * Days where combined stock (every variant of this style, every
 * tracked location) was exactly 0, from `stock_level_history`. Only
 * covers whatever history has accumulated since migration 0029 was
 * deployed - there is no backfill, so an empty result for an old month
 * means "no history recorded", not "never stocked out". The caller
 * (the chart) must distinguish those two cases rather than silently
 * treating missing history as a clean record.
 */
export async function fetchStockoutDays(
  supabase: SupabaseClient,
  productIds: number[],
  fromIso: string,
  toIso: string,
): Promise<{ stockoutDays: StockoutDay[]; earliestHistoryDate: string | null }> {
  if (!productIds.length) return { stockoutDays: [], earliestHistoryDate: null };

  const { data } = await supabase
    .from("stock_level_history")
    .select("snapshot_date, qty_on_hand")
    .in("product_id", productIds)
    .gte("snapshot_date", fromIso)
    .lt("snapshot_date", toIso);

  const byDate = new Map<string, number>();
  for (const r of data ?? []) {
    byDate.set(r.snapshot_date, (byDate.get(r.snapshot_date) ?? 0) + r.qty_on_hand);
  }

  const dates = Array.from(byDate.keys()).sort();
  return {
    stockoutDays: dates.filter((d) => byDate.get(d) === 0).map((date) => ({ date })),
    earliestHistoryDate: dates[0] ?? null,
  };
}

/** Scales an affected month's actual units up to approximate what it would have sold with a full month of stock available - the "adjust history for stockouts" toggle. Returns the input unchanged (with adjusted=false) when the month wasn't fully covered by recorded history, or was out of stock the whole month (no sell-through rate to extrapolate from). */
export function adjustForStockouts(
  actualUnits: number,
  daysInMonth: number,
  stockoutDaysInMonth: number,
  historyCoversWholeMonth: boolean,
): { units: number; adjusted: boolean } {
  if (!historyCoversWholeMonth || stockoutDaysInMonth <= 0 || stockoutDaysInMonth >= daysInMonth) {
    return { units: actualUnits, adjusted: false };
  }
  const sellableDays = daysInMonth - stockoutDaysInMonth;
  return { units: (actualUnits / sellableDays) * daysInMonth, adjusted: true };
}

export interface UpliftFactor {
  label: string;
  startDate: string;
  endDate: string;
  upliftPct: number;
  note: string | null;
}

export async function fetchUpliftFactors(
  supabase: SupabaseClient,
  templateId: number,
): Promise<UpliftFactor[]> {
  const { data } = await supabase
    .from("forecast_uplift_factors")
    .select("label, start_date, end_date, uplift_pct, note")
    .or(`product_template_id.eq.${templateId},product_template_id.is.null`)
    .order("start_date");
  return (data ?? []).map((r) => ({
    label: r.label,
    startDate: r.start_date,
    endDate: r.end_date,
    upliftPct: r.uplift_pct,
    note: r.note,
  }));
}

/** Fraction of a given month ("YYYY-MM-01") covered by an uplift window, for pro-rating a factor that only partially overlaps a calendar month. 0 if no overlap. */
export function upliftOverlapFraction(monthStart: string, factor: UpliftFactor): number {
  const monthStartMs = new Date(`${monthStart}T00:00:00Z`).getTime();
  const d = new Date(monthStartMs);
  const daysInMonth = new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getDate();
  const monthEndMs = monthStartMs + daysInMonth * 24 * 60 * 60 * 1000;

  const startMs = new Date(`${factor.startDate}T00:00:00Z`).getTime();
  const endMs = new Date(`${factor.endDate}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000;

  const overlapStart = Math.max(monthStartMs, startMs);
  const overlapEnd = Math.min(monthEndMs, endMs);
  const overlapDays = Math.max(0, overlapEnd - overlapStart) / (24 * 60 * 60 * 1000);
  return overlapDays / daysInMonth;
}

export interface ForecastEvent {
  eventDate: string;
  label: string;
  note: string | null;
}

export async function fetchForecastEvents(
  supabase: SupabaseClient,
  templateId: number,
  fromIso: string,
  toIso: string,
): Promise<ForecastEvent[]> {
  const { data } = await supabase
    .from("forecast_events")
    .select("event_date, label, note")
    .or(`product_template_id.eq.${templateId},product_template_id.is.null`)
    .gte("event_date", fromIso)
    .lt("event_date", toIso)
    .order("event_date");
  return (data ?? []).map((r) => ({ eventDate: r.event_date, label: r.label, note: r.note }));
}
