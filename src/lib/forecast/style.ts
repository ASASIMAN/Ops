import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPeriodDemand } from "./data";
import type { Period } from "./engine";
import { canonicalColor, canonicalSize, type AttributeAliasMap } from "./aliases";

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
  /** Every variant (product row) of the style, merged duplicates included. */
  productIds: number[];
}

/**
 * Explicit "these Odoo templates are the same product" merges (migration
 * 0032) - e.g. a company-profile change in Odoo re-creating a product
 * under a new template id. Fetched once per page load and threaded
 * through every function below that queries by template id, so a merged
 * id always rolls up to its canonical one rather than each call site
 * re-deciding it independently.
 */
export interface StyleMergeMap {
  /** merged (non-canonical) template id -> the canonical id it rolls up to. */
  canonicalByRaw: Map<number, number>;
}

export async function fetchStyleMerges(supabase: SupabaseClient): Promise<StyleMergeMap> {
  const { data } = await supabase.from("style_merges").select("canonical_template_id, merged_template_id");
  const canonicalByRaw = new Map<number, number>();
  for (const r of data ?? []) canonicalByRaw.set(r.merged_template_id, r.canonical_template_id);
  return { canonicalByRaw };
}

export function toCanonicalTemplateId(templateId: number, merges: StyleMergeMap): number {
  return merges.canonicalByRaw.get(templateId) ?? templateId;
}

/** Every raw template id that rolls up to this canonical one, including itself - what to query `products`/`forecast_uplift_factors`/etc. by, instead of the canonical id alone, so a merged duplicate's own rows aren't silently excluded. */
export function templateIdGroup(canonicalTemplateId: number, merges: StyleMergeMap): number[] {
  const merged = Array.from(merges.canonicalByRaw.entries())
    .filter(([, canonical]) => canonical === canonicalTemplateId)
    .map(([raw]) => raw);
  return [canonicalTemplateId, ...merged];
}

/** " - (Brown,L)" at the end of a product name: the old company's per-variant products. */
const VARIANT_SUFFIX = /\s+-\s+\(([^()]*)\)\s*$/;

/**
 * The product list for a picker, one entry per style (Odoo template, with
 * merged templates folded into their canonical one).
 *
 * `posOnly` (the /forecast product search) lists only styles with at least
 * one variant that is "Available in POS" and not archived in Odoo
 * (migration 0048) - leaving out services, samples, cost lines and archived
 * products. While those flags haven't been synced yet (column missing or
 * every row null) it lists everything, as before.
 *
 * With `posOnly`, styles that share a name (case and spacing ignored) are
 * the same product re-created by the company-profile change (confirmed by
 * the business) and are merged into one entry, whether or not each copy is
 * still in the POS: they're added to `merges` - the map passed in is
 * extended - so the merged style keeps every copy's sales, stock and
 * links. Without `posOnly` (the budget planner) an unexplained name
 * collision still shows apart with its template id appended, since a
 * plain-text `<datalist>` can't tell identical labels apart.
 */
