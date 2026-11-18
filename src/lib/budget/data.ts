import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchPeriodDemand, fetchStockLevels } from "@/lib/forecast/data";
import { fetchLinkedLeadTimeProductId, fetchOpenPoLines } from "@/lib/forecast/planner";
import { fetchStyleMerges, fetchStyleOptions, fetchUpliftFactors, upliftOverlapFraction, type UpliftFactor } from "@/lib/forecast/style";
import { fetchEstimatesByProduct, fetchLeadTimeSettings, fetchMeasuredDeliveriesByProduct, hasLeadTimeSchema } from "@/lib/leadtime/data";
import { resolveProductLeadTime, type LeadTimeRange } from "@/lib/leadtime/resolve";
import { buildSeasonIndex, fetchArrivals } from "@/lib/tourism/seasonality";
import { CORE_ITEMS, type CoreItem } from "./items";
import {
  addMonths,
  askBy,
  budgetToSell,
  igResponse,
  monthStart,
  normalMonth,
  project,
  pushEffect,
  seasonFactors,
  targetCoverMonths,
  unitsPerStoreSale,
  type AskBy,
  type IgResponse,
  type MarketingMonthRow,
  type MonthlySales,
  type NormalMonth,
  type ProjectionPoint,
  type PushEffect,
} from "./model";

export const BUDGET_MIGRATION = "supabase/migrations/0046_budget_planner.sql";
export const HORIZON_MONTHS = 12;
export const DEFAULT_AGED_DAYS = 180;
export const DEFAULT_ASK_LEAD_MONTHS = 1;
export const SETTING_KEYS = {
  agedDays: "budget_aged_days",
  askLead: "budget_ask_lead_months",
  target: (itemKey: string) => `budget_target_months_${itemKey}`,
};
/** Pushes that count towards the plan (rejected and withdrawn ones don't). */
export const LIVE_STATUSES = ["proposed", "confirmed", "approved"];

export interface PlannerUser {
  id: string;
  email: string;
  role: string;
  /** The CEO: can approve or reject pushes (profiles.can_approve_budget). */
  canApprove: boolean;
}

/** Anyone signed in to the staff app, with their role and whether they approve budget. */
export async function getPlannerUser(): Promise<PlannerUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const full = await admin.from("profiles").select("role, can_approve_budget").eq("id", user.id).maybeSingle();
  if (!full.error) {
    return { id: user.id, email: user.email ?? "", role: full.data?.role ?? "viewer", canApprove: Boolean(full.data?.can_approve_budget) };
  }
  // Before migration 0046 there's no approver column.
  const basic = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return { id: user.id, email: user.email ?? "", role: basic.data?.role ?? "viewer", canApprove: false };
}

export const can = {
  propose: (u: PlannerUser) => u.role === "admin" || u.role === "marketing",
  confirm: (u: PlannerUser) => u.role === "admin" || u.role === "ops",
  approve: (u: PlannerUser) => u.canApprove,
  settings: (u: PlannerUser) => u.role === "admin",
};

export interface PushRow {
  id: number;
  item_key: string;
  month: string;
  amount_idr: number;
  units_per_ig_sale: number | null;
  reason: string | null;
  status: "proposed" | "confirmed" | "approved" | "rejected" | "withdrawn";
  proposed_by: string;
  proposed_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  predicted_units: number | null;
  predicted_revenue_idr: number | null;
  predicted_profit_idr: number | null;
}

export interface PushEvent {
  id: number;
  push_id: number;
  actor: string;
  actor_role: string | null;
  action: string;
  note: string | null;
  created_at: string;
}

export interface PushView extends PushRow {
  effect: PushEffect | null;
  unitsPerSaleUsed: number | null;
  events: PushEvent[];
  /** For approved pushes in a finished month: what actually sold vs a normal month. */
  result: { sold: number; normal: number } | null;
}

