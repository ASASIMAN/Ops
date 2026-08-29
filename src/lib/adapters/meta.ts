import Papa from "papaparse";

// Adapter for Meta Ads Manager's per-ad CSV export (Ads Reporting).
// Each row is a summary over a reporting period (not daily), so this data
// doesn't fit facts_daily's daily grain - see the ad_performance_snapshots
// table this feeds instead.
//
// Known realities of this export, handled below:
// - Paused ads export as mostly blank/zero rows - kept, not dropped, since
//   "paused" is itself meaningful (matches "missing = no data, not zero").
// - Ranking columns ("Quality ranking" etc.) use "-" for not-yet-available,
//   which becomes null, not the literal string "-".
// - "Ad set budget" is sometimes a number, sometimes the text
//   "Using campaign budget" - kept as text since forcing it numeric would
//   lose that distinction.
// - Cold vs warm isn't a column - it's inferred from the ad set name
//   (e.g. "New Sales ad set cold Bali - WA Laskar" vs "Indo Warm").

const EXPECTED_COLUMNS = [
  "Reporting starts",
  "Reporting ends",
  "Ad name",
  "Ad delivery",
  "Results",
  "Result indicator",
  "Cost per results",
  "Ad set budget",
  "Ad set budget type",
  "Amount spent (IDR)",
  "Impressions",
  "Reach",
  "Total messaging contacts",
  "New messaging contacts",
  "Purchases",
  "Ends",
  "Attribution setting",
  "Bid",
  "Bid type",
  "Last significant edit",
  "Quality ranking",
  "Engagement rate ranking",
  "Conversion rate ranking",
  "Ad set name",
  "Cost per purchase (IDR)",
  "Results (initial)",
  "Results (initial) indicator",
];

export type Temperature = "cold" | "warm" | "unknown";

export interface CanonicalAdPerformanceRow {
  adName: string;
  adSetName: string;
  temperature: Temperature;
  variantLabel: string | null;
  reportingStart: string; // ISO date
  reportingEnd: string; // ISO date
  adDelivery: string | null;
  results: number | null;
  resultIndicator: string | null;
  costPerResults: number | null;
  adSetBudgetRaw: string | null;
  adSetBudgetType: string | null;
  amountSpentIdr: number;
  impressions: number;
  reach: number;
  totalMessagingContacts: number | null;
  newMessagingContacts: number | null;
  purchases: number | null;
  ends: string | null;
  attributionSetting: string | null;
  bid: number | null;
  bidType: string | null;
  lastSignificantEdit: string | null; // ISO timestamp
  qualityRanking: string | null;
  engagementRanking: string | null;
  conversionRanking: string | null;
  costPerPurchaseIdr: number | null;
  resultsInitial: number | null;
  resultsInitialIndicator: string | null;
}

export interface MetaAdsParseResult {
  rows: CanonicalAdPerformanceRow[];
  unmappedColumns: string[];
  missingExpectedColumns: string[];
  skippedRowCount: number;
}

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "-") return null;
  const cleaned = trimmed.replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toNumberOrZero(value: string | undefined): number {
  return toNumberOrNull(value) ?? 0;
}

function toTextOrNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "-") return null;
  return trimmed;
}

/** cold/warm isn't a column - infer it from the ad set name. */
function inferTemperature(adSetName: string): Temperature {
  const lower = adSetName.toLowerCase();
  if (lower.includes("warm")) return "warm";
  if (lower.includes("cold")) return "cold";
  return "unknown";
}

/**
 * Best-effort creative variant label: the text after the last " - " / " – "
 * separator in the ad name. Generic (not hardcoded to one campaign's
 * naming convention) - falls back to the full name if there's no
 * separator to split on.
 */
function inferVariantLabel(adName: string): string | null {
  const parts = adName.split(/\s+[-–]\s+/);
  if (parts.length < 2) return null;
  return parts[parts.length - 1].trim();
}

export function parseMetaAdsCsv(csvText: string): MetaAdsParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const actualColumns = parsed.meta.fields ?? [];
  const missingExpectedColumns = EXPECTED_COLUMNS.filter(
    (c) => !actualColumns.includes(c),
  );
  const unmappedColumns = actualColumns.filter(
    (c) => !EXPECTED_COLUMNS.includes(c),
  );

  let skippedRowCount = 0;

  const rows: CanonicalAdPerformanceRow[] = [];
  for (const row of parsed.data) {
    const adName = toTextOrNull(row["Ad name"]);
    const reportingStart = toTextOrNull(row["Reporting starts"]);
    const reportingEnd = toTextOrNull(row["Reporting ends"]);

    // These three are the only fields every real row must have - skip
    // anything so malformed it's missing its own identity/date range,
    // rather than inserting a row that can't be keyed.
    if (!adName || !reportingStart || !reportingEnd) {
      skippedRowCount++;
      continue;
    }

    const adSetName = toTextOrNull(row["Ad set name"]) ?? "";

    rows.push({
      adName,
      adSetName,
      temperature: inferTemperature(adSetName),
      variantLabel: inferVariantLabel(adName),
      reportingStart,
      reportingEnd,
      adDelivery: toTextOrNull(row["Ad delivery"]),
      results: toNumberOrNull(row["Results"]),
      resultIndicator: toTextOrNull(row["Result indicator"]),
      costPerResults: toNumberOrNull(row["Cost per results"]),
      adSetBudgetRaw: toTextOrNull(row["Ad set budget"]),
      adSetBudgetType: toTextOrNull(row["Ad set budget type"]),
      amountSpentIdr: toNumberOrZero(row["Amount spent (IDR)"]),
      impressions: toNumberOrZero(row["Impressions"]),
      reach: toNumberOrZero(row["Reach"]),
      totalMessagingContacts: toNumberOrNull(row["Total messaging contacts"]),
      newMessagingContacts: toNumberOrNull(row["New messaging contacts"]),
      purchases: toNumberOrNull(row["Purchases"]),
      ends: toTextOrNull(row["Ends"]),
      attributionSetting: toTextOrNull(row["Attribution setting"]),
      bid: toNumberOrNull(row["Bid"]),
      bidType: toTextOrNull(row["Bid type"]),
      lastSignificantEdit: toTextOrNull(row["Last significant edit"]),
      qualityRanking: toTextOrNull(row["Quality ranking"]),
      engagementRanking: toTextOrNull(row["Engagement rate ranking"]),
      conversionRanking: toTextOrNull(row["Conversion rate ranking"]),
      costPerPurchaseIdr: toNumberOrNull(row["Cost per purchase (IDR)"]),
      resultsInitial: toNumberOrNull(row["Results (initial)"]),
      resultsInitialIndicator: toTextOrNull(row["Results (initial) indicator"]),
    });
  }

  return { rows, unmappedColumns, missingExpectedColumns, skippedRowCount };
}
