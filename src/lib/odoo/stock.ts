import { searchRead } from "./rpc";

// NOTE: field names below match standard Odoo Inventory (v16/17) - same
// caveat as sales.ts: verify against the live instance once connected.

/**
 * The stock locations this app tracks, given directly by the business
 * (see chat: "the [office] location id is asof/stock" and "stock quants
 * ... ASOF/Stock, PRN/Stock, CGU/Stock, UBD/Stock, NSA/Stock"), mapped to
 * the matching `stores.slug` (from migration 0003) or `"office"`.
 *
 * FLAGGED ASSUMPTION: this list has 4 store locations (Pererenan, Canggu,
 * Ubud, NSA) plus the office, but migration 0003 seeded *4 real* stores
 * including Nusa Dua ('nusa-dua') - a stock location for Nusa Dua was not
 * given. Nusa Dua is left unsynced (no stock_locations row) until its
 * location code is confirmed, rather than guessing a code for it. Its
 * sales still sync and forecast normally - only its stock levels, and
 * therefore its store-transfer/restock alerts, will be missing. Add its
 * entry here (and to the migration comment) once known.
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
  { completeName: "NSA/Stock", kind: "store", storeSlug: "nsa" },
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
  return searchRead<OdooStockQuant>(
    "stock.quant",
    [["location_id", "in", locationIds]],
    ["id", "product_id", "location_id", "quantity"],
  );
}