export interface ItemPlan {
  item: CoreItem;
  styles: string[];
  productIds: number[];
  history: MonthlySales[];
  normal: NormalMonth;
  /** Average selling price per unit, last 3 complete months; null without sales. */
  price: number | null;
  /** Stock-weighted average cost price; null when Odoo has no costs for it. */
  cost: number | null;
  stockNow: number;
  aged: { units: number; oldest: string | null; known: boolean };
  leadTimeDays: number | null;
  target: { months: number; source: string };
  incoming: Map<string, number>;
  unitsPerSale: number | null;
  baseline: ProjectionPoint[];
  withPushes: ProjectionPoint[];
  ask: AskBy | null;
  /** Spend needed to sell the peak pile through Instagram-driven store sales (normal mix). */
  clearBudget: number | null;
  upliftByMonth: Map<string, number>;
}

export interface PlannerData {
  currentMonth: string;
  months: string[];
  season: number[];
  seasonYears: number;
  response: IgResponse | null;
  items: ItemPlan[];
  pushes: PushView[];
  settings: { agedDays: number; askLeadMonths: number; targetOverrides: Record<string, number | null> };
  people: { id: string; email: string; role: string; canApprove: boolean }[];
  stockSyncedAt: string | null;
  /** Setup still needed, in plain words. */
  setup: string[];
}

async function pagedSelect<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) return { rows: out, error: error.message };
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return { rows: out, error: null };
  }
}

async function fetchMarketingRows(admin: SupabaseClient): Promise<MarketingMonthRow[]> {
  const { rows } = await pagedSelect<{ id: number; date: string; metric: string; value: number }>((a, b) =>
    admin
      .from("facts_daily")
      .select("id, date, metric, value")
      .in("source", ["financials_sheet", "visitor_attribution_sheet"])
      .in("metric", ["meta_ad_spend_idr", "walkin_instagram_count", "instore_sales_orders"])
      .order("id")
      .range(a, b),
  );
  const byMonth = new Map<string, MarketingMonthRow & { instore?: number }>();
  for (const r of rows) {
    const month = `${r.date.slice(0, 7)}-01`;
    const row = byMonth.get(month) ?? { month };
    const v = Number(r.value);
    if (r.metric === "meta_ad_spend_idr") row.metaSpend = v;
    if (r.metric === "walkin_instagram_count") row.igSales = v;
    if (r.metric === "instore_sales_orders") row.instore = v;
    byMonth.set(month, row);
  }
  // Walk-ins from Instagram first; the Financials sheet's in-store sales from ads if the visitor count is missing.
  return [...byMonth.values()].map(({ instore, ...r }) => ({ ...r, igSales: r.igSales ?? instore }));
}

/** All POS orders per month (every store), for an item's share of store sales. */
async function fetchPosOrdersByMonth(admin: SupabaseClient, fromMonth: string, toMonth: string): Promise<Map<string, number>> {
  const { data } = await admin.rpc("biz_sales_series_by_store", {
    p_from: `${fromMonth}T00:00:00+08:00`,
    p_to: `${toMonth}T00:00:00+08:00`,
    p_bucket: "month",
  });
  const out = new Map<string, number>();
  for (const r of (data ?? []) as { bucket_date: string; order_count: number }[]) {
    const month = `${String(r.bucket_date).slice(0, 7)}-01`;
    out.set(month, (out.get(month) ?? 0) + Number(r.order_count));
  }
  return out;
}

