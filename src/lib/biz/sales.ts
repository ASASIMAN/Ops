import type { SupabaseClient } from "@supabase/supabase-js";
import { buildStoreGroups, type StoreGroup } from "@/lib/sales/store-groups";
import { shortStoreName } from "./format";

/**
 * Data access for the dashboard and the Sales & Retail screens.
 *
 * Headline revenue / units / orders come from the SAME functions /operations
 * uses (ops_sales_totals, ops_sales_daily, ops_top_products), so the numbers
 * can never drift from the Sales explorer. The biz_* functions (migration
 * 0040) add the breakdowns those don't have. Every call returns a `Loaded`
 * so a screen can tell "no rows" from "couldn't load" from "the database
 * function isn't installed yet" and say which - never a silent zero.
 */

export type Loaded<T> =
  | { ok: true; data: T }
  | { ok: false; missing: boolean; error: string };

const MIGRATION = "supabase/migrations/0040_business_rollups.sql";
export const ROLLUPS_MIGRATION = MIGRATION;

function failed(error: { code?: string; message: string }): { ok: false; missing: boolean; error: string } {
  const missing =
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    error.code === "42883" ||
    error.code === "42P01" ||
    /could not find the (function|table)/i.test(error.message);
  return { ok: false, missing, error: error.message };
}

type Args = Record<string, unknown>;

async function rpcOne<T>(admin: SupabaseClient, fn: string, args: Args): Promise<Loaded<T | null>> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) return failed(error);
  const rows = (data ?? []) as T[];
  return { ok: true, data: rows[0] ?? null };
}

/** Reads every page - the API returns at most 1000 rows per call. `order` must fully determine row order so pages can't overlap. */
async function rpcAll<T>(admin: SupabaseClient, fn: string, args: Args, order: string[]): Promise<Loaded<T[]>> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = admin.rpc(fn, args);
    for (const column of order) query = query.order(column);
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) return failed(error);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return { ok: true, data: rows };
}

export interface Window {
  fromTs: string;
  toTs: string;
}

function windowArgs(w: Window, storeIds?: number[] | null): Args {
  return { p_from: w.fromTs, p_to: w.toTs, p_store_ids: storeIds?.length ? storeIds : null };
}

export interface Totals {
  revenue: number;
  units: number;
  orders: number;
}

export async function fetchTotals(admin: SupabaseClient, w: Window, storeIds?: number[] | null): Promise<Loaded<Totals>> {
  const res = await rpcOne<{ revenue: number; units: number; order_count: number }>(
    admin,
    "ops_sales_totals",
    windowArgs(w, storeIds),
  );
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      revenue: Number(res.data?.revenue ?? 0),
      units: Number(res.data?.units ?? 0),
      orders: Number(res.data?.order_count ?? 0),
    },
  };
}

export interface DailyPoint {
  day: string;
  revenue: number;
  units: number;
  orders: number;
}

export async function fetchDaily(
  admin: SupabaseClient,
  w: Window,
  storeIds?: number[] | null,
  /** Exact product (style) name, to chart one product. */
  productName?: string,
): Promise<Loaded<DailyPoint[]>> {
  const res = await rpcAll<{ day: string; revenue: number; units: number; order_count: number }>(
    admin,
    "ops_sales_daily",
    { ...windowArgs(w, storeIds), ...(productName ? { p_product_name: productName } : {}) },
    ["day"],
  );
  if (!res.ok) return res;
  return {
    ok: true,
    data: res.data.map((r) => ({
      day: r.day,
      revenue: Number(r.revenue),
      units: Number(r.units),
      orders: Number(r.order_count),
    })),
  };
}

export interface Extras {
  discountValue: number;
  discountedLines: number;
  redemptionValue: number;
  redemptionLines: number;
  returnUnits: number;
  returnValue: number;
  returnLines: number;
}

export async function fetchExtras(admin: SupabaseClient, w: Window, storeIds?: number[] | null): Promise<Loaded<Extras>> {
  const res = await rpcOne<Record<string, number>>(admin, "biz_sales_extras", windowArgs(w, storeIds));
  if (!res.ok) return res;
  const r = res.data ?? {};
  return {
    ok: true,
    data: {
      discountValue: Number(r.discount_value ?? 0),
      discountedLines: Number(r.discounted_lines ?? 0),
      redemptionValue: Number(r.redemption_value ?? 0),
      redemptionLines: Number(r.redemption_lines ?? 0),
      returnUnits: Number(r.return_units ?? 0),
      returnValue: Number(r.return_value ?? 0),
      returnLines: Number(r.return_lines ?? 0),
    },
  };
}

/** A physical shop: one or more Odoo POS registers folded together. */
export interface Shop extends StoreGroup {
  name: string;
}

