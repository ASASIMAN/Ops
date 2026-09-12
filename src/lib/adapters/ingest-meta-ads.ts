import type { createAdminClient } from "@/lib/supabase/admin";
import type { CanonicalAdPerformanceRow } from "./meta";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Shared upsert logic for parsed Meta Ads rows - used by both the
 * standalone CSV importer (/marketing/import) and the Creative Brief
 * monthly upload, so a month dropped through either path lands in the
 * same ads/ad_performance_snapshots tables.
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
    distinctAds.set(r.adName, {
      ad_name: r.adName,
      ad_set_name: r.adSetName,
      temperature: r.temperature,
      variant_label: r.variantLabel,
    });
  }

  await supabase.from("ads").upsert(Array.from(distinctAds.values()), { onConflict: "ad_name" });

  const { data: adRows } = await supabase.from("ads").select("id, ad_name");
  const adIdByName = new Map((adRows ?? []).map((a) => [a.ad_name, a.id]));

  const snapshots = rows.map((r) => ({
    ad_id: adIdByName.get(r.adName),
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

  await supabase
    .from("ad_performance_snapshots")
    .upsert(snapshots, { onConflict: "ad_id,reporting_start,reporting_end" });

  const reportingStarts = rows.map((r) => r.reportingStart).sort();
  const reportingEnds = rows.map((r) => r.reportingEnd).sort();
  return {
    reportingStart: reportingStarts[0],
    reportingEnd: reportingEnds[reportingEnds.length - 1],
  };
}
