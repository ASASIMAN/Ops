"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseLeadTimeEstimatesCsv } from "@/lib/adapters/lead-time-estimates";
import { ingestLeadTimeEstimates } from "@/lib/leadtime/ingest";

function fail(message: string): never {
  redirect("/forecast/lead-times?error=" + encodeURIComponent(message));
}

export async function importLeadTimeEstimatesAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    fail("Choose a CSV file first. (Export Product_estimation_Vendor.xlsx to CSV - this app doesn't parse .xlsx directly, see the note below.)");
  }

  const text = await file.text();
  const { rows, unparsedRows, missingExpectedColumns } = parseLeadTimeEstimatesCsv(text);

  if (missingExpectedColumns.length) {
    fail(`Missing expected column(s): ${missingExpectedColumns.join(", ")}.`);
  }
  if (!rows.length && !unparsedRows.length) {
    fail("No usable rows found - check the file isn't empty.");
  }

  const supabase = createAdminClient();
  const result = await ingestLeadTimeEstimates(supabase, rows);

  const parts = [`Imported ${result.imported} row(s).`];
  if (result.autoCreatedProducts.length) {
    parts.push(`New products auto-created (confirm these aren't duplicates): ${result.autoCreatedProducts.join(", ")}.`);
  }
  if (result.skippedUnmapped.length) {
    parts.push(`Skipped (marked "no product" by a human reviewer): ${result.skippedUnmapped.join(", ")}.`);
  }
  if (unparsedRows.length) {
    parts.push(
      `Could not parse the lead-time text on ${unparsedRows.length} row(s): ${unparsedRows
        .slice(0, 5)
        .map((r) => `"${r.rawText}" (${r.rawName})`)
        .join("; ")}${unparsedRows.length > 5 ? ", ..." : ""}.`,
    );
  }

  redirect("/forecast/lead-times?imported=" + encodeURIComponent(parts.join(" ")));
}

export async function updateLeadTimeSettingsAction(formData: FormData) {
  const supabase = createAdminClient();
  await supabase
    .from("lead_time_settings")
    .update({
      late_end_buffer_pct: Number(formData.get("lateEndBufferPct")),
      global_default_min_days: Number(formData.get("globalDefaultMinDays")),
      global_default_max_days: Number(formData.get("globalDefaultMaxDays")),
      measured_min_po_count: Number(formData.get("measuredMinPoCount")),
      first_delivery_only: formData.get("firstDeliveryOnly") === "on",
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  redirect("/forecast/lead-times");
}

export async function upsertLeadTimeRowAction(formData: FormData) {
  const supabase = createAdminClient();
  const productId = Number(formData.get("productId"));
  const minDays = Number(formData.get("minDays"));
  const maxDays = Number(formData.get("maxDays"));

  if (!productId || !Number.isFinite(minDays) || !Number.isFinite(maxDays) || maxDays < minDays) {
    fail("Pick a product and a valid min/max day range (max >= min).");
  }

  const rowId = formData.get("rowId");
  const payload = {
    lead_time_product_id: productId,
    vendor: (formData.get("vendor") as string)?.trim() || null,
    min_days: minDays,
    max_days: maxDays,
    source: formData.get("source") as "vendor estimate" | "measured" | "manual",
    note: (formData.get("note") as string)?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  if (rowId) {
    await supabase.from("lead_times").update(payload).eq("id", Number(rowId));
  } else {
    await supabase.from("lead_times").insert(payload);
  }
  redirect("/forecast/lead-times");
}

export async function deleteLeadTimeRowAction(formData: FormData) {
  const supabase = createAdminClient();
  await supabase.from("lead_times").delete().eq("id", Number(formData.get("rowId")));
  redirect("/forecast/lead-times");
}

/** Repoints a raw name at a different (or no) product - used both for a fresh human review and for merging two names later confirmed to be the same product (e.g. "Shadow - Long Sleeve" into "Shadow Shirt"). Never done automatically - this is the only place it happens, and only on explicit submission. */
export async function updateMappingAction(formData: FormData) {
  const supabase = createAdminClient();
  const mappingId = Number(formData.get("mappingId"));
  const productIdRaw = formData.get("productId") as string;
  await supabase
    .from("lead_time_name_mappings")
    .update({
      lead_time_product_id: productIdRaw ? Number(productIdRaw) : null,
      auto_created: false, // a human just confirmed it
    })
    .eq("id", mappingId);
  redirect("/forecast/lead-times");
}

export async function setManualPoEtaAction(formData: FormData) {
  const supabase = createAdminClient();
  const poId = Number(formData.get("poId"));
  const etaDate = (formData.get("manualEtaDate") as string) || null;
  await supabase
    .from("purchase_orders")
    .update({
      manual_eta_date: etaDate,
      manual_eta_note: (formData.get("manualEtaNote") as string)?.trim() || null,
    })
    .eq("id", poId);
  redirect("/forecast/lead-times");
}
