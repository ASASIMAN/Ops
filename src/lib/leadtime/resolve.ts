/**
 * The ETA priority resolver (pure - no Supabase here, src/lib/leadtime/data.ts
 * does the fetching). Priority, most specific first, per the brief:
 *
 *   1. A manual ETA entered directly on the PO.
 *   2. Measured lead time - once a product has >= `measuredMinPoCount`
 *      POs with real delivery dates, use the observed min/max instead of
 *      anyone's estimate.
 *   3. This product's row(s) in `lead_times` (vendor estimate or a
 *      standing manual override, not tied to one PO).
 *   4. The global default range.
 *
 * A single-point estimate (min_days = max_days) gets a configurable
 * late-end buffer applied to its high end for alerting - a measured or
 * already-ranged estimate doesn't need one, it already reflects real
 * variability.
 */

export interface LeadTimeSettings {
  lateEndBufferPct: number;
  globalDefaultMinDays: number;
  globalDefaultMaxDays: number;
  measuredMinPoCount: number;
  firstDeliveryOnly: boolean;
}

export type LeadTimeSource = "vendor estimate" | "measured" | "manual";

export interface LeadTimeEstimateRow {
  minDays: number;
  maxDays: number;
  source: LeadTimeSource;
  vendor: string | null;
  updatedAt: string; // ISO timestamp
}

/** One historical PO's resolved delivery date for a product, already reduced to a single date per lead_time_settings.first_delivery_only (earliest batch if true, latest/last batch if false). Null deliveredDate means not yet delivered - excluded from the measured calculation, not counted as 0 days. */
export interface MeasuredDelivery {
  poNo: string;
  poDate: string; // ISO date
  deliveredDate: string | null;
}

export interface MeasuredLeadTime {
  minDays: number;
  maxDays: number;
  poCount: number;
}

/** Reduces a PO's three batch dates to the one "delivered" date that counts, per the first-delivery-only assumption. Exported so the data layer and any future importer use the exact same rule - never duplicated. */
export function resolveDeliveredDate(
  dates: { b1: string | null; b2: string | null; b3: string | null },
  firstDeliveryOnly: boolean,
): string | null {
  const present = [dates.b1, dates.b2, dates.b3].filter((d): d is string => !!d);
  if (!present.length) return null;
  return firstDeliveryOnly ? present.sort()[0] : present.sort()[present.length - 1];
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/** Null (not "not enough data yet, treated as 0") until `minPoCount` POs with a real delivered date exist for this product. */
export function computeMeasuredLeadTime(
  deliveries: MeasuredDelivery[],
  minPoCount: number,
): MeasuredLeadTime | null {
  const observed = deliveries
    .filter((d) => d.deliveredDate !== null)
    .map((d) => daysBetween(d.poDate, d.deliveredDate!))
    .filter((days) => days >= 0); // a negative gap is bad data (delivered before ordered), not a real lead time - excluded, not clamped

  if (observed.length < minPoCount) return null;

  return {
    minDays: Math.min(...observed),
    maxDays: Math.max(...observed),
    poCount: observed.length,
  };
}

const SOURCE_PRIORITY: Record<LeadTimeSource, number> = {
  manual: 0,
  "vendor estimate": 1,
  measured: 2, // a frozen snapshot row, if one exists - live measured (tier 2 above) supersedes it
};

/** Picks one row when a product has several in `lead_times` - a standing manual override first, then the vendor's own estimate, most recently updated wins a tie. */
export function pickBestEstimateRow(
  rows: LeadTimeEstimateRow[],
): LeadTimeEstimateRow | null {
  if (!rows.length) return null;
  return [...rows].sort(
    (a, b) =>
      SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source] ||
      (a.updatedAt < b.updatedAt ? 1 : -1),
  )[0];
}

export type LeadTimeTier = "manual_po" | "measured" | "table" | "default";

export interface LeadTimeRange {
  minDays: number;
  maxDays: number;
  tier: LeadTimeTier;
  /** True only for the "default" tier - this product has no estimate and no measured history at all. */
  usedFallback: boolean;
  detail: string;
}

/** Resolves tiers 2-4 (everything except a PO's own manual ETA, which is date-specific and handled by resolveEtaForPo below once you have a PO in hand). */
export function resolveProductLeadTime(
  estimateRows: LeadTimeEstimateRow[],
  measuredDeliveries: MeasuredDelivery[],
  settings: LeadTimeSettings,
): LeadTimeRange {
  const measured = computeMeasuredLeadTime(measuredDeliveries, settings.measuredMinPoCount);
  if (measured) {
    return {
      minDays: measured.minDays,
      maxDays: measured.maxDays,
      tier: "measured",
      usedFallback: false,
      detail: `Measured from ${measured.poCount} POs with real delivery dates.`,
    };
  }

  const best = pickBestEstimateRow(estimateRows);
  if (best) {
    const isSinglePoint = best.minDays === best.maxDays;
    const maxDays = isSinglePoint
      ? Math.round(best.maxDays * (1 + settings.lateEndBufferPct / 100))
      : best.maxDays;
    return {
      minDays: best.minDays,
      maxDays,
      tier: "table",
      usedFallback: false,
      detail: isSinglePoint
        ? `${best.source}${best.vendor ? ` (${best.vendor})` : ""}, +${settings.lateEndBufferPct}% late-end buffer applied to the single-point estimate.`
        : `${best.source}${best.vendor ? ` (${best.vendor})` : ""}.`,
    };
  }

  return {
    minDays: settings.globalDefaultMinDays,
    maxDays: settings.globalDefaultMaxDays,
    tier: "default",
    usedFallback: true,
    detail: "No vendor estimate, measured history, or override for this product - using the global default range.",
  };
}

export interface EtaResolution extends LeadTimeRange {
  /** The resolved ETA date(s) for a specific PO, once its po_date is known. Null when tier is "manual_po" and the date is used as-is instead of a range. */
  etaDateRange: { earliest: string; latest: string } | null;
  manualEtaDate: string | null;
}

/** Full resolution for one PO: applies tier 1 (manual ETA on the PO) on top of whatever resolveProductLeadTime already worked out for tiers 2-4. */
export function resolveEtaForPo(
  poDate: string,
  manualEtaDate: string | null,
  productResolution: LeadTimeRange,
): EtaResolution {
  if (manualEtaDate) {
    return {
      ...productResolution,
      tier: "manual_po",
      usedFallback: false,
      detail: "Manual ETA entered directly on this PO.",
      etaDateRange: { earliest: manualEtaDate, latest: manualEtaDate },
      manualEtaDate,
    };
  }

  const addDays = (iso: string, days: number) =>
    new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

  return {
    ...productResolution,
    etaDateRange: {
      earliest: addDays(poDate, productResolution.minDays),
      latest: addDays(poDate, productResolution.maxDays),
    },
    manualEtaDate: null,
  };
}
