import { createAdminClient } from "@/lib/supabase/admin";

export interface Insight {
  text: string;
  href: string;
}

export interface InsightsResult {
  active: Insight[];
  blocked: { rule: string; reason: string }[];
}

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Every rule from the brief's §6 that's actually computable with the data
 * on hand right now. Rules that aren't computable are returned in
 * `blocked` with the specific reason, rather than silently omitted -
 * the point of this module is to be honest about coverage, not to look
 * more complete than it is.
 */
export async function getInsights(): Promise<InsightsResult> {
  const admin = createAdminClient();
  const active: Insight[] = [];
  const blocked: { rule: string; reason: string }[] = [];

  const [
    { data: factRows },
    { data: assumptionRows },
    { data: adSnapshots },
    { data: contentRows },
    { data: kolRows },
  ] = await Promise.all([
    admin
      .from("facts_daily")
      .select("date, metric, value")
      .eq("source", "financials_sheet")
      .order("date", { ascending: false }),
    admin.from("assumptions").select("key, value"),
    admin
      .from("ad_performance_snapshots")
      .select(
        "ad_id, amount_spent_idr, purchases, cost_per_purchase_idr, quality_ranking, engagement_ranking, conversion_ranking, reporting_start, reporting_end, ads ( ad_name )",
      )
      .order("reporting_start", { ascending: false }),
    admin.from("content_calendar").select("id, production_status, pillar"),
    admin.from("kols").select("id, name, social_handle, status, opportunity_cost_idr"),
  ]);

  const assumptions = new Map((assumptionRows ?? []).map((a) => [a.key, a.value]));

  // 1. Budget pacing (latest month with spend data).
  const monthMetrics = new Map<string, Record<string, number>>();
  for (const row of factRows ?? []) {
    if (!monthMetrics.has(row.date)) monthMetrics.set(row.date, {});
    monthMetrics.get(row.date)![row.metric] = Number(row.value);
  }
  const latestMonthDate = [...monthMetrics.keys()].sort().pop();
  if (latestMonthDate) {
    const m = monthMetrics.get(latestMonthDate)!;
    const spend = m.total_spend_idr;
    const budget = m.total_budget_idr ?? assumptions.get("monthly_marketing_budget_idr");
    const monthDate = new Date(latestMonthDate + "T00:00:00Z");
    const now = new Date();
    const isCurrentMonth =
      monthDate.getUTCFullYear() === now.getUTCFullYear() &&
      monthDate.getUTCMonth() === now.getUTCMonth();
    if (spend && budget && isCurrentMonth) {
      const daysInMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
      ).getUTCDate();
      const projected = (spend / now.getUTCDate()) * daysInMonth;
      const percent = Math.round((projected / budget) * 100);
      if (percent > 110) {
        active.push({
          text: `${MONTH_LABEL.format(monthDate)} is pacing at ${percent}% of budget - projected to land at ${currencyFormatter.format(projected)} against a ${currencyFormatter.format(budget)} budget.`,
          href: "/marketing/financials",
        });
      } else if (percent < 70) {
        active.push({
          text: `${MONTH_LABEL.format(monthDate)} is pacing at only ${percent}% of budget - room to spend more before month end.`,
          href: "/marketing/financials",
        });
      }
    }
  } else {
    blocked.push({ rule: "Budget pacing", reason: "No monthly spend data entered yet." });
  }

  // 2 & 4. CPA outliers and below-average ranking still spending, from the
  // most recent ad reporting period.
  type Snapshot = {
    ad_id: number;
    amount_spent_idr: number;
    purchases: number | null;
    cost_per_purchase_idr: number | null;
    quality_ranking: string | null;
    engagement_ranking: string | null;
    conversion_ranking: string | null;
    reporting_start: string;
    reporting_end: string;
    ads: { ad_name: string } | null;
  };
  const snapshots = (adSnapshots ?? []) as unknown as Snapshot[];
  const latestPeriod = snapshots[0]
    ? { start: snapshots[0].reporting_start, end: snapshots[0].reporting_end }
    : null;

  if (latestPeriod) {
    const period = snapshots.filter(
      (s) => s.reporting_start === latestPeriod.start && s.reporting_end === latestPeriod.end,
    );

    const withPurchases = period.filter(
      (s) => s.cost_per_purchase_idr && Number(s.purchases) > 0,
    );
    if (withPurchases.length >= 3) {
      const cpas = withPurchases
        .map((s) => Number(s.cost_per_purchase_idr))
        .sort((a, b) => a - b);
      const mid = Math.floor(cpas.length / 2);
      const median =
        cpas.length % 2 === 0 ? (cpas[mid - 1] + cpas[mid]) / 2 : cpas[mid];
      for (const s of withPurchases) {
        const cpa = Number(s.cost_per_purchase_idr);
        if (cpa > median * 2) {
          active.push({
            text: `"${s.ads?.ad_name}" costs ${currencyFormatter.format(cpa)} per purchase, more than 2x this period's median (${currencyFormatter.format(median)}).`,
            href: "/marketing/paid-media",
          });
        }
      }
    } else {
      blocked.push({
        rule: "CPA outliers (trailing 3-month median)",
        reason: `Only one ad reporting period has been imported so far (${withPurchases.length} ads with purchases) - the brief wants a trailing 3-month median, which needs at least 3 months of imports.`,
      });
    }

    const belowAverageSpending = period.filter(
      (s) =>
        Number(s.amount_spent_idr) > 0 &&
        [s.quality_ranking, s.engagement_ranking, s.conversion_ranking].some((r) =>
          r?.toLowerCase().includes("below average"),
        ),
    );
    for (const s of belowAverageSpending) {
      active.push({
        text: `"${s.ads?.ad_name}" has a Below average ranking but is still spending (${currencyFormatter.format(Number(s.amount_spent_idr))} this period).`,
        href: "/marketing/paid-media",
      });
    }
  } else {
    blocked.push({ rule: "CPA outliers / creative fatigue", reason: "No ad data imported yet." });
  }

  blocked.push({
    rule: "Creative fatigue (CPM up >20% MoM while reach falls)",
    reason: "Needs at least 2 imported reporting periods for the same ads to compare month-over-month - only one period exists so far.",
  });

  // 6. Plan adherence.
  const contentTotal = contentRows?.length ?? 0;
  if (contentTotal > 0) {
    const published = (contentRows ?? []).filter(
      (c) => c.production_status === "Published",
    ).length;
    active.push({
      text: `${published} of ${contentTotal} planned posts are marked Published.`,
      href: "/marketing/creative",
    });
  } else {
    blocked.push({
      rule: "Plan adherence (planned vs published posts)",
      reason: "No posts have been entered into the Creative Planner yet - the source content plan is still blocked on Drive access.",
    });
  }

  // 7. KOL missed bookings (the "confirmed-but-never-delivered" flag -
  // "Missed" is the closest status to that in the real data).
  const missed = (kolRows ?? []).filter((k) => k.status === "Missed");
  if (missed.length > 0) {
    active.push({
      text: `${missed.length} KOL booking${missed.length === 1 ? "" : "s"} marked Missed: ${missed
        .slice(0, 3)
        .map((k) => k.name || k.social_handle || "unnamed")
        .join(", ")}${missed.length > 3 ? ", ..." : ""}.`,
      href: "/marketing/kols",
    });
  }
  blocked.push({
    rule: "KOL ROI (opportunity cost vs content reach/engagement)",
    reason: "KOL records aren't linked to specific organic posts, so opportunity cost can't be compared against the reach/engagement that content delivered.",
  });

  blocked.push({
    rule: "Attribution reconciliation (stated walk-in source vs actual Maps/Meta data)",
    reason: "No monthly walk-in attribution counts have been entered, and Google Business Profile data available so far is a single business-wide number, not per-store direction requests.",
  });

  blocked.push({
    rule: "Store performance ranking (revenue normalized by Maps impressions)",
    reason: "Store revenue is available via the Odoo sync, but Maps impressions per store isn't - only one business-wide GBP figure exists so far.",
  });

  return { active, blocked };
}
