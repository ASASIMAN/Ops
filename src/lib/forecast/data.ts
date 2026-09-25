import type { SupabaseClient } from "@supabase/supabase-js";
import type { DemandRow } from "./aggregate";

/**
 * Supabase access for the /forecast module. Every rollup (company,
 * per-store, per-category, per-SKU) reads through `fetchPeriodDemand`
 * below, which is the one query behind the shared `ops_period_demand`
 * function from migration 0023 - see that migration's comment for why
 * there's a single function instead of one per rollup.
 */

export interface PeriodDemandArgs {
  from: string; // ISO timestamp
  to: string; // ISO timestamp, exclusive
  bucket: "day" | "week" | "month";
  storeIds?: number[] | null;
  productIds?: number[] | null;
}

export async function fetchPeriodDemand(
  supabase: SupabaseClient,
  args: PeriodDemandArgs,
): Promise<{ rows: DemandRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc("ops_period_demand", {
    p_from: args.from,
    p_to: args.to,
    p_bucket: args.bucket,
    p_store_ids: args.storeIds?.length ? args.storeIds : null,
    p_product_ids: args.productIds?.length ? args.productIds : null,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as DemandRow[], error: null };
}

export interface StockLevelRow {
  productId: number;
  locationId: number;
  kind: "office" | "store";
  storeId: number | null;
  qty: number;
  syncedAt: string;
}

/** Current on-hand stock, every product x tracked location. Empty (with `unavailable: true`) if migration 0023 hasn't been run yet. */
export async function fetchStockLevels(
  supabase: SupabaseClient,
): Promise<{ rows: StockLevelRow[]; unavailable: boolean }> {
  const { data, error } = await supabase
    .from("stock_levels")
    .select(
      "product_id, qty_on_hand, synced_at, stock_locations ( id, kind, store_id )",
    );

  if (error) return { rows: [], unavailable: true };

  type Row = {
    product_id: number;
    qty_on_hand: number;
    synced_at: string;
    stock_locations: { id: number; kind: "office" | "store"; store_id: number | null } | null;
  };

  const rows = ((data ?? []) as unknown as Row[])
    .filter((r) => r.stock_locations)
    .map((r) => ({
      productId: r.product_id,
      locationId: r.stock_locations!.id,
      kind: r.stock_locations!.kind,
      storeId: r.stock_locations!.store_id,
      qty: r.qty_on_hand,
      syncedAt: r.synced_at,
    }));

  return { rows, unavailable: false };
}

export interface ReorderSettings {
  leadTimeDays: number | null;
  targetServiceLevel: number;
}

/** Per-SKU reorder settings, falling back to the single global-default row (product_id = null) for any SKU without its own override. */
export async function fetchReorderSettings(
  supabase: SupabaseClient,
): Promise<{ bySku: Map<number, ReorderSettings>; global: ReorderSettings }> {
  const { data } = await supabase
    .from("vendor_reorder_settings")
    .select("product_id, lead_time_days, target_service_level");

  const rows = (data ?? []) as {
    product_id: number | null;
    lead_time_days: number | null;
    target_service_level: number;
  }[];

  const globalRow = rows.find((r) => r.product_id === null);
  const global: ReorderSettings = {
    leadTimeDays: globalRow?.lead_time_days ?? null,
    targetServiceLevel: globalRow?.target_service_level ?? 0.9,
  };

  const bySku = new Map<number, ReorderSettings>();
  for (const r of rows) {
    if (r.product_id === null) continue;
    bySku.set(r.product_id, {
      leadTimeDays: r.lead_time_days ?? global.leadTimeDays,
      targetServiceLevel: r.target_service_level ?? global.targetServiceLevel,
    });
  }

  return { bySku, global };
}

export function reorderSettingsFor(
  productId: number,
  settings: { bySku: Map<number, ReorderSettings>; global: ReorderSettings },
): ReorderSettings {
  return settings.bySku.get(productId) ?? settings.global;
}

export interface ProductLookupRow {
  id: number;
  name: string;
  sku: string | null;
  categoryId: number | null;
  categoryName: string | null;
}

export async function fetchProductLookup(
  supabase: SupabaseClient,
): Promise<Map<number, ProductLookupRow>> {
  const { data } = await supabase
    .from("products")
    .select("id, name, sku, category_id, product_categories ( name )");

  type Row = {
    id: number;
    name: string;
    sku: string | null;
    category_id: number | null;
    product_categories: { name: string } | null;
  };

  const map = new Map<number, ProductLookupRow>();
  for (const r of (data ?? []) as unknown as Row[]) {
    map.set(r.id, {
      id: r.id,
      name: r.name,
      sku: r.sku,
      categoryId: r.category_id,
      categoryName: r.product_categories?.name ?? null,
    });
  }
  return map;
}

/**
 * True once migration 0023 has been applied. Probed the same way
 * /operations checks for migration 0022 (`hasVariantType`) - the page
 * should degrade with a clear message, not 400 on every query, when run
 * against a database that hasn't been migrated yet.
 */
export async function hasForecastSchema(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("stock_locations").select("id").limit(1);
  return !error;
}