export async function fetchStyleOptions(
  supabase: SupabaseClient,
  merges: StyleMergeMap,
  { posOnly = false }: { posOnly?: boolean } = {},
): Promise<StyleOption[]> {
  type Row = { id: number; odoo_template_id: number; name: string; available_in_pos?: boolean | null; odoo_active?: boolean | null };
  // Paged: the products table has one row per variant and can exceed the API's 1000-row page.
  const readAll = async (cols: string) => {
    const rows: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error } = await supabase
        .from("products")
        .select(cols)
        .order("name")
        .order("id")
        .range(from, from + 999);
      if (error) return null;
      rows.push(...((page ?? []) as unknown as Row[]));
      if (!page || page.length < 1000) break;
    }
    return rows;
  };
  const data = (posOnly ? await readAll("id, odoo_template_id, name, available_in_pos, odoo_active") : null) ?? (await readAll("id, odoo_template_id, name")) ?? [];

  const posKnown = posOnly && data.some((r) => r.available_in_pos != null);
  const listed = new Set<number>();
  for (const r of data) {
    if (!posKnown || (r.available_in_pos && r.odoo_active !== false)) listed.add(toCanonicalTemplateId(r.odoo_template_id, merges));
  }

  if (posOnly) {
    // Same name = same product (confirmed by the business: the company-
    // profile change re-created products under new template ids, and the
    // copies can both still be active and in the POS). Every style sharing
    // a name - case and spacing ignored - is merged into one: the lowest
    // listed template id, so the merged style stays in the list.
    const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
    const nameOf = new Map<number, string>();
    for (const r of data) {
      const canonical = toCanonicalTemplateId(r.odoo_template_id, merges);
      if (!nameOf.has(canonical)) nameOf.set(canonical, r.name);
    }
    // A per-variant product the old company created as its own product,
    // named "Base - (Colour,Size)", belongs with "Base" - but only when a
    // product named exactly "Base" exists; otherwise its name stands.
    const allKeys = new Set(Array.from(nameOf.values(), nameKey));
    const groupKey = (name: string) => {
      const m = VARIANT_SUFFIX.exec(name);
      const base = m ? nameKey(name.slice(0, m.index)) : null;
      return base && allKeys.has(base) ? base : nameKey(name);
    };
    const groups = new Map<string, number[]>();
    for (const [templateId, name] of nameOf) {
      const key = groupKey(name);
      groups.set(key, [...(groups.get(key) ?? []), templateId]);
    }
    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      // Prefer a listed template carrying the plain name, so the entry reads "Base", not "Base - (Brown,L)".
      const plain = group.filter((t) => listed.has(t) && nameKey(nameOf.get(t)!) === key);
      const target = Math.min(...(plain.length ? plain : group.filter((t) => listed.has(t))));
      if (!Number.isFinite(target)) continue; // none of them sold in the POS
      for (const t of group) {
        if (t === target) continue;
        for (const [raw, canonical] of merges.canonicalByRaw) {
          if (canonical === t) merges.canonicalByRaw.set(raw, target);
        }
        merges.canonicalByRaw.set(t, target);
        listed.delete(t);
      }
    }
  }

  const byTemplate = new Map<number, string>();
  const productIdsByTemplate = new Map<number, number[]>();
  for (const r of data) {
    const canonical = toCanonicalTemplateId(r.odoo_template_id, merges);
    if (!listed.has(canonical)) continue;
    if (!byTemplate.has(canonical)) byTemplate.set(canonical, r.name);
    productIdsByTemplate.set(canonical, [...(productIdsByTemplate.get(canonical) ?? []), r.id]);
  }

  const templateIdsByName = new Map<string, number[]>();
  for (const [templateId, name] of byTemplate) {
    templateIdsByName.set(name, [...(templateIdsByName.get(name) ?? []), templateId]);
  }

  return Array.from(byTemplate.entries())
    .map(([templateId, name]) => ({
      templateId,
      name: (templateIdsByName.get(name)?.length ?? 1) > 1 ? `${name} (#${templateId})` : name,
      productIds: productIdsByTemplate.get(templateId) ?? [],
    }))
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
  merges: StyleMergeMap,
): Promise<StyleVariant[]> {
  const { data } = await supabase
    .from("products")
    .select("id, color, size, name")
    .in("odoo_template_id", templateIdGroup(templateId, merges));
  return (data ?? []).map((r) => {
    // An old per-variant product ("Base - (Brown,L)", see fetchStyleOptions)
    // has no colour/size attributes in Odoo; its name carries them instead.
    if (!r.color && !r.size) {
      const parts = VARIANT_SUFFIX.exec(r.name)?.[1].split(",").map((p: string) => p.trim());
      if (parts?.length === 2 && parts[0] && parts[1]) return { productId: r.id, color: parts[0], size: parts[1] };
    }
    return { productId: r.id, color: r.color, size: r.size };
  });
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
  aliases: AttributeAliasMap,
): Map<string, number> {
  const variantById = new Map(variants.map((v) => [v.productId, v]));
  const canonicalize = dimension === "color" ? canonicalColor : canonicalSize;
  const totalsByValue = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const value = canonicalize(variantById.get(r.productId)?.[dimension] ?? null, aliases);
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
  aliases: AttributeAliasMap,
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
    colorShare: sharesFromRows(byProduct(colorRows), variants, "color", aliases),
    sizeShare: sharesFromRows(byProduct(sizeRows), variants, "size", aliases),
  };
}

/** Allocates a style-level unit forecast down to one (colour, size) cell. `color`/`size` are canonicalized before the lookup, so a variant spelled either way as an alias still finds its share. Returns null (not 0) when either share is unknown - e.g. a brand-new colour/size with no trailing sales yet has no basis for a share, and 0 would misrepresent "no data" as "no demand". */
export function allocateToVariant(
  styleUnits: number,
  color: string | null,
  size: string | null,
  shares: AllocationShares,
  aliases: AttributeAliasMap,
): number | null {
  const colorShare = color ? shares.colorShare.get(canonicalColor(color, aliases) ?? color) : undefined;
  const sizeShare = size ? shares.sizeShare.get(canonicalSize(size, aliases) ?? size) : undefined;
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
  merges: StyleMergeMap,
): Promise<UpliftFactor[]> {
  const group = templateIdGroup(templateId, merges);
  const { data } = await supabase
    .from("forecast_uplift_factors")
    .select("label, start_date, end_date, uplift_pct, note")
    .or(`product_template_id.in.(${group.join(",")}),product_template_id.is.null`)
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
  merges: StyleMergeMap,
): Promise<ForecastEvent[]> {
  const group = templateIdGroup(templateId, merges);
  const { data } = await supabase
    .from("forecast_events")
    .select("event_date, label, note")
    .or(`product_template_id.in.(${group.join(",")}),product_template_id.is.null`)
    .gte("event_date", fromIso)
    .lt("event_date", toIso)
    .order("event_date");
  return (data ?? []).map((r) => ({ eventDate: r.event_date, label: r.label, note: r.note }));
}
