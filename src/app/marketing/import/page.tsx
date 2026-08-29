import { createAdminClient } from "@/lib/supabase/admin";
import { importMetaAdsAction } from "./actions";

export const dynamic = "force-dynamic";
// Applies to this route's Server Actions too (the import form) - parsing
// and upserting a large CSV needs more than the platform's short default.
export const maxDuration = 60;

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const supabase = createAdminClient();
  const { data: lastImport } = await supabase
    .from("ad_imports")
    .select(
      "filename, reporting_start, reporting_end, row_count, skipped_row_count, unmapped_columns, missing_expected_columns, imported_at",
    )
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Data Import</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Meta Ads Manager export (per-ad CSV). Re-importing an overlapping
        date range updates existing rows rather than duplicating them.
      </p>

      <form
        action={importMetaAdsAction}
        className="mt-6 flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <label className="flex flex-col gap-1 text-sm">
          Meta Ads CSV
          <input
            type="file"
            name="file"
            accept=".csv"
            required
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          className="mt-1 self-start rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          Import
        </button>
      </form>

      <div className="mt-6 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <h2 className="font-medium">Last import</h2>
        {lastImport ? (
          <div className="mt-2 space-y-1 text-zinc-600 dark:text-zinc-400">
            <p>
              {lastImport.filename} - {lastImport.row_count} rows
              {lastImport.skipped_row_count
                ? `, ${lastImport.skipped_row_count} skipped (missing ad name/dates)`
                : ""}
            </p>
            <p>
              Period: {lastImport.reporting_start} to {lastImport.reporting_end}
            </p>
            <p>{new Date(lastImport.imported_at).toLocaleString()}</p>
            {Array.isArray(lastImport.unmapped_columns) &&
              lastImport.unmapped_columns.length > 0 && (
                <p className="text-amber-600">
                  Unrecognized columns in the file (ignored):{" "}
                  {lastImport.unmapped_columns.join(", ")}
                </p>
              )}
            {Array.isArray(lastImport.missing_expected_columns) &&
              lastImport.missing_expected_columns.length > 0 && (
                <p className="text-amber-600">
                  Expected columns not found in the file:{" "}
                  {lastImport.missing_expected_columns.join(", ")}
                </p>
              )}
          </div>
        ) : (
          <p className="mt-2 text-zinc-500">Never imported.</p>
        )}
      </div>
    </div>
  );
}
