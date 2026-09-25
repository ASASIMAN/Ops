import type { Period } from "./engine";

/**
 * Pure grouping helpers over `ops_period_demand` rows (migration 0023).
 * No I/O here - src/lib/forecast/data.ts fetches the rows, this file (and
 * ./engine) is all that ever needs to know how they're shaped into a
 * time series for a given rollup (company, per-store, per-category,
 * per-SKU).
 */
export interface DemandRow {
  product_id: number;
  store_id: number | null;
  category_id: number | null;
  bucket_date: string;
  units: number;
  revenue: number;
}

export type ValueField = "units" | "revenue";

/** One combined series across every row, ignoring product/store/category - the company-wide total. */
export function totalSeries(rows: DemandRow[], field: ValueField): Period[] {
  const byDate = new Map<string, number>();
  for (const r of rows) {
    byDate.set(r.bucket_date, (byDate.get(r.bucket_date) ?? 0) + r[field]);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ date, value }));
}

/** One series per distinct value of `keyFn(row)` - the building block for per-store, per-category, and per-SKU rollups. Rows whose key is null are dropped (e.g. no store assigned to the order). */
export function groupSeries<K>(
  rows: DemandRow[],
  keyFn: (row: DemandRow) => K | null,
  field: ValueField,
): Map<K, Period[]> {
  const buckets = new Map<K, Map<string, number>>();
  for (const r of rows) {
    const key = keyFn(r);
    if (key === null) continue;
    if (!buckets.has(key)) buckets.set(key, new Map());
    const byDate = buckets.get(key)!;
    byDate.set(r.bucket_date, (byDate.get(r.bucket_date) ?? 0) + r[field]);
  }

  const result = new Map<K, Period[]>();
  for (const [key, byDate] of buckets) {
    result.set(
      key,
      Array.from(byDate.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, value]) => ({ date, value })),
    );
  }
  return result;
}

/** Sum of a field across all rows in range - for "current period total" style numbers next to a forecast. */
export function sumField(rows: DemandRow[], field: ValueField): number {
  return rows.reduce((sum, r) => sum + r[field], 0);
}
