import type { createAdminClient } from "@/lib/supabase/admin";
import type { CanonicalAdPerformanceRow } from "./meta";

type AdminClient = ReturnType<typeof createAdminClient>;

// An ad's real identity is (ad_name, ad_set_name), not ad_name alone -
// Meta lets the same ad name exist in more than one ad set (a creative
// duplicated across ad sets keeps its name), seen for real in a
// 206-row full-account export. ad_name alone collapsed those into one
// row and broke the snapshot upsert below - see migration 0033.
function adKey(adName: string, adSetName: string): string {
  return `${adName}\u0000${adSetName}`;
}

/**
 * Shared upsert logic for parsed Meta Ads rows - used by both the
 * standalone CSV importer (/marketing/import) and the Creative Brief
 * monthly upload, so a month dropped through either path lands in the
 * same ads/ad_performance_snapshots tables.
 *
 * Throws on a failed upsert rather than swallowing it - both callers
 * previously ignored the Supabase error, so a broken import (as the
 * duplicate ad_name case above did) looked identical to a successful
 * one from the UI.
 */
export async function ingestMetaAdsRows(
  supabase: AdminClient,
  rows: CanonicalAdPerformanceRow[],
) {
  const distinctAds = new Map<
    string,
    { ad_name: string; ad_set_name: string; temperature: string; variant_label: string | null }
  >();
  for (const r of rows) {
    distinctAds.set(adKey(r.adName, r.adSetName), {
      ad_name: r.adName,
      ad_set_name: r.adSetName,
      temperature: r.temperature,
      variant_label: r.variantLabel,
    });
  }

  const { error: adsError } = await supabase
    .from("ads")
    .upsert(Array.from(distinctAds.values()), { onConflict: "ad_name,ad_set_name" });
  if (adsError) throw new Error(`Saving ads failed: ${adsError.message}`);

  const { data: adRows, error: adsSelectError } = await supabase
    .from("ads")
    .select("id, ad_name, ad_set_name");
  if (adsSelectError) throw new Error(`Reading back ads failed: ${adsSelectError.message}`);
  const adIdByKey = new Map(
    (adRows ?? []).map((a) => [adKey(a.ad_name, a.ad_set_name), a.id]),
  );

  const snapshots = rows.map((r) => ({
    ad_id: adIdByKey.get(adKey(r.adName, r.adSetName)),
    reporting_start: r.reportingStart,
    reporting_end: r.reportingEnd,
    ad_delivery: r.adDelivery,
    results: r.results,
    result_indicator: r.resultIndicator,
    cost_per_results: r.costPerResults,
    ad_set_budget_raw: r.adSetBudgetRaw,
    ad_set_budget_type: r.adSetBudgetType,
    amount_spent_idr: r.amountSpentIdr,
    impressions: r.impressions,
    reach: r.reach,
    total_messaging_contacts: r.totalMessagingContacts,
    new_messaging_contacts: r.newMessagingContacts,
    purchases: r.purchases,
    ends: r.ends,
    attribution_setting: r.attributionSetting,
    bid: r.bid,
    bid_type: r.bidType,
    last_significant_edit: r.lastSignificantEdit,
    quality_ranking: r.qualityRanking,
    engagement_ranking: r.engagementRanking,
    conversion_ranking: r.conversionRanking,
    cost_per_purchase_idr: r.costPerPurchaseIdr,
    results_initial: r.resultsInitial,
    results_initial_indicator: r.resultsInitialIndicator,
  }));

  const { error: snapshotsError } = await supabase
    .from("ad_performance_snapshots")
    .upsert(snapshots, { onConflict: "ad_id,reporting_start,reporting_end" });
  if (snapshotsError) {
    throw new Error(`Saving ad performance snapshots failed: ${snapshotsError.message}`);
  }

  const reportingStarts = rows.map((r) => r.reportingStart).sort();
  const reportingEnds = rows.map((r) => r.reportingEnd).sort();
  return {
    reportingStart: reportingStarts[0],
    reportingEnd: reportingEnds[reportingEnds.length - 1],
  };
}
