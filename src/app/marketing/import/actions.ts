"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseMetaAdsCsv } from "@/lib/adapters/meta";
import { ingestMetaAdsRows } from "@/lib/adapters/ingest-meta-ads";
import { runGoogleSync } from "@/lib/google/sync";

export async function importMetaAdsAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/marketing/import?error=" + encodeURIComponent("Choose a CSV file first."));
  }

  const text = await file.text();
  const { rows, unmappedColumns, missingExpectedColumns, skippedRowCount } =
    parseMetaAdsCsv(text);

  if (!rows.length) {
    redirect(
      "/marketing/import?error=" +
        encodeURIComponent(
          "No usable rows found. Missing columns: " +
            (missingExpectedColumns.join(", ") || "none - check the file isn't empty."),
        ),
    );
  }

  const supabase = createAdminClient();

  const { reportingStart, reportingEnd } = await ingestMetaAdsRows(supabase, rows);

  await supabase.from("ad_imports").insert({
    filename: file.name,
    reporting_start: reportingStart,
    reporting_end: reportingEnd,
    row_count: rows.length,
    skipped_row_count: skippedRowCount,
    unmapped_columns: unmappedColumns,
    missing_expected_columns: missingExpectedColumns,
  });

  redirect("/marketing/paid-media");
}

/**
 * Manual trigger for the GA4 + Search Console sync, same "no HTTP
 * round-trip, errors surfaced via what's already in facts_daily" pattern
 * as Odoo's syncNowAction. Backfills further back than the daily cron
 * does (30 days) since this is also how the very first sync happens.
 */
export async function syncGoogleNowAction() {
  let errors: string[] = [];
  try {
    const result = await runGoogleSync(30);
    errors = result.errors;
  } catch (e) {
    errors = [e instanceof Error ? e.message : String(e)];
  }

  if (errors.length) {
    redirect("/marketing/import?googleError=" + encodeURIComponent(errors.join(" | ")));
  }
  redirect("/marketing/import");
}
