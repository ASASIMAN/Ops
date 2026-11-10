import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface ArrivalRow {
  year: number;
  month: number;
  foreign_arrivals: number;
}

export interface SeasonIndexPoint {
  month: number; // 1-12
  /** Average foreign arrivals for this calendar month, across every full year in the table. */
  avgArrivals: number;
  /** Share of an average year's total arrivals that falls in this month, as a percent (sums to ~100 across all 12). */
  indexPct: number;
  yearsAveraged: number;
}

/**
 * A calendar-month seasonality index (Jan..Dec, 12 points) built from
 * real arrivals data - NOT a forecast of any specific future year, just
 * "on average across the years on file, what share of annual arrivals
 * falls in this month". Only full years (12 real months) are used, so a
 * partial current year never pulls the average down for just its
 * elapsed months - see bali_tourist_arrivals' seed comment for exactly
 * which years that means and why.
 */
export function buildSeasonIndex(rows: ArrivalRow[]): SeasonIndexPoint[] {
  const byYear = new Map<number, Map<number, number>>();
  for (const r of rows) {
    if (!byYear.has(r.year)) byYear.set(r.year, new Map());
    byYear.get(r.year)!.set(r.month, r.foreign_arrivals);
  }
  const fullYears = Array.from(byYear.entries()).filter(([, m]) => m.size === 12);

  const sumByMonth = new Array(13).fill(0); // 1-indexed, [0] unused
  for (const [, monthMap] of fullYears) {
    for (const [month, arrivals] of monthMap) {
      sumByMonth[month] += arrivals;
    }
  }
  const avgByMonth = sumByMonth.map((s) => s / (fullYears.length || 1));
  const avgAnnualTotal = avgByMonth.slice(1).reduce((a, b) => a + b, 0);

  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    return {
      month,
      avgArrivals: avgByMonth[month],
      indexPct: avgAnnualTotal > 0 ? (avgByMonth[month] / avgAnnualTotal) * 100 : 0,
      yearsAveraged: fullYears.length,
    };
  });
}

export async function fetchArrivals(admin: AdminClient): Promise<ArrivalRow[]> {
  const { data } = await admin
    .from("bali_tourist_arrivals")
    .select("year, month, foreign_arrivals")
    .order("year", { ascending: true })
    .order("month", { ascending: true });
  return (data ?? []) as ArrivalRow[];
}

/** Flat 100/12 = 8.33% per month - the "no seasonality at all" baseline the index is compared against. */
export const EVEN_SHARE_PCT = 100 / 12;
