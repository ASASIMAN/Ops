import Papa from "papaparse";
import { normalizeLeadTimeText } from "@/lib/leadtime/normalize";

/**
 * Adapter for the vendor lead-time estimate sheet (originally
 * "Product_estimation_Vendor.xlsx" - this app has no xlsx parser
 * dependency, since the only one available on npm carries unpatched
 * high-severity CVEs; export the sheet to CSV first, same as the
 * existing Meta Ads importer already requires).
 *
 * Column names aren't known in advance (the file hasn't been seen yet),
 * so headers are matched case-insensitively against a few accepted
 * spellings per field, same reporting-of-the-unknown approach as
 * meta.ts: unrecognized columns and unparseable lead-time text are
 * returned alongside the rows that *did* parse, not silently dropped.
 */

const PRODUCT_HEADERS = ["product", "style", "item", "product name", "style name"];
const VENDOR_HEADERS = ["vendor", "supplier", "factory"];
const LEAD_TIME_HEADERS = [
  "lead time",
  "leadtime",
  "eta",
  "estimasi",
  "estimated lead time",
  "lead time (days)",
  "estimation",
];
const NOTE_HEADERS = ["note", "notes", "keterangan", "remarks"];

function findColumn(headers: string[], candidates: string[]): string | null {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  for (const candidate of candidates) {
    const i = normalized.indexOf(candidate);
    if (i !== -1) return headers[i];
  }
  return null;
}

export interface ParsedEstimateRow {
  rawName: string; // exactly as given in the "product/style" column - never parsed further
  vendor: string | null;
  minDays: number;
  maxDays: number;
  rawText: string;
  note: string | null;
}

export interface UnparsedEstimateRow {
  rowNumber: number; // 1-based, matching the CSV's data rows (header excluded)
  rawName: string;
  rawText: string;
}

export interface ParsedEstimatesResult {
  rows: ParsedEstimateRow[];
  unparsedRows: UnparsedEstimateRow[];
  missingExpectedColumns: string[];
  unmappedColumns: string[];
}

export function parseLeadTimeEstimatesCsv(csvText: string): ParsedEstimatesResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const headers = parsed.meta.fields ?? [];
  const productCol = findColumn(headers, PRODUCT_HEADERS);
  const vendorCol = findColumn(headers, VENDOR_HEADERS);
  const leadTimeCol = findColumn(headers, LEAD_TIME_HEADERS);
  const noteCol = findColumn(headers, NOTE_HEADERS);

  const missingExpectedColumns: string[] = [];
  if (!productCol) missingExpectedColumns.push("product/style name");
  if (!leadTimeCol) missingExpectedColumns.push("lead time");

  const matchedCols = new Set([productCol, vendorCol, leadTimeCol, noteCol].filter(Boolean));
  const unmappedColumns = headers.filter((h) => !matchedCols.has(h));

  const rows: ParsedEstimateRow[] = [];
  const unparsedRows: UnparsedEstimateRow[] = [];

  if (productCol && leadTimeCol) {
    parsed.data.forEach((row, i) => {
      const rawName = row[productCol]?.trim();
      const rawText = row[leadTimeCol]?.trim();
      if (!rawName || !rawText) return; // blank row - not an error, just nothing to import

      const normalized = normalizeLeadTimeText(rawText);
      if (!normalized.ok) {
        unparsedRows.push({ rowNumber: i + 1, rawName, rawText });
        return;
      }

      rows.push({
        rawName,
        vendor: vendorCol ? row[vendorCol]?.trim() || null : null,
        minDays: normalized.minDays,
        maxDays: normalized.maxDays,
        rawText,
        note: noteCol ? row[noteCol]?.trim() || null : null,
      });
    });
  }

  return { rows, unparsedRows, missingExpectedColumns, unmappedColumns };
}
