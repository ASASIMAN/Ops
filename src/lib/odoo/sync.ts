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
  fetchProductCosts,
  fetchStockQuants,
  TRACKED_STOCK_LOCATIONS,
} from "./stock";
import { readCustomers, readLoyalty, readOrderCustomers, readPartnerLoyalty } from "./loyalty";

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

/** "ASASI. PERERENAN" and "ASASI Pererenan" -> "asasipererenan". */
function storeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
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
    .insert({ status: "running", sync_type: "sales" })
    .select()
    .single();

  try {
    if (refreshCatalog) {
      const stores = await fetchStores();
      const existing = await selectAllPages<{
        odoo_pos_config_id: number | null;
        name: string;
        active: boolean;
      }>((a, b) =>
        supabase
          .from("stores")
          .select("odoo_pos_config_id, name, active")
          .order("id")
          .range(a, b),
      );
      const known = new Set(existing.map((r) => r.odoo_pos_config_id));
      const activeNames = new Set(
        existing.filter((r) => r.active).map((r) => storeNameKey(r.name)),
      );
      // Known configs: refresh the name only (active/slug are set in the app).
      const { error: knownError } = await supabase.from("stores").upsert(
        stores
          .filter((s) => known.has(s.id))
          .map((s) => ({ odoo_pos_config_id: s.id, name: s.name })),
        { onConflict: "odoo_pos_config_id" },
      );
      if (knownError) throw new Error(`Upsert into stores failed: ${knownError.message}`);
      // New configs: one that is another POS config for a store already
      // listed (same name - e.g. the old company's "ASASI Pererenan" next to
      // "ASASI. PERERENAN") comes in inactive, so it adds no duplicate to
      // the store filters; its orders are moved onto that store below. A
      // config archived in Odoo comes in inactive too.
      const fresh = stores.filter((s) => !known.has(s.id));
      if (fresh.length) {
        const { error } = await supabase.from("stores").insert(
          fresh.map((s) => ({
            odoo_pos_config_id: s.id,
            name: s.name,
            active: s.active && !activeNames.has(storeNameKey(s.name)),
          })),
        );
        if (error) throw new Error(`Insert into stores failed: ${error.message}`);
      }

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
      name: string;
      active: boolean;
      slug: string | null;
    }>((a, b) =>
      supabase
        .from("stores")
        .select("id, odoo_pos_config_id, name, active, slug")
        .order("id")
        .range(a, b),
    );
    const categoryRows = await selectAllPages<{ id: number; odoo_id: number }>(
      (a, b) =>
        supabase.from("product_categories").select("id, odoo_id").range(a, b),
    );

    // An inactive config without a slug whose name matches exactly one live
    // store (ignoring case, spaces and punctuation) is an old or duplicate
    // POS config for that store - its orders count toward the live store,
    // so per-store views include sales from before the company change.
    const liveStoreIdsByName = new Map<string, number[]>();
    for (const s of storeRows) {
      if (!s.active) continue;
      const key = storeNameKey(s.name);
      liveStoreIdsByName.set(key, [...(liveStoreIdsByName.get(key) ?? []), s.id]);
    }
    const storeIdByOdooId = new Map(
      storeRows.map((s) => {
        const live = liveStoreIdsByName.get(storeNameKey(s.name));
        const target = !s.active && !s.slug && live?.length === 1 ? live[0] : s.id;
        return [s.odoo_pos_config_id, target];
      }),
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
    // orders.odoo_partner_id arrives with migration 0041. Until that's run,
    // leave it out rather than fail the whole sales sync over one column.
    const hasPartnerColumn = !(
      await supabase.from("orders").select("odoo_partner_id").limit(1)
    ).error;
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
        ...(hasPartnerColumn ? { odoo_partner_id: o.partnerOdooId } : {}),
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

    // Paged: more products than the API's 1000-row page would otherwise
    // leave every product past the first 1000 without stock.
    const productRows: { id: number; odoo_product_id: number }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error } = await supabase
        .from("products")
        .select("id, odoo_product_id")
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error(`Reading products failed: ${error.message}`);
      productRows.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }
    const productIdByOdooId = new Map(
      productRows.map((p) => [p.odoo_product_id, p.id]),
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
    const levels = Array.from(qtyByKey.values());
    const CHUNK = 500;
    for (let i = 0; i < levels.length; i += CHUNK) {
      const { error } = await supabase.from("stock_levels").upsert(
        levels.slice(i, i + CHUNK).map((v) => ({
          product_id: v.productId,
          location_id: v.locationId,
          qty_on_hand: v.qty,
          synced_at: syncedAt,
        })),
        { onConflict: "product_id,location_id" },
      );
      if (error) throw new Error(`Saving stock levels failed: ${error.message}`);
    }

    // A product+location Odoo no longer reports has no stock there now
    // (Odoo drops the quant at zero) - zero it rather than leave the last
    // synced qty standing.
    // Skipped when Odoo returned nothing at all, which is far more likely a
    // failed read than every location being empty.
    if (levels.length) {
      const { error } = await supabase
        .from("stock_levels")
        .update({ qty_on_hand: 0, synced_at: syncedAt })
        .lt("synced_at", syncedAt)
        .neq("qty_on_hand", 0);
      if (error) throw new Error(`Clearing stale stock levels failed: ${error.message}`);
    }

    // Also appends today's position to stock_level_history (migration
    // 0029) - stock_levels above is overwritten in place and was never
    // meant to answer "was this in stock on day X"; this is the one
    // place that history starts accumulating from. One row per
    // product+location+day: a second sync later the same day overwrites
    // today's row rather than duplicating it. Not fatal if that table
    // isn't there yet.
    const snapshotDate = syncedAt.slice(0, 10);
    for (let i = 0; i < levels.length; i += CHUNK) {
      await supabase.from("stock_level_history").upsert(
        levels.slice(i, i + CHUNK).map((v) => ({
          product_id: v.productId,
          location_id: v.locationId,
          qty_on_hand: v.qty,
          snapshot_date: snapshotDate,
        })),
        { onConflict: "product_id,location_id,snapshot_date" },
      );
    }

    // Budget planner (migration 0046): how long stock has been sitting,
    // and each product's cost price. Neither is fatal - the migration may
    // not be run yet, or Odoo may not expose them to this API user.
    const lotAgesSynced = await saveStockLotAges(supabase, quants, productIdByOdooId, locationIdByOdooId, syncedAt);
    const costsUpdated = await saveProductCosts(supabase);

    await supabase
      .from("sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        orders_synced: 0,
      })
      .eq("id", run!.id);

    return { locationsSynced: odooLocations.length, quantsSynced: qtyByKey.size, lotAgesSynced, costsUpdated };
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
 * Stock by arrival day (stock.quant in_date) for the budget planner's
 * "old stock" flag, replacing what was there. Returns rows saved; 0 when
 * Odoo has no arrival dates or migration 0046 isn't run.
 */
