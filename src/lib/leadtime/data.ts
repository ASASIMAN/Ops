import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveDeliveredDate,
  resolveProductLeadTime,
  type LeadTimeEstimateRow,
  type LeadTimeRange,
  type LeadTimeSettings,
  type MeasuredDelivery,
} from "./resolve";

/** Supabase access for the lead-time module (migration 0027). Keeps the fetching separate from the pure resolution logic in ./resolve, same split as src/lib/forecast/{data,engine}.ts. */

export async function hasLeadTimeSchema(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("lead_time_products").select("id").limit(1);
  return !error;
}

export async function fetchLeadTimeSettings(supabase: SupabaseClient): Promise<LeadTimeSettings> {
  const { data } = await supabase.from("lead_time_settings").select("*").eq("id", 1).maybeSingle();
  return {
    lateEndBufferPct: data?.late_end_buffer_pct ?? 25,
    globalDefaultMinDays: data?.global_default_min_days ?? 42,
    globalDefaultMaxDays: data?.global_default_max_days ?? 56,
    measuredMinPoCount: data?.measured_min_po_count ?? 5,
    firstDeliveryOnly: data?.first_delivery_only ?? false,
  };
}

export interface LeadTimeProductRow {
  id: number;
  canonicalName: string;
  isGarment: boolean | null;
  note: string | null;
}

export async function fetchLeadTimeProducts(supabase: SupabaseClient): Promise<LeadTimeProductRow[]> {
  const { data } = await supabase
    .from("lead_time_products")
    .select("id, canonical_name, is_garment, note")
    .order("canonical_name");
  return (data ?? []).map((r) => ({
    id: r.id,
    canonicalName: r.canonical_name,
    isGarment: r.is_garment,
    note: r.note,
  }));
}

export async function fetchEstimatesByProduct(
  supabase: SupabaseClient,
): Promise<Map<number, LeadTimeEstimateRow[]>> {
  const { data } = await supabase
    .from("lead_times")
    .select("lead_time_product_id, vendor, min_days, max_days, source, updated_at");

  const map = new Map<number, LeadTimeEstimateRow[]>();
  for (const r of data ?? []) {
    const list = map.get(r.lead_time_product_id) ?? [];
    list.push({
      minDays: r.min_days,
      maxDays: r.max_days,
      source: r.source,
      vendor: r.vendor,
      updatedAt: r.updated_at,
    });
    map.set(r.lead_time_product_id, list);
  }
  return map;
}

/** Every PO line's resolved delivery date, grouped by product - the raw material `computeMeasuredLeadTime` (via resolveProductLeadTime) reduces per product. One row per distinct PO per product (a PO with several lines of the same style/different colours only counts once). */
export async function fetchMeasuredDeliveriesByProduct(
  supabase: SupabaseClient,
  firstDeliveryOnly: boolean,
): Promise<Map<number, MeasuredDelivery[]>> {
  const { data } = await supabase
    .from("purchase_order_lines")
    .select(
      "lead_time_product_id, b1_date, b2_date, b3_date, purchase_orders ( po_no, po_date )",
    );

  type Row = {
    lead_time_product_id: number | null;
    b1_date: string | null;
    b2_date: string | null;
    b3_date: string | null;
    purchase_orders: { po_no: string; po_date: string } | null;
  };

  const seen = new Set<string>(); // dedupe to one row per (product, po_no)
  const map = new Map<number, MeasuredDelivery[]>();
  for (const r of (data ?? []) as unknown as Row[]) {
    if (r.lead_time_product_id === null || !r.purchase_orders) continue;
    const dedupeKey = `${r.lead_time_product_id}:${r.purchase_orders.po_no}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const deliveredDate = resolveDeliveredDate(
      { b1: r.b1_date, b2: r.b2_date, b3: r.b3_date },
      firstDeliveryOnly,
    );
    const list = map.get(r.lead_time_product_id) ?? [];
    list.push({ poNo: r.purchase_orders.po_no, poDate: r.purchase_orders.po_date, deliveredDate });
    map.set(r.lead_time_product_id, list);
  }
  return map;
}

export interface UnmappedProductRow {
  productId: number;
  canonicalName: string;
  poCount: number;
}

/** Products that show up in PO history (so they clearly need restocking/lead-time attention) but have no row in `lead_times` at all - "using default", flagged per the brief. */
export async function fetchProductsUsingDefault(
  supabase: SupabaseClient,
  estimatesByProduct: Map<number, LeadTimeEstimateRow[]>,
): Promise<UnmappedProductRow[]> {
  const { data } = await supabase
    .from("purchase_order_lines")
    .select("lead_time_product_id, lead_time_products ( canonical_name ), po_id");

  type Row = {
    lead_time_product_id: number | null;
    lead_time_products: { canonical_name: string } | null;
    po_id: number;
  };

  const poCountByProduct = new Map<number, Set<number>>();
  const nameByProduct = new Map<number, string>();
  for (const r of (data ?? []) as unknown as Row[]) {
    if (r.lead_time_product_id === null) continue;
    if (!poCountByProduct.has(r.lead_time_product_id)) poCountByProduct.set(r.lead_time_product_id, new Set());
    poCountByProduct.get(r.lead_time_product_id)!.add(r.po_id);
    if (r.lead_time_products) nameByProduct.set(r.lead_time_product_id, r.lead_time_products.canonical_name);
  }

  const result: UnmappedProductRow[] = [];
  for (const [productId, poIds] of poCountByProduct) {
    if (estimatesByProduct.has(productId)) continue;
    result.push({ productId, canonicalName: nameByProduct.get(productId) ?? `#${productId}`, poCount: poIds.size });
  }
  return result.sort((a, b) => b.poCount - a.poCount);
}

