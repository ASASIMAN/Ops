import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The monthly marketing record the Financials and Unit Economics sheets
 * feed (facts_daily, one row per month per metric). These are whole-month
 * figures as entered by the business - nothing here is derived, and a month
 * that hasn't been reported simply isn't in the map.
 */
export interface MarketingMonth {
  /** First of the month, YYYY-MM-DD. */
  month: string;
  metrics: Record<string, number>;
}

export async function fetchMarketingMonths(admin: SupabaseClient): Promise<MarketingMonth[]> {
  const PAGE = 1000;
  const byMonth = new Map<string, MarketingMonth>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("facts_daily")
      .select("id, date, metric, value")
      .in("source", ["financials_sheet", "ecom_breakdown_sheet"])
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const row of data) {
      let entry = byMonth.get(row.date);
      if (!entry) {
        entry = { month: row.date, metrics: {} };
        byMonth.set(row.date, entry);
      }
      entry.metrics[row.metric] = Number(row.value);
    }
    if (data.length < PAGE) break;
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface MemberStats {
  total: number;
  joinedInPeriod: number;
  /** Customers holding an Odoo loyalty card; null until migration 0041 is run. */
  loyaltyMembers: number | null;
}

/** null when the membership tables aren't installed. */
export async function fetchMemberStats(
  admin: SupabaseClient,
  fromTs: string,
  toTs: string,
): Promise<MemberStats | null> {
  const [all, joined, summary] = await Promise.all([
    admin.from("members").select("*", { count: "exact", head: true }),
    admin.from("members").select("*", { count: "exact", head: true }).gte("created_at", fromTs).lt("created_at", toTs),
    admin.rpc("membership_summary"),
  ]);
  if (all.error || joined.error) return null;
  const loyalty = summary.error ? null : (((summary.data ?? []) as { odoo_customers: number }[])[0]?.odoo_customers ?? 0);
  return { total: all.count ?? 0, joinedInPeriod: joined.count ?? 0, loyaltyMembers: loyalty === null ? null : Number(loyalty) };
}