export interface ShopSales {
  key: string;
  name: string;
  ids: number[];
  revenue: number;
  units: number;
  /** null when only the older rollup (without order counts) is installed. */
  orders: number | null;
}

/** Registers hidden from store pickers on /operations too: not a storefront. */
const HIDDEN_STORE_NAMES = new Set(["nsa", "clothes shop"]);

export async function fetchShops(admin: SupabaseClient): Promise<{ shops: Shop[]; shopByStoreId: Map<number, Shop> }> {
  const { data } = await admin.from("stores").select("id, name").order("name");
  const all = buildStoreGroups(data ?? []).map((g) => ({ ...g, name: shortStoreName(g.label) }));
  const shopByStoreId = new Map<number, Shop>();
  for (const g of all) for (const id of g.ids) shopByStoreId.set(id, g);
  const shops = all.filter((g) => !HIDDEN_STORE_NAMES.has(g.label.trim().toLowerCase()));
  return { shops, shopByStoreId };
}

function foldByShop<R extends { store_id: number | null; store_name?: string }>(
  rows: R[],
  shopByStoreId: Map<number, Shop>,
  add: (acc: ShopSales, row: R) => void,
): ShopSales[] {
  const out = new Map<string, ShopSales>();
  for (const row of rows) {
    const shop = row.store_id !== null ? shopByStoreId.get(row.store_id) : undefined;
    const key = shop?.key ?? `unassigned-${row.store_id ?? "none"}`;
    let acc = out.get(key);
    if (!acc) {
      acc = {
        key,
        name: shop?.name ?? shortStoreName(row.store_name ?? "Unassigned"),
        ids: shop?.ids ?? (row.store_id !== null ? [row.store_id] : []),
        revenue: 0,
        units: 0,
        orders: 0,
      };
      out.set(key, acc);
    }
    add(acc, row);
  }
  return [...out.values()].sort((a, b) => b.revenue - a.revenue);
}

export async function fetchSalesByShop(
  admin: SupabaseClient,
  w: Window,
  shopByStoreId: Map<number, Shop>,
): Promise<Loaded<ShopSales[]>> {
  type Row = { store_id: number | null; store_name: string; revenue: number; units: number; order_count?: number };
  let res = await rpcAll<Row>(admin, "biz_sales_by_store", { p_from: w.fromTs, p_to: w.toTs }, ["store_id"]);
  let hasOrders = true;
  if (!res.ok && res.missing) {
    // Before migration 0040 is run: the older rollup has revenue and units, just no order counts.
    res = await rpcAll<Row>(admin, "ops_sales_by_store", { p_from: w.fromTs, p_to: w.toTs }, ["store_id"]);
    hasOrders = false;
  }
  if (!res.ok) return res;
  const shops = foldByShop(res.data, shopByStoreId, (acc, row) => {
    acc.revenue += Number(row.revenue);
    acc.units += Number(row.units);
    if (hasOrders) acc.orders = (acc.orders ?? 0) + Number(row.order_count ?? 0);
  });
  if (!hasOrders) for (const s of shops) s.orders = null;
  return { ok: true, data: shops };
}

export interface ShopSeries {
  key: string;
  name: string;
  points: Map<string, { revenue: number; units: number; orders: number }>;
}

export async function fetchSeriesByShop(
  admin: SupabaseClient,
  w: Window,
  bucket: "day" | "week" | "month",
  shopByStoreId: Map<number, Shop>,
): Promise<Loaded<ShopSeries[]>> {
  const res = await rpcAll<{ bucket_date: string; store_id: number | null; revenue: number; units: number; order_count: number }>(
    admin,
    "biz_sales_series_by_store",
    { p_from: w.fromTs, p_to: w.toTs, p_bucket: bucket },
    ["bucket_date", "store_id"],
  );
  if (!res.ok) return res;
  const out = new Map<string, ShopSeries>();
  for (const row of res.data) {
    const shop = row.store_id !== null ? shopByStoreId.get(row.store_id) : undefined;
    const key = shop?.key ?? "unassigned";
    let series = out.get(key);
    if (!series) {
      series = { key, name: shop?.name ?? "Unassigned", points: new Map() };
      out.set(key, series);
    }
    const point = series.points.get(row.bucket_date) ?? { revenue: 0, units: 0, orders: 0 };
    point.revenue += Number(row.revenue);
    point.units += Number(row.units);
    point.orders += Number(row.order_count);
    series.points.set(row.bucket_date, point);
  }
  return { ok: true, data: [...out.values()] };
}

export interface CategorySales {
  id: number | null;
  name: string;
  revenue: number;
  units: number;
}

