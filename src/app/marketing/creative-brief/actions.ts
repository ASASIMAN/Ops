"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseMetaAdsCsv } from "@/lib/adapters/meta";
import { ingestMetaAdsRows } from "@/lib/adapters/ingest-meta-ads";
import { parseAdLinksCsv } from "@/lib/creative-brief/parse";

async function readTextIfPresent(value: FormDataEntryValue | null): Promise<string | null> {
  if (!(value instanceof File) || value.size === 0) return null;
  return value.text();
}

export async function uploadCreativeBriefMonthAction(formData: FormData) {
  const monthKey = (formData.get("monthKey") as string | null)?.trim() ?? "";
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    redirect(
      "/marketing/creative-brief?error=" +
        encodeURIComponent("Month must be in YYYY-MM format, e.g. 2026-09."),
    );
  }

  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("creative_brief_months")
    .select("meta_ads_reporting_start, meta_ads_reporting_end, review_md, notes_md, ad_links")
    .eq("month_key", monthKey)
    .maybeSingle();

  let reportingStart: string | null = existing?.meta_ads_reporting_start ?? null;
  let reportingEnd: string | null = existing?.meta_ads_reporting_end ?? null;

  const metaCsvFile = formData.get("metaAdsCsv");
  if (metaCsvFile instanceof File && metaCsvFile.size > 0) {
    const text = await metaCsvFile.text();
    const { rows, missingExpectedColumns } = parseMetaAdsCsv(text);
    if (!rows.length) {
      redirect(
        "/marketing/creative-brief?error=" +
          encodeURIComponent(
            "meta-ads.csv had no usable rows. Missing columns: " +
              (missingExpectedColumns.join(", ") || "none - check the file isn't empty."),
          ),
      );
    }
    const ingested = await ingestMetaAdsRows(supabase, rows);
    reportingStart = ingested.reportingStart;
    reportingEnd = ingested.reportingEnd;
  }

  const reviewMd = (await readTextIfPresent(formData.get("reviewMd"))) ?? existing?.review_md ?? null;
  const notesMd = (await readTextIfPresent(formData.get("notesMd"))) ?? existing?.notes_md ?? null;

  const adLinksText = await readTextIfPresent(formData.get("adLinksCsv"));
  const adLinks = adLinksText ? parseAdLinksCsv(adLinksText) : (existing?.ad_links ?? null);

  await supabase.from("creative_brief_months").upsert(
    {
      month_key: monthKey,
      meta_ads_reporting_start: reportingStart,
      meta_ads_reporting_end: reportingEnd,
      review_md: reviewMd,
      notes_md: notesMd,
      ad_links: adLinks,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "month_key" },
  );

  redirect(`/marketing/creative-brief?month=${monthKey}`);
}
