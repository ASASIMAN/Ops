import { allCompaniesContext, executeKw, searchRead } from "./rpc";

// NOTE: field names below match standard Odoo Inventory (v16/17) - same
// caveat as sales.ts: verify against the live instance once connected.

/**
 * The stock locations this app tracks, given directly by the business
 * (see chat: the office location is "ASOF/Stock"; the store locations
 * are "PRN/Stock", "CGU/Stock", "UBD/Stock", "NSA/Stock" - confirmed
 * "NSA/Stock" is Nusa Dua's location, not the pre-opening "NSA" store
 * seeded in migration 0003), mapped to the matching `stores.slug` or
 * `"office"`.
 *
 * This covers the office plus all 4 real stores (Pererenan, Canggu,
 * Ubud, Nusa Dua). The pre-opening store (slug 'nsa', not yet trading)
 * has no stock location here, which is expected - it hasn't received
 * stock yet.
 */
export const TRACKED_STOCK_LOCATIONS: {
  completeName: string;
  kind: "office" | "store";
  storeSlug: string | null; // null for the office; matched against stores.slug for a store
}[] = [
  { completeName: "ASOF/Stock", kind: "office", storeSlug: null },
  { completeName: "PRN/Stock", kind: "store", storeSlug: "pererenan" },
  { completeName: "CGU/Stock", kind: "store", storeSlug: "canggu" },
  { completeName: "UBD/Stock", kind: "store", storeSlug: "ubud" },
  { completeName: "NSA/Stock", kind: "store", storeSlug: "nusa-dua" },
];

export interface OdooStockLocation {
  id: number;
  complete_name: string;
}

export async function fetchStockLocations(): Promise<OdooStockLocation[]> {
  const names = TRACKED_STOCK_LOCATIONS.map((l) => l.completeName);
  return searchRead<OdooStockLocation>(
    "stock.location",
    [["complete_name", "in", names]],
    ["id", "complete_name"],
  );
}

export interface OdooStockQuant {
  id: number;
  product_id: [number, string];
  location_id: [number, string];
  quantity: number;
  /** When this stock arrived at the location (Odoo 12+); false/absent when unknown. */
  in_date?: string | false;
}

/**
 * Current on-hand qty per product at each of the given locations.
 * `quantity` is gross on-hand (not netted against `reserved_quantity`) -
 * see the comment on stock_levels in migration 0023 for why.
 */
export async function fetchStockQuants(
  locationIds: number[],
): Promise<OdooStockQuant[]> {
  if (!locationIds.length) return [];
  // in_date (when the stock arrived) feeds the budget planner's "old stock"
  // flag. Read only when this Odoo has it, so an older version still syncs.
  const available = await executeKw<Record<string, unknown>>("stock.quant", "fields_get", [["in_date"]], {
    attributes: ["type"],
  }).catch(() => ({}) as Record<string, unknown>);
  return searchRead<OdooStockQuant>(
    "stock.quant",
    [["location_id", "in", locationIds]],
    ["id", "product_id", "location_id", "quantity", ...("in_date" in available ? ["in_date"] : [])],
  );
}

/**
 * Each variant's cost price (product.product.standard_price), keyed by
 * Odoo product id. null when it can't be read (the API user may lack
 * access to costs) - the caller carries on without costs rather than
 * failing the sync.
 */
export async function fetchProductCosts(): Promise<Map<number, number> | null> {
  try {
    // Same reach as the product sync: every company the API user can see,
    // archived variants included, so older products get their cost too.
    const rows = await searchRead<{ id: number; standard_price: number }>(
      "product.product",
      [],
      ["id", "standard_price"],
      { context: await allCompaniesContext({ active_test: false }) },
    );
    return new Map(rows.map((r) => [r.id, Number(r.standard_price) || 0]));
  } catch (error) {
    console.error("[stock sync] product costs not readable:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Each variant's "Available in POS" flag (from its template) and whether
 * it's archived, keyed by Odoo product id. Same reach as the product sync.
 * null when it can't be read - the caller carries on without it.
 */
export async function fetchProductPosFlags(): Promise<Map<number, { pos: boolean; active: boolean }> | null> {
  try {
    const rows = await searchRead<{ id: number; available_in_pos: boolean; active: boolean }>(
      "product.product",
      [],
      ["id", "available_in_pos", "active"],
      { context: await allCompaniesContext({ active_test: false }) },
    );
    return new Map(rows.map((r) => [r.id, { pos: !!r.available_in_pos, active: !!r.active }]));
  } catch (error) {
    console.error("[sync] POS availability not readable:", error instanceof Error ? error.message : error);
    return null;
  }
}