export async function fetchByCategory(admin: SupabaseClient, w: Window, storeIds?: number[] | null): Promise<Loaded<CategorySales[]>> {
  const res = await rpcAll<{ category_id: number | null; category_name: string; revenue: number; units: number }>(
    admin,
    "biz_sales_by_category",
    windowArgs(w, storeIds),
    ["category_id"],
  );
  if (!res.ok) return res;
  return {
    ok: true,
    data: res.data
      .map((r) => ({ id: r.category_id, name: r.category_name, revenue: Number(r.revenue), units: Number(r.units) }))
      .sort((a, b) => b.revenue - a.revenue),
  };
}

export interface ProductSales {
  templateId: number;
  name: string;
  category: string | null;
  units: number;
  revenue: number;
  orders: number;
  returnUnits: number;
}

export async function fetchByProduct(admin: SupabaseClient, w: Window, storeIds?: number[] | null): Promise<Loaded<ProductSales[]>> {
  const res = await rpcAll<{
    template_id: number;
    product_name: string;
    category_name: string | null;
    units: number;
    revenue: number;
    order_count: number;
    return_units: number;
  }>(admin, "biz_sales_by_product", windowArgs(w, storeIds), ["template_id"]);
  if (!res.ok) return res;
  return {
    ok: true,
    data: res.data
      .map((r) => ({
        templateId: r.template_id,
        name: r.product_name,
        category: r.category_name,
        units: Number(r.units),
        revenue: Number(r.revenue),
        orders: Number(r.order_count),
        returnUnits: Number(r.return_units),
      }))
      .sort((a, b) => b.revenue - a.revenue),
  };
}

export interface TopProduct {
  templateId: number;
  name: string;
  units: number;
  revenue: number;
}

/** Best sellers by units - the existing ranking /operations shows (redemption lines excluded). */
export async function fetchTopProducts(
  admin: SupabaseClient,
  w: Window,
  limit: number,
  storeIds?: number[] | null,
): Promise<Loaded<TopProduct[]>> {
  const { data, error } = await admin.rpc("ops_top_products", { ...windowArgs(w, storeIds), p_limit: limit });
  if (error) return failed(error);
  return {
    ok: true,
    data: ((data ?? []) as { template_id: number; product_name: string; units: number; revenue: number }[]).map((r) => ({
      templateId: r.template_id,
      name: r.product_name,
      units: Number(r.units),
      revenue: Number(r.revenue),
    })),
  };
}

export interface VariantSales {
  productId: number;
  sku: string | null;
  color: string | null;
  size: string | null;
  variantType: string | null;
  units: number;
  revenue: number;
}

/** Every colour/size of one style that sold in the window (the same ranking /operations shows). */
export async function fetchVariants(
  admin: SupabaseClient,
  w: Window,
  productName: string,
  storeIds?: number[] | null,
): Promise<Loaded<VariantSales[]>> {
  const { data, error } = await admin.rpc("ops_top_variants", {
    ...windowArgs(w, storeIds),
    p_product_name: productName,
    p_limit: 500,
  });
  if (error) return failed(error);
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      productId: Number(r.product_id),
      sku: (r.sku as string | null) ?? null,
      color: (r.color as string | null) ?? null,
      size: (r.size as string | null) ?? null,
      variantType: (r.variant_type as string | null) ?? null,
      units: Number(r.units),
      revenue: Number(r.revenue),
    })),
  };
}

export interface StockRow {
  productId: number;
  templateId: number;
  name: string;
  sku: string | null;
  color: string | null;
  size: string | null;
  category: string | null;
  listPrice: number | null;
  officeQty: number;
  storeQty: number;
  totalQty: number;
  byLocation: Record<string, number>;
  storesAtZero: number;
  unitsSold30d: number;
}

export type StockView = "all" | "in" | "out" | "store_out" | "low";

export async function fetchStockLevels(
  admin: SupabaseClient,
  opts: { search?: string; categoryId?: number | null; view: StockView; lowAt: number; limit: number; offset: number },
): Promise<Loaded<{ rows: StockRow[]; total: number }>> {
  const { data, error } = await admin.rpc("biz_stock_levels", {
    p_search: opts.search?.trim() || null,
    p_category_id: opts.categoryId ?? null,
    p_view: opts.view,
    p_low_at: opts.lowAt,
    p_limit: opts.limit,
    p_offset: opts.offset,
  });
  if (error) return failed(error);
  const raw = (data ?? []) as Record<string, unknown>[];
  return {
    ok: true,
    data: {
      total: raw.length ? Number(raw[0].total_rows) : 0,
      rows: raw.map((r) => ({
        productId: Number(r.product_id),
        templateId: Number(r.template_id),
        name: String(r.product_name),
        sku: (r.sku as string | null) ?? null,
        color: (r.color as string | null) ?? null,
        size: (r.size as string | null) ?? null,
        category: (r.category_name as string | null) ?? null,
        listPrice: r.list_price === null ? null : Number(r.list_price),
        officeQty: Number(r.office_qty),
        storeQty: Number(r.store_qty),
        totalQty: Number(r.total_qty),
        byLocation: Object.fromEntries(
          Object.entries((r.by_location ?? {}) as Record<string, number>).map(([k, v]) => [k, Number(v)]),
        ),
        storesAtZero: Number(r.stores_at_zero),
        unitsSold30d: Number(r.units_sold_30d),
      })),
    },
  };
}

