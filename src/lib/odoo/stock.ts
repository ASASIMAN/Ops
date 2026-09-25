import { searchRead } from "./rpc";

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