async function saveStockLotAges(
  supabase: ReturnType<typeof createAdminClient>,
  quants: Awaited<ReturnType<typeof fetchStockQuants>>,
  productIdByOdooId: Map<number, number>,
  locationIdByOdooId: Map<number, number>,
  syncedAt: string,
): Promise<number> {
  const byKey = new Map<string, { product_id: number; location_id: number; received_on: string; qty: number }>();
  for (const q of quants) {
    if (!q.in_date || !(q.quantity > 0)) continue;
    const productId = productIdByOdooId.get(q.product_id[0]);
    const locationId = locationIdByOdooId.get(q.location_id[0]);
    if (!productId || !locationId) continue;
    const receivedOn = String(q.in_date).slice(0, 10);
    const key = `${productId}:${locationId}:${receivedOn}`;
    const row = byKey.get(key);
    if (row) row.qty += q.quantity;
    else byKey.set(key, { product_id: productId, location_id: locationId, received_on: receivedOn, qty: q.quantity });
  }
  if (!byKey.size) return 0;
  const rows = [...byKey.values()].map((r) => ({ ...r, synced_at: syncedAt }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("stock_lot_ages")
      .upsert(rows.slice(i, i + 500), { onConflict: "product_id,location_id,received_on" });
    if (error) {
      console.error("[stock sync] stock ages not saved (run migration 0046?):", error.message);
      return 0;
    }
  }
  await supabase.from("stock_lot_ages").delete().lt("synced_at", syncedAt);
  return rows.length;
}

/** Cost prices onto products. Returns how many changed; 0 when unreadable or migration 0046 isn't run. */
async function saveProductCosts(supabase: ReturnType<typeof createAdminClient>): Promise<number> {
  const probe = await supabase.from("products").select("cost_price").limit(1);
  if (probe.error) return 0;
  const costs = await fetchProductCosts();
  if (!costs?.size) return 0;
  const { data, error } = await supabase.rpc("set_product_costs", {
    // Odoo reports 0 for "no cost entered" - that's unknown, not free.
    p_costs: [...costs].map(([id, cost]) => ({ id, cost: cost > 0 ? cost : null })),
  });
  if (error) {
    console.error("[stock sync] product costs not saved:", error.message);
    return 0;
  }
  return Number(data) || 0;
}

/**
 * Mirrors Odoo's POS loyalty into the app (migration 0041): every
 * customer's points per programme, their name and contact details, and
 * which customer each synced POS order belongs to. Then links app sign-ups
 * to their Odoo customer (by email, then phone - unambiguous matches only).
 *
 * Read-only towards Odoo. Points are replaced wholesale each run, since
 * Odoo's balance is the record: a card Odoo no longer reports is removed.
 */
export async function runLoyaltySync({ backfillOrders = false }: { backfillOrders?: boolean } = {}) {
  const supabase = createAdminClient();

  const { data: run, error: runError } = await supabase
    .from("sync_runs")
    .insert({ status: "running", sync_type: "loyalty" })
    .select()
    .single();
  if (runError) {
    throw new Error(
      /check constraint|sync_type/i.test(runError.message)
        ? "Run supabase/migrations/0041_odoo_loyalty.sql first - the loyalty tables aren't set up yet."
        : `Couldn't start the loyalty sync: ${runError.message}`,
    );
  }

  try {
    const { programs, cards } = await readLoyalty();
    const now = new Date().toISOString();

    // The sales sync records the customer on every order it brings in. Orders
    // synced before that (migration 0041) get theirs here - a pass over every
    // Odoo order that had a customer, so it's only run when asked for (the
    // "Sync from Odoo" button), not on the daily cron with its time limit.
    let ordersLinked = 0;
    if (backfillOrders) {
      const orderCustomers = await readOrderCustomers();
      for (let i = 0; i < orderCustomers.length; i += PAGE) {
        const { data, error } = await supabase.rpc("set_order_partners", {
          p_pairs: orderCustomers.slice(i, i + PAGE).map(([o, p]) => ({ o, p })),
        });
        if (error) throw new Error(`Linking orders to customers failed: ${error.message}`);
        ordersLinked += Number(data ?? 0);
      }
    }
    const orderPartners = await selectAllPages<{ odoo_partner_id: number }>((a, b) =>
      supabase.rpc("order_customer_ids").order("odoo_partner_id").range(a, b),
    );

    // Customers: everyone with a card, plus everyone attached to an order.
    const partnerIds = [
      ...new Set([...cards.map((c) => c.partnerId), ...orderPartners.map((r) => r.odoo_partner_id)]),
    ];
    const customers = await readCustomers(partnerIds);
    await upsertInBatches(
      supabase,
      "odoo_customers",
      customers.map((c) => ({
        odoo_partner_id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        synced_at: now,
      })),
      "odoo_partner_id",
    );

    await upsertInBatches(
      supabase,
      "loyalty_programs",
      programs.map((p) => ({
        odoo_program_id: p.id,
        name: p.name,
        point_name: p.pointName,
        synced_at: now,
      })),
      "odoo_program_id",
    );

    const knownPartners = new Set(customers.map((c) => c.id));
    const cardRows = cards
      .filter((c) => knownPartners.has(c.partnerId))
      .map((c) => ({
        odoo_card_id: c.id,
        odoo_partner_id: c.partnerId,
        odoo_program_id: c.programId,
        code: c.code,
        points: c.points,
        expiration_date: c.expirationDate,
        synced_at: now,
      }));
    await upsertInBatches(supabase, "loyalty_cards", cardRows, "odoo_card_id");
    // Anything not touched this run is gone from Odoo (card deleted, or
    // its programme archived): drop it so its points stop counting.
    const { error: pruneError } = await supabase
      .from("loyalty_cards")
      .delete()
      .lt("synced_at", now);
    if (pruneError) throw new Error(`Clearing old loyalty cards failed: ${pruneError.message}`);
    // Same for programmes Odoo no longer reports as active loyalty programmes.
    const { error: programPruneError } = await supabase
      .from("loyalty_programs")
      .delete()
      .lt("synced_at", now);
    if (programPruneError) throw new Error(`Clearing old loyalty programmes failed: ${programPruneError.message}`);

    const { data: membersLinked, error: linkError } = await supabase.rpc("link_members_to_odoo");
    if (linkError) throw new Error(`Matching app members to Odoo failed: ${linkError.message}`);

    await supabase
      .from("sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        orders_synced: cardRows.length,
      })
      .eq("id", run.id);

    return {
      cards: cardRows.length,
      customers: customers.length,
      ordersLinked,
      membersLinked: Number(membersLinked ?? 0),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await supabase
      .from("sync_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("id", run.id);
    throw error;
  }
}

const PARTNER_REFRESH_EVERY_MS = 5 * 60 * 1000;
const PARTNER_REFRESH_TIMEOUT_MS = 4000;

/**
 * Brings one customer's loyalty cards up to date from Odoo (members portal).
 * Skipped if they were refreshed in the last few minutes, and given only a
 * few seconds: if Odoo is slow or down, the member just sees the balance
 * from the last sync instead of waiting. Returns when their cards were last
 * brought up to date, or null if they never have been.
 */
export async function refreshPartnerLoyalty(partnerId: number): Promise<string | null> {
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("loyalty_cards")
    .select("synced_at")
    .eq("odoo_partner_id", partnerId)
    .order("synced_at", { ascending: false })
    .limit(1);
  const lastSynced = existing?.[0]?.synced_at ?? null;
  if (lastSynced && Date.now() - new Date(lastSynced).getTime() < PARTNER_REFRESH_EVERY_MS) return lastSynced;

  try {
    const work = (async () => {
      const { data: programs } = await supabase.from("loyalty_programs").select("odoo_program_id");
      const programIds = (programs ?? []).map((p) => p.odoo_program_id as number);
      const cards = await readPartnerLoyalty(partnerId, programIds);
      const now = new Date().toISOString();
      if (cards.length) {
        const { error } = await supabase.from("loyalty_cards").upsert(
          cards.map((c) => ({
            odoo_card_id: c.id,
            odoo_partner_id: partnerId,
            odoo_program_id: programIds.includes(c.programId ?? -1) ? c.programId : null,
            code: c.code,
            points: c.points,
            synced_at: now,
          })),
          { onConflict: "odoo_card_id" },
        );
        if (error) throw new Error(error.message);
      }
      await supabase.from("loyalty_cards").delete().eq("odoo_partner_id", partnerId).lt("synced_at", now);
      return now;
    })();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Odoo took too long")), PARTNER_REFRESH_TIMEOUT_MS),
    );
    return await Promise.race([work, timeout]);
  } catch (error) {
    console.warn(`Live points refresh for Odoo customer ${partnerId} skipped:`, error instanceof Error ? error.message : error);
    return lastSynced;
  }
}
