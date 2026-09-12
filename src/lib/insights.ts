import { createAdminClient } from "@/lib/supabase/admin";

export interface Insight {
  text: string;
  href: string;
}

export interface InsightsResult {
  active: Insight[];
  good: Insight[];
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
  const good: Insight[] = [];
  const blocked: { rule: string; reason: string }[] = [];

  const [{ data: factRows }, { data: assumptionRows }, { data: contentRows }, { data: kolRows }] =
    await Promise.all([
      admin
        .from("facts_daily")
        .select("date, metric, value")
        .eq("source", "financials_sheet")
        .order("date", { ascending: false }),
      admin.from("assumptions").select("key, value"),
      admin.from("content_calendar").select("id, post_date, production_status, pillar"),
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
      } else {
        good.push({
          text: `${MONTH_LABEL.format(monthDate)} is pacing at ${percent}% of budget - on track.`,
          href: "/marketing/financials",
        });
      }
    }
  } else {
    blocked.push({ rule: "Budget pacing", reason: "No monthly spend data entered yet." });
  }

  // Per-ad CPA/ranking alerts used to live here as a growing list of
  // individual "Needs attention" bullets - moved to the Creative Brief's
  // collapsed Account Health disclosure instead (/marketing/creative-brief),
  // since a running feed of Meta ad warnings isn't useful to anyone but
  // whoever's buying media, and it drowned out the signals that are.
  blocked.push({
    rule: "Meta ad account health (CPA outliers, below-average rankings, creative fatigue)",
    reason: "Moved to the Creative Brief's Account health disclosure (/marketing/creative-brief) so it's not a running alert feed here.",
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

  // New creative alert: is anything actually queued up to publish next, or
  // has the pipeline run dry? "Published" posts don't count - this checks
  // for work in progress or scheduled ahead of it.
  const pipelineStatuses = [
    "Concept",
    "Shoot scheduled",
    "Shot",
    "In edit",
    "Awaiting delivery",
    "Approved",
    "Scheduled",
  ];
  const inPipeline = (contentRows ?? []).filter((c) =>
    pipelineStatuses.includes(c.production_status),
  );
  if (contentTotal > 0) {
    if (inPipeline.length === 0) {
      active.push({
        text: "Nothing is currently in the creative pipeline (Concept through Scheduled) - every planner entry is already Published. New creative is needed.",
        href: "/marketing/creative",
      });
    } else {
      const upcoming = inPipeline.filter(
        (c) => c.post_date && c.post_date >= new Date().toISOString().slice(0, 10),
      );
      if (upcoming.length === 0) {
        active.push({
          text: `${inPipeline.length} post${inPipeline.length === 1 ? "" : "s"} in the pipeline, but none has a scheduled date on or after today.`,
          href: "/marketing/creative",
        });
      } else {
        good.push({
          text: `${upcoming.length} post${upcoming.length === 1 ? "" : "s"} in the pipeline with a scheduled date coming up.`,
          href: "/marketing/creative",
        });
      }
    }
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
  const done = (kolRows ?? []).filter((k) => k.status === "Done");
  if (done.length > 0) {
    good.push({
      text: `${done.length} KOL collaboration${done.length === 1 ? "" : "s"} completed (Done).`,
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

  return { active, good, blocked };
}
