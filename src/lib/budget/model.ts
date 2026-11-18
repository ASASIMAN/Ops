/**
 * The marketing budget planner's maths, as pure functions so every figure
 * on /planning/budget can be traced and checked. Per core item, per month:
 *
 *   Season(m)      how busy month m is vs an average month (1.0 = average),
 *                  from Bali tourist arrivals until we have 2 years of our
 *                  own sales.
 *   Normal month   the item's usual monthly sales with the season taken out:
 *                  average of units(m) / Season(m) over the last 6 complete
 *                  months.
 *   Base(m)        Normal x Season(m) x planned uplifts (PO planner events).
 *   Stock(m+1)     Stock(m) + incoming POs(m) - Base(m) - Extra(m), never < 0.
 *   Cover(m)       Stock / Normal month = months of normal sales on hand.
 *   Pile(m)        stock above the target cover (Target months x Normal).
 *
 *   Cost per Instagram store sale = Meta ad spend / store sales from
 *   Instagram (walk-ins who said they came from Instagram - the same count
 *   the Financials sheet reports as in-store sales), over the last 12
 *   reported months.
 *   Extra units from a push = spend / that cost x units of the item per
 *   store sale (normally the item's share: its units / all POS orders).
 *   Profit from a push = extra units x (price - cost) - spend.
 */

export interface MonthlySales {
  /** First of the month, YYYY-MM-01. */
  month: string;
  units: number;
  revenue: number;
}

export function monthStart(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return monthStart(d);
}

/** 0 = January. */
export function monthOfYear(month: string): number {
  return Number(month.slice(5, 7)) - 1;
}

/** Twelve factors (Jan..Dec), 1.0 = an average month, from the tourist index's percent-of-year shares. */
export function seasonFactors(points: { month: number; indexPct: number }[]): number[] {
  const out = new Array(12).fill(1);
  for (const p of points) if (p.indexPct > 0) out[p.month - 1] = p.indexPct / (100 / 12);
  return out;
}

export interface NormalMonth {
  /** Units in an average-season month; null when there's no complete month of sales yet. */
  units: number | null;
  /** The complete months it was averaged over. */
  months: string[];
}

export function normalMonth(history: MonthlySales[], season: number[], currentMonth: string, window = 6): NormalMonth {
  const sold = history.filter((h) => h.units > 0 && h.month < currentMonth);
  if (!sold.length) return { units: null, months: [] };
  const first = sold.reduce((a, h) => (h.month < a ? h.month : a), sold[0].month);
  const byMonth = new Map(history.map((h) => [h.month, h.units]));
  const months: string[] = [];
  for (let i = 1; i <= window; i++) {
    const m = addMonths(currentMonth, -i);
    if (m < first) break;
    months.push(m);
  }
  if (!months.length) return { units: null, months: [] };
  const units = months.reduce((sum, m) => sum + Math.max(0, byMonth.get(m) ?? 0) / (season[monthOfYear(m)] || 1), 0) / months.length;
  return { units, months };
}

export interface ProjectionPoint {
  month: string;
  season: number;
  /** Units expected to sell with no extra marketing. */
  base: number;
  incoming: number;
  /** Extra units sold thanks to pushes (capped by stock). */
  extra: number;
  stockEnd: number;
  /** Months of normal sales left at month end; null without a normal month. */
  cover: number | null;
  /** Units above the target cover at month end. */
  pile: number;
}

export function project(o: {
  startMonth: string;
  months: number;
  stockNow: number;
  /** Share of the current month still to come (0-1). */
  firstMonthFraction: number;
  normal: number;
  season: number[];
  /** Multiplier for planned events in a month (1 = none). */
  uplift: (month: string) => number;
  incoming: Map<string, number>;
  extra: Map<string, number>;
  targetMonths: number;
}): ProjectionPoint[] {
  const out: ProjectionPoint[] = [];
  let stock = Math.max(0, o.stockNow);
  for (let i = 0; i < o.months; i++) {
    const month = addMonths(o.startMonth, i);
    const season = o.season[monthOfYear(month)] || 1;
    const fraction = i === 0 ? Math.min(1, Math.max(0, o.firstMonthFraction)) : 1;
    const base = o.normal * season * o.uplift(month) * fraction;
    const incoming = o.incoming.get(month) ?? 0;
    const available = stock + incoming;
    const baseSold = Math.min(available, base);
    const extraSold = Math.min(available - baseSold, Math.max(0, o.extra.get(month) ?? 0));
    const stockEnd = available - baseSold - extraSold;
    out.push({
      month,
      season,
      base,
      incoming,
      extra: extraSold,
      stockEnd,
      cover: o.normal > 0 ? stockEnd / o.normal : null,
      pile: Math.max(0, stockEnd - o.targetMonths * o.normal),
    });
    stock = stockEnd;
  }
  return out;
}

