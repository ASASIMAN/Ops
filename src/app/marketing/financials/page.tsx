import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateAssumptionAction } from "./actions";

export const dynamic = "force-dynamic";

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

interface MonthMetrics {
  date: string;
  metrics: Record<string, number>;
}

function fmtIdr(v: number | undefined) {
  return v === undefined ? "-" : currencyFormatter.format(v);
}

function fmtNum(v: number | undefined) {
  return v === undefined ? "-" : v.toLocaleString();
}

export default async function FinancialsPage() {
  const supabase = createAdminClient();

  const [{ data: factRows }, { data: assumptionRows }, { data: kolRows }] =
    await Promise.all([
      supabase
        .from("facts_daily")
        .select("date, metric, value")
        .eq("source", "financials_sheet")
        .order("date", { ascending: true }),
      supabase.from("assumptions").select("key, value, label").order("key"),
      supabase
        .from("kols")
        .select("scheduled_month, opportunity_cost_idr")
        .not("scheduled_month", "is", null),
    ]);

  const byMonth = new Map<string, MonthMetrics>();
  for (const row of factRows ?? []) {
    if (!byMonth.has(row.date)) byMonth.set(row.date, { date: row.date, metrics: {} });
    byMonth.get(row.date)!.metrics[row.metric] = Number(row.value);
  }

  // Auto-rolled from the KOL CRM (build order step 7), per the brief -
  // only counts entries with a numeric opportunity_cost_idr, since most
  // existing KOL records only have a free-text cost description.
  for (const row of kolRows ?? []) {
    if (row.opportunity_cost_idr === null) continue;
    const monthDate = `${row.scheduled_month!.slice(0, 7)}-01`;
    if (!byMonth.has(monthDate)) byMonth.set(monthDate, { date: monthDate, metrics: {} });
    const m = byMonth.get(monthDate)!;
    m.metrics.kol_opportunity_cost_rolled_idr =
      (m.metrics.kol_opportunity_cost_rolled_idr ?? 0) + Number(row.opportunity_cost_idr);
  }
  const months = Array.from(byMonth.values()).sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  const assumptions = new Map(
    (assumptionRows ?? []).map((a) => [a.key, a]),
  );
  const ltvMultiplier = assumptions.get("ltv_multiplier_offline_wa")?.value;
  const monthlyBudget = assumptions.get("monthly_marketing_budget_idr")?.value;

  // Budget pacing: use the most recent month that actually has spend data,
  // which won't always be the real calendar's current month (this month's
  // numbers may not be entered yet - that's "no data," not "on pace").
  const latestMonth = months.find((m) => m.metrics.total_spend_idr !== undefined);
  let pacing: React.ReactNode = "No spend data entered yet.";
  if (latestMonth) {
    const spend = latestMonth.metrics.total_spend_idr;
    const budget = latestMonth.metrics.total_budget_idr ?? monthlyBudget;
    const monthDate = new Date(latestMonth.date + "T00:00:00Z");
    const now = new Date();
    const isCurrentCalendarMonth =
      monthDate.getUTCFullYear() === now.getUTCFullYear() &&
      monthDate.getUTCMonth() === now.getUTCMonth();

    if (!budget) {
      pacing = `${fmtIdr(spend)} spent in ${MONTH_LABEL.format(monthDate)} - no budget set for that month to compare against.`;
    } else if (isCurrentCalendarMonth) {
      const daysInMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
      ).getUTCDate();
      const dayOfMonth = now.getUTCDate();
      const projected = (spend / dayOfMonth) * daysInMonth;
      const pacingPercent = Math.round((projected / budget) * 100);
      const flag =
        pacingPercent > 110
          ? " ⚠️ pacing over budget"
          : pacingPercent < 70
            ? " - well under budget, room to spend more"
            : "";
      pacing = `${fmtIdr(spend)} spent through day ${dayOfMonth} of ${daysInMonth} - projected to land at ${fmtIdr(projected)} (${pacingPercent}% of the ${fmtIdr(budget)} budget).${flag}`;
    } else {
      const percent = Math.round((spend / budget) * 100);
      pacing = `${MONTH_LABEL.format(monthDate)} (last complete month with data): ${fmtIdr(spend)} spent, ${percent}% of the ${fmtIdr(budget)} budget.`;
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Financials</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Monthly P&amp;L from the Financials sheet export.
      </p>

      <div className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-medium">Budget pacing</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{pacing}</p>
      </div>

      <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30">
        <h2 className="font-medium text-amber-900 dark:text-amber-400">
          Not available yet
        </h2>
        <p className="mt-1 text-amber-800 dark:text-amber-500">
          AOV, LTV, Blended CAC, First-Time Contribution, and MRR aren&apos;t
          shown here - they need online order counts (not just online
          revenue), which live in the Financials sheet&apos;s &quot;Unit
          Economics&quot; tab, separate from the P&amp;L summary that&apos;s
          seeded so far. That tab hasn&apos;t been read yet (Google Drive
          access is still pending re-authorization). Not fabricating these
          from an assumed AOV rather than showing them wrong.
        </p>
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-medium">Assumptions</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(assumptionRows ?? []).map((a) => (
            <form
              key={a.key}
              action={updateAssumptionAction}
              className="flex flex-col gap-1 text-sm"
            >
              <input type="hidden" name="key" value={a.key} />
              <label className="text-xs text-zinc-500">{a.label ?? a.key}</label>
              <div className="flex gap-1">
                <input
                  type="number"
                  step="any"
                  name="value"
                  defaultValue={a.value}
                  className="w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
                />
                <button
                  type="submit"
                  className="rounded border border-zinc-300 px-2 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  Save
                </button>
              </div>
            </form>
          ))}
        </div>
      </div>

      <div className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2">Month</th>
              <th className="px-3 py-2 text-right">Instore orders</th>
              <th className="px-3 py-2 text-right">Online sales</th>
              <th className="px-3 py-2 text-right">Meta spend</th>
              <th className="px-3 py-2 text-right">Google spend</th>
              <th className="px-3 py-2 text-right">TikTok spend</th>
              <th className="px-3 py-2 text-right">Marketing cost</th>
              <th className="px-3 py-2 text-right" title="From the KOL CRM - only counts KOL records with a numeric opportunity cost entered.">
                KOL cost*
              </th>
              <th className="px-3 py-2 text-right">Total spend</th>
              <th className="px-3 py-2 text-right">Budget</th>
              <th className="px-3 py-2 text-right" title="Approximation: online sales ÷ Meta spend. Assumes all online sales are Meta-driven, which overstates ROAS if other channels contribute.">
                Meta ROAS*
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const roas =
                m.metrics.meta_ad_spend_idr && m.metrics.online_sales_idr
                  ? m.metrics.online_sales_idr / m.metrics.meta_ad_spend_idr
                  : undefined;
              return (
                <tr
                  key={m.date}
                  className="border-t border-zinc-100 dark:border-zinc-800"
                >
                  <td className="px-3 py-2">
                    {MONTH_LABEL.format(new Date(m.date + "T00:00:00Z"))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fmtNum(m.metrics.instore_sales_orders)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fmtIdr(m.metrics.online_sales_idr)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fmtIdr(m.metrics.meta_ad_spend_idr)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fmtIdr(m.metrics.google_ad_spend_idr)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fmtIdr(m.metrics.tiktok_spend_idr)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fmtIdr(m.metrics.marketing_cost_idr)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fmtIdr(m.metrics.kol_opportunity_cost_rolled_idr)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {fmtIdr(m.metrics.total_spend_idr)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fmtIdr(m.metrics.total_budget_idr)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {roas ? `${roas.toFixed(2)}x` : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        *Meta ROAS here is online sales ÷ Meta spend, which assumes all
        online sales are Meta-driven - a real overstatement on months with
        meaningful Google/TikTok/organic contribution. Treat it as a rough
        signal, not a precise per-channel figure, until sales are properly
        attributed by source.
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        *KOL cost is rolled up automatically from{" "}
        <Link href="/marketing/kols" className="underline">
          the KOL CRM
        </Link>
        , and only totals records with a numeric opportunity cost entered
        - most existing records only have a free-text description
        (&quot;500k Voucher&quot; etc.), so this understates true KOL
        spend until those are given numeric values.
      </p>

      {ltvMultiplier && (
        <p className="mt-2 text-xs text-zinc-500">
          Offline/WA LTV = AOV × {ltvMultiplier} (editable above) - not
          computed into a figure here yet since offline/WA AOV isn&apos;t in
          the seeded data either.
        </p>
      )}
    </div>
  );
}
