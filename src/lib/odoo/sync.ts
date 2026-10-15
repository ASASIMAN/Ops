import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchCategories,
  fetchOrderLines,
  fetchOrders,
  fetchProducts,
  fetchStores,
} from "./sales";

/**
 * Pulls recent sales data from Odoo and upserts it into Supabase. Shared by
 * the cron-triggered route (`/api/sync/odoo`) and the dashboard's "Sync
 * now" button, so there's exactly one place this logic lives.
 */
export async function runOdooSync(days: number) {
  const dateTo = new Date();
  const dateFrom = new Date(dateTo.getTime() - days * 24 * 60 * 60 * 1000);
  return runOdooSyncRange(dateFrom, dateTo);
}

type Supabase = ReturnType<typeof createAdminClient>;

// PostgREST returns at most 1000 rows per request and rejects very long
// `in (...)` URLs, so lookups over a whole table / a big id list are paged.
const PAGE = 1000;
const IN_BATCH = 200;

async function selectAllPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    all.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return all;
  }
}

async function upsertInBatches(
  supabase: Supabase,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
) {
  for (let i = 0; i < rows.length; i += PAGE) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(i, i + PAGE), { onConflict });
    if (error) throw new Error(`Upsert into ${table} failed: ${error.message}`);
  }
}

/**
 * Syncs orders in [dateFrom, dateTo). The catalogue (stores, categories,
 * products) is refreshed too unless `refreshCatalog` is false - a multi-chunk
 * history load only needs that once, on its first chunk.
 */
export async function runOdooSyncRange(
  dateFrom: Date,
  dateTo: Date,
  { refreshCatalog = true }: { refreshCatalog?: boolean } = {},
) {
  const supabase = createAdminClient();

  const { data: run } = await supabase
    .from("sync_runs")
    .insert({ status: "running" })
    .select()
    .single();

  try {
    if (refreshCatalog) {
      const stores = await fetchStores();
      await supabase.from("stores").upsert(
        stores.map((s) => ({ odoo_pos_config_id: s.id, name: s.name })),
        { onConflict: "odoo_pos_config_id" },
      );

      const categories = await fetchCategories();
      await supabase.from("product_categories").upsert(
        categories.map((c) => ({
          odoo_id: c.id,
          name: c.name,
          parent_odoo_id: c.parent_id ? c.parent_id[0] : null,
        })),
        { onConflict: "odoo_id" },
      );
    }

    const storeRows = await selectAllPages<{
      id: number;
      odoo_pos_config_id: number;
    }>((a, b) =>
      supabase.from("stores").select("id, odoo_pos_config_id").range(a, b),
    );
    const categoryRows = await selectAllPages<{ id: number; odoo_id: number }>(
      (a, b) =>
        supabase.from("product_categories").select("id, odoo_id").range(a, b),
    );

    const storeIdByOdooId = new Map(
      storeRows.map((s) => [s.odoo_pos_config_id, s.id]),
    );
    const categoryIdByOdooId = new Map(
      categoryRows.map((c) => [c.odoo_id, c.id]),
    );

    // Order lines link to products by id, so the product table must exist
    // before them. A history chunk after the first reuses what's there.
    if (refreshCatalog) {
      const products = await fetchProducts();
      await upsertInBatches(
        supabase,
        "products",
        products.map((p) => ({
          odoo_product_id: p.odooProductId,
          odoo_template_id: p.odooTemplateId,
          name: p.name,
          sku: p.sku,
          category_id: p.categoryOdooId
            ? (categoryIdByOdooId.get(p.categoryOdooId) ?? null)
            : null,
          color: p.color,
          size: p.size,
          variant_type: p.variantType,
          variant_attributes: p.variantAttributes,
          list_price: p.listPrice,
        })),
        "odoo_product_id",
      );
    }

    const productRows = await selectAllPages<{
      id: number;
      odoo_product_id: number;
    }>((a, b) =>
      supabase.from("products").select("id, odoo_product_id").range(a, b),
    );
    const productIdByOdooId = new Map(
      productRows.map((p) => [p.odoo_product_id, p.id]),
    );

    const orders = await fetchOrders(
      dateFrom.toISOString(),
      dateTo.toISOString(),
    );
    await upsertInBatches(
      supabase,
      "orders",
      orders.map((o) => ({
        odoo_order_id: o.odooOrderId,
        store_id: o.storeOdooId
          ? (storeIdByOdooId.get(o.storeOdooId) ?? null)
          : null,
        order_date: o.orderDate,
        pos_reference: o.posReference,
        state: o.state,
        total_amount: o.totalAmount,
      })),
      "odoo_order_id",
    );

    const orderIdByOdooId = new Map<number, number>();
    for (let i = 0; i < orders.length; i += IN_BATCH) {
      const { data, error } = await supabase
        .from("orders")
        .select("id, odoo_order_id")
        .in(
          "odoo_order_id",
          orders.slice(i, i + IN_BATCH).map((o) => o.odooOrderId),
        );
      if (error) throw new Error(`Supabase read failed: ${error.message}`);
      for (const o of data ?? []) orderIdByOdooId.set(o.odoo_order_id, o.id);
    }

    const lines = await fetchOrderLines(orders.map((o) => o.odooOrderId));
    await upsertInBatches(
      supabase,
      "order_lines",
      lines.map((l) => ({
        odoo_line_id: l.odooLineId,
        order_id: orderIdByOdooId.get(l.odooOrderId),
        product_id: productIdByOdooId.get(l.odooProductId) ?? null,
        qty: l.qty,
        unit_price: l.unitPrice,
        discount_percent: l.discountPercent,
        subtotal: l.subtotal,
      })),
      "odoo_line_id",
    );

    await supabase
      .from("sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        orders_synced: orders.length,
      })
      .eq("id", run!.id);

    return { ordersSynced: orders.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await supabase
      .from("sync_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("id", run!.id);

    throw error;
  }
}