export interface RawNameMappingRow {
  id: number;
  rawName: string;
  leadTimeProductId: number | null;
  canonicalName: string | null;
  autoCreated: boolean;
  note: string | null;
}

export async function fetchNameMappings(supabase: SupabaseClient): Promise<RawNameMappingRow[]> {
  const { data } = await supabase
    .from("lead_time_name_mappings")
    .select("id, raw_name, lead_time_product_id, auto_created, note, lead_time_products ( canonical_name )")
    .order("raw_name");

  type Row = {
    id: number;
    raw_name: string;
    lead_time_product_id: number | null;
    auto_created: boolean;
    note: string | null;
    lead_time_products: { canonical_name: string } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    rawName: r.raw_name,
    leadTimeProductId: r.lead_time_product_id,
    canonicalName: r.lead_time_products?.canonical_name ?? null,
    autoCreated: r.auto_created,
    note: r.note,
  }));
}

export interface PurchaseOrderRow {
  id: number;
  poNo: string;
  poDate: string;
  manualEtaDate: string | null;
  manualEtaNote: string | null;
  productIds: number[];
}

export async function fetchPurchaseOrders(supabase: SupabaseClient): Promise<PurchaseOrderRow[]> {
  const { data } = await supabase
    .from("purchase_orders")
    .select("id, po_no, po_date, manual_eta_date, manual_eta_note, purchase_order_lines ( lead_time_product_id )")
    .order("po_date", { ascending: false });

  type Row = {
    id: number;
    po_no: string;
    po_date: string;
    manual_eta_date: string | null;
    manual_eta_note: string | null;
    purchase_order_lines: { lead_time_product_id: number | null }[];
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    poNo: r.po_no,
    poDate: r.po_date,
    manualEtaDate: r.manual_eta_date,
    manualEtaNote: r.manual_eta_note,
    productIds: Array.from(
      new Set(r.purchase_order_lines.map((l) => l.lead_time_product_id).filter((id): id is number => id !== null)),
    ),
  }));
}

/** Convenience: resolveProductLeadTime for every product that has either an estimate or measured history, keyed by product id - what the comparison view (estimated vs. measured) and the restock integration both read. */
export function resolveAllProducts(
  products: { id: number }[],
  estimatesByProduct: Map<number, LeadTimeEstimateRow[]>,
  measuredByProduct: Map<number, MeasuredDelivery[]>,
  settings: LeadTimeSettings,
): Map<number, LeadTimeRange> {
  const result = new Map<number, LeadTimeRange>();
  for (const p of products) {
    result.set(
      p.id,
      resolveProductLeadTime(estimatesByProduct.get(p.id) ?? [], measuredByProduct.get(p.id) ?? [], settings),
    );
  }
  return result;
}