export interface OpenPurchaseOrder {
  id: number;
  poNo: string;
  poDate: string;
  manualEtaDate: string | null;
  lines: number;
  ordered: number;
  received: number;
  open: number;
}

export async function fetchOpenPurchaseOrders(admin: SupabaseClient): Promise<Loaded<OpenPurchaseOrder[]>> {
  const res = await rpcAll<Record<string, unknown>>(admin, "biz_open_purchase_orders", {}, ["po_id"]);
  if (!res.ok) return res;
  return {
    ok: true,
    data: res.data
      .map((r) => ({
        id: Number(r.po_id),
        poNo: String(r.po_no),
        poDate: String(r.po_date),
        manualEtaDate: (r.manual_eta_date as string | null) ?? null,
        lines: Number(r.line_count),
        ordered: Number(r.qty_ordered),
        received: Number(r.qty_received),
        open: Number(r.qty_open),
      }))
      .sort((a, b) => b.poDate.localeCompare(a.poDate)),
  };
}

export interface LocationStock {
  locationId: number;
  locationName: string;
  kind: "office" | "store";
  storeId: number | null;
  storeName: string | null;
  units: number;
  retailValue: number;
  skusInStock: number;
  skusAtZero: number;
  syncedAt: string | null;
}

export async function fetchInventorySummary(admin: SupabaseClient): Promise<Loaded<LocationStock[]>> {
  const { data, error } = await admin.rpc("biz_inventory_summary");
  if (error) return failed(error);
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      locationId: Number(r.location_id),
      locationName: String(r.location_name),
      kind: r.kind as "office" | "store",
      storeId: r.store_id === null ? null : Number(r.store_id),
      storeName: (r.store_name as string | null) ?? null,
      units: Number(r.units),
      retailValue: Number(r.retail_value),
      skusInStock: Number(r.skus_in_stock),
      skusAtZero: Number(r.skus_at_zero),
      syncedAt: (r.synced_at as string | null) ?? null,
    })),
  };
}

export interface SlowMover {
  templateId: number;
  name: string;
  category: string | null;
  onHand: number;
  retailValue: number;
  unitsSold: number;
  lastSold: string | null;
}

export async function fetchSlowMovers(admin: SupabaseClient, days: number, limit: number): Promise<Loaded<SlowMover[]>> {
  const { data, error } = await admin.rpc("biz_slow_movers", { p_days: days, p_limit: limit });
  if (error) return failed(error);
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      templateId: Number(r.template_id),
      name: String(r.product_name),
      category: (r.category_name as string | null) ?? null,
      onHand: Number(r.on_hand),
      retailValue: Number(r.retail_value),
      unitsSold: Number(r.units_sold),
      lastSold: (r.last_sold as string | null) ?? null,
    })),
  };
}

export interface SyncStatus {
  status: string;
  startedAt: string;
}

export async function fetchLastSalesSync(admin: SupabaseClient): Promise<SyncStatus | null> {
  const { data } = await admin
    .from("sync_runs")
    .select("status, started_at, sync_type")
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(10);
  const run = (data ?? []).find((r) => (r.sync_type ?? "sales") === "sales");
  return run ? { status: run.status, startedAt: run.started_at } : null;
}

export interface CustomerMix {
  customers: number;
  returningCustomers: number;
  newCustomers: number;
  repeatCustomers: number;
  ordersWithCustomer: number;
  ordersTotal: number;
}

/** New vs returning customers, from POS orders that had a customer attached (migration 0041). */
export async function fetchCustomerMix(admin: SupabaseClient, w: Window): Promise<Loaded<CustomerMix>> {
  const res = await rpcOne<Record<string, number>>(admin, "biz_customer_mix", { p_from: w.fromTs, p_to: w.toTs });
  if (!res.ok) return res;
  const r = res.data ?? {};
  return {
    ok: true,
    data: {
      customers: Number(r.customers ?? 0),
      returningCustomers: Number(r.returning_customers ?? 0),
      newCustomers: Number(r.new_customers ?? 0),
      repeatCustomers: Number(r.repeat_customers ?? 0),
      ordersWithCustomer: Number(r.orders_with_customer ?? 0),
      ordersTotal: Number(r.orders_total ?? 0),
    },
  };
}
