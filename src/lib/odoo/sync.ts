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

  const supabase = createAdminClient();

  const { data: run } = await supabase
    .from("sync_runs")
    .insert({ status: "running" })
    .select()
    .single();

  try {
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

    const { data: storeRows } = await supabase
      .from("stores")
      .select("id, odoo_pos_config_id");
    const { data: categoryRows } = await supabase
      .from("product_categories")
      .select("id, odoo_id");

    const storeIdByOdooId = new Map(
      (storeRows ?? []).map((s) => [s.odoo_pos_config_id, s.id]),
    );
    const categoryIdByOdooId = new Map(
      (categoryRows ?? []).map((c) => [c.odoo_id, c.id]),
    );

    const products = await fetchProducts();
    await supabase.from("products").upsert(
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
        list_price: p.listPrice,
      })),
      { onConflict: "odoo_product_id" },
    );

    const { data: productRows } = await supabase
      .from("products")
      .select("id, odoo_product_id");
    const productIdByOdooId = new Map(
      (productRows ?? []).map((p) => [p.odoo_product_id, p.id]),
    );

    const orders = await fetchOrders(
      dateFrom.toISOString(),
      dateTo.toISOString(),
    );
    await supabase.from("orders").upsert(
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
      { onConflict: "odoo_order_id" },
    );

    const { data: orderRows } = await supabase
      .from("orders")
      .select("id, odoo_order_id")
      .in(
        "odoo_order_id",
        orders.map((o) => o.odooOrderId),
      );
    const orderIdByOdooId = new Map(
      (orderRows ?? []).map((o) => [o.odoo_order_id, o.id]),
    );

    const lines = await fetchOrderLines(orders.map((o) => o.odooOrderId));
    await supabase.from("order_lines").upsert(
      lines.map((l) => ({
        odoo_line_id: l.odooLineId,
        order_id: orderIdByOdooId.get(l.odooOrderId),
        product_id: productIdByOdooId.get(l.odooProductId) ?? null,
        qty: l.qty,
        unit_price: l.unitPrice,
        discount_percent: l.discountPercent,
        subtotal: l.subtotal,
      })),
      { onConflict: "odoo_line_id" },
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
