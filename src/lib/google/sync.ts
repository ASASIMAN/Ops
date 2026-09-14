import { createAdminClient } from "@/lib/supabase/admin";
import { fetchGa4Daily } from "./ga4";
import { fetchSearchConsoleDaily } from "./search-console";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Pulls recent GA4 + Search Console data and upserts it into facts_daily,
 * same shape as every other real-data source in this app. Shared by the
 * cron-triggered route and any manual "Sync now" trigger.
 */
export async function runGoogleSync(days: number) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const startDate = isoDate(start);
  const endDate = isoDate(end);

  const supabase = createAdminClient();
  let ga4Rows = 0;
  let gscRows = 0;

  const [ga4Result, gscResult] = await Promise.allSettled([
    fetchGa4Daily(startDate, endDate),
    fetchSearchConsoleDaily(startDate, endDate),
  ]);

  if (ga4Result.status === "fulfilled") {
    const facts = ga4Result.value.flatMap((row) => [
      { date: row.date, source: "ga4", entity_type: "company", entity_id: "asasi", metric: "ga4_sessions", value: row.sessions },
      { date: row.date, source: "ga4", entity_type: "company", entity_id: "asasi", metric: "ga4_active_users", value: row.activeUsers },
      { date: row.date, source: "ga4", entity_type: "company", entity_id: "asasi", metric: "ga4_new_users", value: row.newUsers },
      { date: row.date, source: "ga4", entity_type: "company", entity_id: "asasi", metric: "ga4_page_views", value: row.screenPageViews },
      { date: row.date, source: "ga4", entity_type: "company", entity_id: "asasi", metric: "ga4_engagement_rate", value: row.engagementRate },
      { date: row.date, source: "ga4", entity_type: "company", entity_id: "asasi", metric: "ga4_avg_session_duration_sec", value: row.averageSessionDuration },
    ]);
    if (facts.length) {
      await supabase
        .from("facts_daily")
        .upsert(facts, { onConflict: "date,source,entity_type,entity_id,metric" });
    }
    ga4Rows = ga4Result.value.length;
  }

  if (gscResult.status === "fulfilled") {
    const facts = gscResult.value.flatMap((row) => [
      { date: row.date, source: "search_console", entity_type: "company", entity_id: "asasi", metric: "gsc_clicks", value: row.clicks },
      { date: row.date, source: "search_console", entity_type: "company", entity_id: "asasi", metric: "gsc_impressions", value: row.impressions },
      { date: row.date, source: "search_console", entity_type: "company", entity_id: "asasi", metric: "gsc_ctr", value: row.ctr },
      { date: row.date, source: "search_console", entity_type: "company", entity_id: "asasi", metric: "gsc_avg_position", value: row.position },
    ]);
    if (facts.length) {
      await supabase
        .from("facts_daily")
        .upsert(facts, { onConflict: "date,source,entity_type,entity_id,metric" });
    }
    gscRows = gscResult.value.length;
  }

  const errors = [ga4Result, gscResult]
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));

  return { ga4Rows, gscRows, errors };
}
