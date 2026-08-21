import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchCategories,
  fetchOrderLines,
  fetchOrders,
  fetchProducts,
  fetchStores,
} from "@/lib/odoo/sales";

export const maxDuration = 60;

/**
 * Pulls recent sales data from Odoo and upserts it into Supabase.
 *
 * Protected by CRON_SECRET rather than user auth, since this is meant to be
 * called by Vercel's cron scheduler (or manually while testing), not a
 * browser. Vercel automatically sends `Authorization: Bearer $CRON_SECRET`
 * as a GET request on requests it makes to cron paths - set the CRON_SECRET
 * env var and vercel.json's cron entry picks it up with no extra wiring.
 * For a manual call (e.g. curl), send that same header yourself; POST works
 * too, for triggering from something other than Vercel's scheduler.
 * Pass ?days=N to control how far back to sync orders (default 2, to
 * comfortably overlap the previous run). A full historical backfill should
 * be run in smaller date windows to stay under the function time limit -
 * see README "Backfilling history".
 */
async function handleSync(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Number(request.nextUrl.searchParams.get("days") ?? "2");
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

    return NextResponse.json({ ok: true, ordersSynced: orders.length });
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

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handleSync;
export const POST = handleSync;