export interface MarketingMonthRow {
  month: string;
  metaSpend?: number;
  /** Store customers who came from Instagram (walk-in survey; equals the sheet's in-store sales from ads). */
  igSales?: number;
}

export interface IgResponse {
  /** Meta ad spend per Instagram-driven store sale, Rp. */
  costPerIgSale: number;
  igSales: number;
  spend: number;
  months: string[];
}

/** Cost of one Instagram-driven store sale over the last `window` fully reported months before `currentMonth`. */
export function igResponse(rows: MarketingMonthRow[], currentMonth: string, window = 12): IgResponse | null {
  const usable = rows
    .filter((r) => r.month < currentMonth && (r.metaSpend ?? 0) > 0 && r.igSales !== undefined)
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, window);
  if (!usable.length) return null;
  const igSales = usable.reduce((s, r) => s + r.igSales!, 0);
  const spend = usable.reduce((s, r) => s + r.metaSpend!, 0);
  if (!(igSales > 0)) return null;
  return { costPerIgSale: spend / igSales, igSales, spend, months: usable.map((r) => r.month).sort() };
}

/** Units of the item per store sale (its units / all POS orders) over the last `window` complete months with orders. */
export function unitsPerStoreSale(history: MonthlySales[], posOrders: Map<string, number>, currentMonth: string, window = 6): number | null {
  const units = new Map(history.map((h) => [h.month, h.units]));
  const months = [...posOrders.keys()]
    .filter((m) => m < currentMonth && (posOrders.get(m) ?? 0) > 0)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, window);
  const orders = months.reduce((s, m) => s + posOrders.get(m)!, 0);
  const sold = months.reduce((s, m) => s + Math.max(0, units.get(m) ?? 0), 0);
  return orders > 0 && sold > 0 ? sold / orders : null;
}

export interface PushEffect {
  igSales: number;
  units: number;
  revenue: number | null;
  /** Gross profit on the extra units minus the spend; null without a cost price. */
  profit: number | null;
}

export function pushEffect(
  amount: number,
  response: IgResponse,
  unitsPerSale: number,
  price: number | null,
  cost: number | null,
): PushEffect {
  const igSales = amount / response.costPerIgSale;
  const units = igSales * unitsPerSale;
  return {
    igSales,
    units,
    revenue: price !== null ? units * price : null,
    profit: price !== null && cost !== null ? units * (price - cost) - amount : null,
  };
}

/** Extra spend needed to sell `units` more through Instagram-driven store sales. */
export function budgetToSell(units: number, response: IgResponse, unitsPerSale: number): number {
  return unitsPerSale > 0 ? (units / unitsPerSale) * response.costPerIgSale : Infinity;
}

export interface AskBy {
  /** First month a pile is projected (no extra marketing). */
  pileMonth: string;
  /** When to ask for the money: pileMonth minus the request lead time, never before this month. */
  askBy: string;
  now: boolean;
  /** Largest pile in the horizon. */
  peakUnits: number;
  peakMonth: string;
}

export function askBy(points: ProjectionPoint[], leadMonths: number, currentMonth: string): AskBy | null {
  const first = points.find((p) => p.pile > 0.5);
  if (!first) return null;
  const peak = points.reduce((a, p) => (p.pile > a.pile ? p : a), first);
  const ask = addMonths(first.month, -leadMonths);
  const now = ask <= currentMonth;
  return { pileMonth: first.month, askBy: now ? currentMonth : ask, now, peakUnits: peak.pile, peakMonth: peak.month };
}

/** Months of target cover: the admin's setting, else supplier lead time + 1 month, else 3 months. */
export function targetCoverMonths(override: number | null, leadTimeMaxDays: number | null): { months: number; source: string } {
  if (override && override > 0) return { months: override, source: "set by admin" };
  if (leadTimeMaxDays && leadTimeMaxDays > 0) {
    const months = Math.round((leadTimeMaxDays / 30 + 1) * 2) / 2;
    return { months, source: `${leadTimeMaxDays}-day lead time + 1 month` };
  }
  return { months: 3, source: "default - no lead time linked" };
}
