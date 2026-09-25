import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchCategories,
  fetchOrderLines,
  fetchOrders,
  fetchProducts,
  fetchStores,
} from "./sales";
import {
  fetchStockLocations,
  fetchStockQuants,
  TRACKED_STOCK_LOCATIONS,
} from "./stock";

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
    .insert({ status: "running", sync_type: "sales" })
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
        variant_type: p.variantType,
        variant_attributes: p.variantAttributes,
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

/**
 * Pulls current on-hand stock from Odoo (office + each tracked store
 * location - see TRACKED_STOCK_LOCATIONS) and replaces `stock_levels` in
 * place. Shares `sync_runs` with the sales sync (distinguished by
 * `sync_type`) so both show up in the same "last sync" history.
 *
 * Unlike sales, stock.quant is a live snapshot with no useful date
 * range - this always syncs the current position, there's no `days`
 * parameter.
 */
export async function runStockSync() {
  const supabase = createAdminClient();

  const { data: run } = await supabase
    .from("sync_runs")
    .insert({ status: "running", sync_type: "stock" })
    .select()
    .single();

  try {
    const odooLocations = await fetchStockLocations();
    const locationBySlugOrKind = new Map(
      TRACKED_STOCK_LOCATIONS.map((l) => [l.completeName, l]),
    );

    const { data: storeRows } = await supabase
      .from("stores")
      .select("id, slug");
    const storeIdBySlug = new Map(
      (storeRows ?? [])
        .filter((s) => s.slug)
        .map((s) => [s.slug as string, s.id]),
    );

    await supabase.from("stock_locations").upsert(
      odooLocations.map((loc) => {
        const tracked = locationBySlugOrKind.get(loc.complete_name);
        return {
          odoo_location_id: loc.id,
          odoo_complete_name: loc.complete_name,
          kind: tracked?.kind ?? "store",
          store_id: tracked?.storeSlug
            ? (storeIdBySlug.get(tracked.storeSlug) ?? null)
            : null,
        };
      }),
      { onConflict: "odoo_location_id" },
    );

    const { data: locationRows } = await supabase
      .from("stock_locations")
      .select("id, odoo_location_id");
    const locationIdByOdooId = new Map(
      (locationRows ?? []).map((l) => [l.odoo_location_id, l.id]),
    );

    const { data: productRows } = await supabase
      .from("products")
      .select("id, odoo_product_id");
    const productIdByOdooId = new Map(
      (productRows ?? []).map((p) => [p.odoo_product_id, p.id]),
    );

    const quants = await fetchStockQuants(odooLocations.map((l) => l.id));

    // stock.quant rows come and go as Odoo merges/splits them - upserting
    // on the raw quant id would leave stale rows behind once a quant
    // disappears (e.g. qty hits exactly 0 and Odoo deletes it). Upsert on
    // our own (product_id, location_id) key instead, and sum any
    // duplicate quants Odoo reports for the same pair (lot/package-level
    // quants split the same product+location across multiple rows).
    const qtyByKey = new Map<string, { productId: number; locationId: number; qty: number }>();
    for (const q of quants) {
      const productId = productIdByOdooId.get(q.product_id[0]);
      const locationId = locationIdByOdooId.get(q.location_id[0]);
      if (!productId || !locationId) continue;
      const key = `${productId}:${locationId}`;
      const existing = qtyByKey.get(key);
      if (existing) {
        existing.qty += q.quantity;
      } else {
        qtyByKey.set(key, { productId, locationId, qty: q.quantity });
      }
    }

    const syncedAt = new Date().toISOString();
    await supabase.from("stock_levels").upsert(
      Array.from(qtyByKey.values()).map((v) => ({
        product_id: v.productId,
        location_id: v.locationId,
        qty_on_hand: v.qty,
        synced_at: syncedAt,
      })),
      { onConflict: "product_id,location_id" },
    );

    await supabase
      .from("sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        orders_synced: 0,
      })
      .eq("id", run!.id);

    return { locationsSynced: odooLocations.length, quantsSynced: qtyByKey.size };
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
