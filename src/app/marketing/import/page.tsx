import Link from "next/link";
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
  const [{ data: lastImport }, { data: lastOdooSync }] = await Promise.all([
    supabase
      .from("ad_imports")
      .select(
        "filename, reporting_start, reporting_end, row_count, skipped_row_count, unmapped_columns, missing_expected_columns, imported_at",
      )
      .order("imported_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sync_runs")
      .select("status, started_at")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const sources: {
    name: string;
    status: "connected" | "manual" | "not_connected";
    detail: string;
    href?: string;
  }[] = [
    {
      name: "Odoo POS (sales)",
      status: lastOdooSync ? "connected" : "not_connected",
      detail: lastOdooSync
        ? `Auto-synced. Last run: ${lastOdooSync.status} (${new Date(lastOdooSync.started_at).toLocaleString()})`
        : "Not synced yet.",
      href: "/operations",
    },
    {
      name: "Meta Ads",
      status: lastImport ? "connected" : "not_connected",
      detail: lastImport
        ? `Last import: ${lastImport.filename} (${new Date(lastImport.imported_at).toLocaleDateString()})`
        : "No CSV imported yet - upload one below.",
      href: "/marketing/paid-media",
    },
    {
      name: "Metricool (organic social + GBP)",
      status: "manual",
      detail:
        "One real report hand-extracted so far. No reusable CSV/API adapter yet - a raw Metricool export or API access would let this update on a schedule instead.",
      href: "/marketing/organic-social",
    },
    {
      name: "Google Business Profile (per-store)",
      status: "not_connected",
      detail:
        "Only the one business-wide number from the Metricool report exists. Needs the GBP Performance API for per-location data.",
    },
    {
      name: "Google Analytics (GA4)",
      status: "not_connected",
      detail: "Not connected - no property access set up yet.",
    },
    {
      name: "Google Search Console",
      status: "not_connected",
      detail: "Not connected - no site access set up yet.",
    },
    {
      name: "Shopify",
      status: "not_connected",
      detail: "Not connected - no export file or API access provided yet.",
    },
  ];

  const statusBadge = {
    connected: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    manual: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    not_connected: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800",
  };
  const statusLabel = {
    connected: "Connected",
    manual: "Manual, one-off",
    not_connected: "Not connected",
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Data Import</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Every data source this app knows about, and whether it&apos;s
        actually feeding real data yet.
      </p>

      <div className="mt-6 space-y-2">
        {sources.map((s) => (
          <div
            key={s.name}
            className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
          >
            <div>
              <div className="font-medium">
                {s.href ? (
                  <Link href={s.href} className="hover:underline">
                    {s.name}
                  </Link>
                ) : (
                  s.name
                )}
              </div>
              <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{s.detail}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${statusBadge[s.status]}`}>
              {statusLabel[s.status]}
            </span>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-medium">Import Meta Ads CSV</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Re-importing an overlapping date range updates existing rows rather
        than duplicating them.
      </p>

      <form
        action={importMetaAdsAction}
        className="mt-3 flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
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

      <div className="mt-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <h3 className="font-medium">Last import</h3>
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