export async function loadBudgetPlanner(): Promise<PlannerData> {
  const admin = createAdminClient();
  const now = new Date();
  const currentMonth = monthStart(now);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const firstMonthFraction = (daysInMonth - now.getUTCDate() + 1) / daysInMonth;
  const months = Array.from({ length: HORIZON_MONTHS }, (_, i) => addMonths(currentMonth, i));
  const setup: string[] = [];

  const [merges, arrivals, marketingRows, posOrders, settingsRes, pushesRes, leadSchema] = await Promise.all([
    fetchStyleMerges(admin),
    fetchArrivals(admin),
    fetchMarketingRows(admin),
    fetchPosOrdersByMonth(admin, addMonths(currentMonth, -6), currentMonth),
    admin.from("assumptions").select("key, value").like("key", "budget_%"),
    admin.from("marketing_pushes").select("*").order("month").order("id"),
    hasLeadTimeSchema(admin),
  ]);
  if (pushesRes.error) setup.push(`Run ${BUDGET_MIGRATION} in Supabase to turn on pushes, stock age and cost prices.`);

  const settingsMap = new Map((settingsRes.data ?? []).map((r) => [r.key as string, Number(r.value)]));
  const agedDays = settingsMap.get(SETTING_KEYS.agedDays) || DEFAULT_AGED_DAYS;
  const askLeadMonths = settingsMap.has(SETTING_KEYS.askLead) ? Math.max(0, settingsMap.get(SETTING_KEYS.askLead)!) : DEFAULT_ASK_LEAD_MONTHS;
  const targetOverrides = Object.fromEntries(CORE_ITEMS.map((i) => [i.key, settingsMap.get(SETTING_KEYS.target(i.key)) || null]));

  const seasonIndex = buildSeasonIndex(arrivals);
  const season = seasonFactors(seasonIndex);
  const seasonYears = seasonIndex[0]?.yearsAveraged ?? 0;
  const response = igResponse(marketingRows, currentMonth);

  // Styles per core item.
  const styles = await fetchStyleOptions(admin, merges);
  const matched = CORE_ITEMS.map((item) => ({ item, styles: styles.filter((s) => item.matches(s.name)) }));
  const allProductIds = [...new Set(matched.flatMap((m) => m.styles.flatMap((s) => s.productIds)))];
  const productToItem = new Map<number, string>();
  const productToStyle = new Map<number, number>();
  for (const m of matched)
    for (const s of m.styles)
      for (const id of s.productIds) {
        productToItem.set(id, m.item.key);
        productToStyle.set(id, s.templateId);
      }

  const historyFrom = addMonths(currentMonth, -24);
  const [demand, stock, lotAges, costs] = await Promise.all([
    allProductIds.length
      ? fetchPeriodDemand(admin, { from: `${historyFrom}T00:00:00Z`, to: `${addMonths(currentMonth, 1)}T00:00:00Z`, bucket: "month", productIds: allProductIds })
      : Promise.resolve({ rows: [], error: null }),
    allProductIds.length ? fetchStockLevels(admin, allProductIds) : Promise.resolve({ rows: [], unavailable: false }),
    allProductIds.length
      ? pagedSelect<{ product_id: number; received_on: string; qty: number }>((a, b) =>
          admin.from("stock_lot_ages").select("product_id, received_on, qty").in("product_id", allProductIds).order("product_id").order("received_on").range(a, b),
        )
      : Promise.resolve({ rows: [], error: null }),
    allProductIds.length
      ? pagedSelect<{ id: number; cost_price: number | null }>((a, b) =>
          admin.from("products").select("id, cost_price").in("id", allProductIds).order("id").range(a, b),
        )
      : Promise.resolve({ rows: [], error: null }),
  ]);

  // Lead times and open POs, per style.
  const leadSettings = leadSchema ? await fetchLeadTimeSettings(admin) : null;
  const [estimates, measured] = leadSchema && leadSettings
    ? await Promise.all([fetchEstimatesByProduct(admin), fetchMeasuredDeliveriesByProduct(admin, leadSettings.firstDeliveryOnly)])
    : [new Map(), new Map()];

  const stockByProduct = new Map<number, number>();
  let stockSyncedAt: string | null = null;
  for (const r of stock.rows) {
    stockByProduct.set(r.productId, (stockByProduct.get(r.productId) ?? 0) + Math.max(0, r.qty));
    if (!stockSyncedAt || r.syncedAt > stockSyncedAt) stockSyncedAt = r.syncedAt;
  }
  const costByProduct = new Map(costs.rows.filter((r) => r.cost_price !== null && Number(r.cost_price) > 0).map((r) => [r.id, Number(r.cost_price)]));
  const agedCutoff = new Date(now.getTime() - agedDays * 86400000).toISOString().slice(0, 10);
  const lotAgesKnown = !lotAges.error && lotAges.rows.length > 0;

  const items: ItemPlan[] = [];
  for (const { item, styles: itemStyles } of matched) {
    const productIds = itemStyles.flatMap((s) => s.productIds);
    const ids = new Set(productIds);

    // Monthly sales, and each style's share (for style-specific uplifts).
    const byMonth = new Map<string, MonthlySales>();
    const unitsByStyle = new Map<number, number>();
    for (const r of demand.rows) {
      if (!ids.has(r.product_id)) continue;
      const m = byMonth.get(r.bucket_date) ?? { month: r.bucket_date, units: 0, revenue: 0 };
      m.units += Number(r.units);
      m.revenue += Number(r.revenue);
      byMonth.set(r.bucket_date, m);
      const style = productToStyle.get(r.product_id)!;
      unitsByStyle.set(style, (unitsByStyle.get(style) ?? 0) + Number(r.units));
    }
    const history = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
    const normal = normalMonth(history, season, currentMonth);
    const recent = history.filter((h) => h.month < currentMonth && h.month >= addMonths(currentMonth, -3));
    const recentUnits = recent.reduce((s, h) => s + h.units, 0);
    const price = recentUnits > 0 ? recent.reduce((s, h) => s + h.revenue, 0) / recentUnits : null;

    const stockNow = productIds.reduce((s, id) => s + (stockByProduct.get(id) ?? 0), 0);
    let costWeight = 0;
    let costSum = 0;
    for (const id of productIds) {
      const c = costByProduct.get(id);
      const w = stockByProduct.get(id) ?? 0;
      if (c !== undefined && w > 0) {
        costSum += c * w;
        costWeight += w;
      }
    }
    if (costWeight === 0) {
      const known = productIds.map((id) => costByProduct.get(id)).filter((c): c is number => c !== undefined);
      if (known.length) {
        costSum = known.reduce((a, b) => a + b, 0);
        costWeight = known.length;
      }
    }
    const cost = costWeight > 0 ? costSum / costWeight : null;

    let agedUnits = 0;
    let oldest: string | null = null;
    for (const r of lotAges.rows) {
      if (!ids.has(r.product_id)) continue;
      if (!oldest || r.received_on < oldest) oldest = r.received_on;
      if (r.received_on < agedCutoff) agedUnits += Number(r.qty);
    }

    // Lead time + incoming POs from the lead-time system (one lead-time product can cover several styles).
    let leadTimeDays: number | null = null;
    const incoming = new Map<string, number>();
    const seenLeadProducts = new Set<number>();
    if (leadSchema && leadSettings) {
      for (const s of itemStyles) {
        const leadProductId = await fetchLinkedLeadTimeProductId(admin, s.templateId, merges);
        const resolution: LeadTimeRange = leadProductId
          ? resolveProductLeadTime(estimates.get(leadProductId) ?? [], measured.get(leadProductId) ?? [], leadSettings)
          : { minDays: leadSettings.globalDefaultMinDays, maxDays: leadSettings.globalDefaultMaxDays, tier: "default", usedFallback: true, detail: "" };
        leadTimeDays = Math.max(leadTimeDays ?? 0, resolution.maxDays);
        if (!leadProductId || seenLeadProducts.has(leadProductId)) continue;
        seenLeadProducts.add(leadProductId);
        for (const po of await fetchOpenPoLines(admin, leadProductId, resolution)) {
          const mid = new Date((new Date(po.resolvedEtaEarliest).getTime() + new Date(po.resolvedEtaLatest).getTime()) / 2);
          const arrival = monthStart(mid) < currentMonth ? currentMonth : monthStart(mid);
          incoming.set(arrival, (incoming.get(arrival) ?? 0) + po.qtyOpen);
        }
      }
    }

    // Planned events (PO planner uplifts), weighted by each style's share of the item's sales.
    const totalStyleUnits = [...unitsByStyle.values()].reduce((a, b) => a + b, 0);
    const upliftByMonth = new Map<string, number>(months.map((m) => [m, 0]));
    for (const s of itemStyles) {
      const share = totalStyleUnits > 0 ? (unitsByStyle.get(s.templateId) ?? 0) / totalStyleUnits : 1 / itemStyles.length;
      if (!share) continue;
      const factors: UpliftFactor[] = await fetchUpliftFactors(admin, s.templateId, merges).catch(() => []);
      for (const m of months)
        for (const f of factors) upliftByMonth.set(m, upliftByMonth.get(m)! + share * (f.upliftPct / 100) * upliftOverlapFraction(m, f));
    }

    const target = targetCoverMonths(targetOverrides[item.key], leadTimeDays);
    const unitsPerSale = unitsPerStoreSale(history, posOrders, currentMonth);
    const projectionBase = {
      startMonth: currentMonth,
      months: HORIZON_MONTHS,
      stockNow,
      firstMonthFraction,
      normal: normal.units ?? 0,
      season,
      uplift: (m: string) => 1 + (upliftByMonth.get(m) ?? 0),
      incoming,
      targetMonths: target.months,
    };
    const baseline = project({ ...projectionBase, extra: new Map() });
    const ask = normal.units ? askBy(baseline, askLeadMonths, currentMonth) : null;
    items.push({
      item,
      styles: itemStyles.map((s) => s.name),
      productIds,
      history,
      normal,
      price,
      cost,
      stockNow,
      aged: { units: agedUnits, oldest, known: lotAgesKnown },
      leadTimeDays,
      target,
      incoming,
      unitsPerSale,
      baseline,
      withPushes: baseline, // replaced below once pushes are known
      ask,
      clearBudget: ask && response && unitsPerSale ? budgetToSell(ask.peakUnits, response, unitsPerSale) : null,
      upliftByMonth,
    });
  }

  // Pushes, their predicted effect, and what actually happened.
  const pushRows = (pushesRes.data ?? []) as PushRow[];
  const eventsRes = pushRows.length
    ? await admin.from("marketing_push_events").select("*").in("push_id", pushRows.map((p) => p.id)).order("created_at")
    : { data: [] };
  const eventsByPush = new Map<number, PushEvent[]>();
  for (const e of (eventsRes.data ?? []) as PushEvent[]) eventsByPush.set(e.push_id, [...(eventsByPush.get(e.push_id) ?? []), e]);

  const pushes: PushView[] = pushRows.map((p) => {
    const plan = items.find((i) => i.item.key === p.item_key);
    const unitsPerSaleUsed = p.units_per_ig_sale ?? plan?.unitsPerSale ?? null;
    const effect = plan && response && unitsPerSaleUsed ? pushEffect(Number(p.amount_idr), response, unitsPerSaleUsed, plan.price, plan.cost) : null;
    let result: PushView["result"] = null;
    if (plan && p.status === "approved" && p.month < currentMonth && plan.normal.units) {
      const sold = plan.history.find((h) => h.month === p.month)?.units ?? 0;
      const normalThen = plan.normal.units * (season[Number(p.month.slice(5, 7)) - 1] || 1);
      result = { sold, normal: normalThen };
    }
    return { ...p, amount_idr: Number(p.amount_idr), effect, unitsPerSaleUsed, events: eventsByPush.get(p.id) ?? [], result };
  });

  for (const plan of items) {
    const extra = new Map<string, number>();
    for (const p of pushes)
      if (p.item_key === plan.item.key && LIVE_STATUSES.includes(p.status) && p.effect)
        extra.set(p.month, (extra.get(p.month) ?? 0) + p.effect.units);
    if (extra.size) {
      plan.withPushes = project({
        startMonth: currentMonth,
        months: HORIZON_MONTHS,
        stockNow: plan.stockNow,
        firstMonthFraction,
        normal: plan.normal.units ?? 0,
        season,
        uplift: (m) => 1 + (plan.upliftByMonth.get(m) ?? 0),
        incoming: plan.incoming,
        extra,
        targetMonths: plan.target.months,
      });
    }
  }

  const peopleRes = await admin.from("profiles").select("id, email, role, can_approve_budget").order("email");
  const people = peopleRes.error
    ? []
    : (peopleRes.data ?? []).map((p) => ({ id: p.id as string, email: p.email as string, role: p.role as string, canApprove: Boolean(p.can_approve_budget) }));
  if (!peopleRes.error && !people.some((p) => p.canApprove)) setup.push("No approver yet: an admin picks the CEO's account under Settings below.");
  if (!response) setup.push("Not enough marketing figures to work out the cost of an Instagram store sale (needs Meta ad spend and Instagram walk-ins in the marketing section).");

  return {
    currentMonth,
    months,
    season,
    seasonYears,
    response,
    items,
    pushes,
    settings: { agedDays, askLeadMonths, targetOverrides },
    people,
    stockSyncedAt,
    setup,
  };
}
