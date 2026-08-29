import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const SORTABLE_COLUMNS = {
  spend: "amount_spent_idr",
  impressions: "impressions",
  reach: "reach",
  purchases: "purchases",
  cpa: "cost_per_purchase_idr",
} as const;

type SortKey = keyof typeof SORTABLE_COLUMNS;

interface Snapshot {
  ad_id: number;
  amount_spent_idr: number;
  impressions: number;
  reach: number;
  purchases: number | null;
  cost_per_purchase_idr: number | null;
  quality_ranking: string | null;
  engagement_ranking: string | null;
  conversion_ranking: string | null;
  ads: {
    ad_name: string;
    ad_set_name: string;
    temperature: string;
    variant_label: string | null;
  } | null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export default async function PaidMediaPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string; sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const supabase = createAdminClient();

  const { data: periodRows } = await supabase
    .from("ad_performance_snapshots")
    .select("reporting_start, reporting_end")
    .order("reporting_start", { ascending: false });

  const periods = Array.from(
    new Map(
      (periodRows ?? []).map((p) => [
        `${p.reporting_start}_${p.reporting_end}`,
        p,
      ]),
    ).values(),
  );

  if (!periods.length) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Paid Media</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          No ad data imported yet.{" "}
          <Link href="/marketing/import" className="underline">
            Import a Meta Ads CSV
          </Link>{" "}
          to get started.
        </p>
      </div>
    );
  }

  const selected =
    periods.find(
      (p) => p.reporting_start === params.start && p.reporting_end === params.end,
    ) ?? periods[0];

  const sortKey: SortKey =
    params.sort && params.sort in SORTABLE_COLUMNS
      ? (params.sort as SortKey)
      : "spend";
  const sortDir = params.dir === "asc" ? "asc" : "desc";

  const { data: rows } = await supabase
    .from("ad_performance_snapshots")
    .select(
      `
      ad_id, amount_spent_idr, impressions, reach, purchases, cost_per_purchase_idr,
      quality_ranking, engagement_ranking, conversion_ranking,
      ads ( ad_name, ad_set_name, temperature, variant_label )
      `,
    )
    .eq("reporting_start", selected.reporting_start)
    .eq("reporting_end", selected.reporting_end)
    .order(SORTABLE_COLUMNS[sortKey], {
      ascending: sortDir === "asc",
      nullsFirst: false,
    });

  const snapshots = (rows ?? []) as unknown as Snapshot[];

  const byTemperature = { cold: [] as Snapshot[], warm: [] as Snapshot[], unknown: [] as Snapshot[] };
  for (const s of snapshots) {
    const t = (s.ads?.temperature ?? "unknown") as keyof typeof byTemperature;
    byTemperature[t].push(s);
  }

  function summarize(group: Snapshot[]) {
    const spend = group.reduce((sum, s) => sum + Number(s.amount_spent_idr), 0);
    const purchases = group.reduce((sum, s) => sum + Number(s.purchases ?? 0), 0);
    const impressions = group.reduce((sum, s) => sum + Number(s.impressions), 0);
    return {
      spend,
      purchases,
      cpa: purchases > 0 ? spend / purchases : null,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    };
  }

  const coldSummary = summarize(byTemperature.cold);
  const warmSummary = summarize(byTemperature.warm);

  let coldVsWarmVerdict = "Not enough purchase data yet to compare cold vs warm efficiency this period.";
  if (coldSummary.cpa !== null && warmSummary.cpa !== null) {
    coldVsWarmVerdict =
      coldSummary.cpa < warmSummary.cpa
        ? `Cold is more efficient this period: ${currencyFormatter.format(coldSummary.cpa)} per purchase vs ${currencyFormatter.format(warmSummary.cpa)} for warm - cold looks like the better place to add budget.`
        : `Warm is more efficient this period: ${currencyFormatter.format(warmSummary.cpa)} per purchase vs ${currencyFormatter.format(coldSummary.cpa)} for cold - warm looks like the better place to add budget.`;
  }

  const cpaValues = snapshots
    .filter((s) => s.cost_per_purchase_idr && Number(s.purchases) > 0)
    .map((s) => Number(s.cost_per_purchase_idr));
  const cpaMedian = median(cpaValues);

  const leaderboard = snapshots
    .filter((s) => s.cost_per_purchase_idr && Number(s.purchases) > 0)
    .sort((a, b) => Number(a.cost_per_purchase_idr) - Number(b.cost_per_purchase_idr))
    .slice(0, 5);

  function sortLink(key: SortKey) {
    const nextDir = sortKey === key && sortDir === "desc" ? "asc" : "desc";
    const qs = new URLSearchParams({
      start: selected.reporting_start,
      end: selected.reporting_end,
      sort: key,
      dir: nextDir,
    });
    return `/marketing/paid-media?${qs}`;
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Paid Media</h1>
        <Link
          href="/marketing/import"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          Import CSV →
        </Link>
      </div>

      <p className="mt-4 text-sm text-zinc-500">Reporting period:</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {periods.map((p) => {
          const isActive =
            p.reporting_start === selected.reporting_start &&
            p.reporting_end === selected.reporting_end;
          return (
            <Link
              key={`${p.reporting_start}_${p.reporting_end}`}
              href={`/marketing/paid-media?start=${p.reporting_start}&end=${p.reporting_end}`}
              className={`rounded-full border px-3 py-1 text-xs ${
                isActive
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
              }`}
            >
              {p.reporting_start} → {p.reporting_end}
            </Link>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs font-medium uppercase text-zinc-500">
            Cold ({byTemperature.cold.length} ads)
          </div>
          <div className="mt-1 text-lg font-semibold">
            {currencyFormatter.format(coldSummary.spend)}
          </div>
          <div className="text-sm text-zinc-500">
            {coldSummary.purchases} purchases
            {coldSummary.cpa !== null &&
              ` · ${currencyFormatter.format(coldSummary.cpa)} CPA`}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs font-medium uppercase text-zinc-500">
            Warm ({byTemperature.warm.length} ads)
          </div>
          <div className="mt-1 text-lg font-semibold">
            {currencyFormatter.format(warmSummary.spend)}
          </div>
          <div className="text-sm text-zinc-500">
            {warmSummary.purchases} purchases
            {warmSummary.cpa !== null &&
              ` · ${currencyFormatter.format(warmSummary.cpa)} CPA`}
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        {coldVsWarmVerdict}
      </p>

      {leaderboard.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-medium">Top performing ads</h2>
          <ol className="mt-2 space-y-2">
            {leaderboard.map((s, i) => (
              <li
                key={s.ad_id}
                className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
              >
                <span className="font-medium">
                  {i + 1}. {s.ads?.ad_name}
                </span>
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                  {currencyFormatter.format(Number(s.cost_per_purchase_idr))} per
                  purchase
                  {cpaMedian !== null &&
                    ` - ${Math.round(
                      (1 - Number(s.cost_per_purchase_idr) / cpaMedian) * 100,
                    )}% below this period's median (${currencyFormatter.format(cpaMedian)})`}
                  , {s.purchases} purchase{Number(s.purchases) === 1 ? "" : "s"}.
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2">Ad</th>
              <th className="px-3 py-2">Temp</th>
              <th className="px-3 py-2 text-right">
                <Link href={sortLink("spend")}>Spend</Link>
              </th>
              <th className="px-3 py-2 text-right">
                <Link href={sortLink("impressions")}>Impressions</Link>
              </th>
              <th className="px-3 py-2 text-right">
                <Link href={sortLink("reach")}>Reach</Link>
              </th>
              <th className="px-3 py-2 text-right">
                <Link href={sortLink("purchases")}>Purchases</Link>
              </th>
              <th className="px-3 py-2 text-right">
                <Link href={sortLink("cpa")}>CPA</Link>
              </th>
              <th className="px-3 py-2">Quality</th>
              <th className="px-3 py-2">Engagement</th>
              <th className="px-3 py-2">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s) => (
              <tr
                key={s.ad_id}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-3 py-2">
                  <div>{s.ads?.ad_name}</div>
                  <div className="text-xs text-zinc-500">{s.ads?.ad_set_name}</div>
                </td>
                <td className="px-3 py-2 capitalize">{s.ads?.temperature}</td>
                <td className="px-3 py-2 text-right">
                  {currencyFormatter.format(Number(s.amount_spent_idr))}
                </td>
                <td className="px-3 py-2 text-right">
                  {Number(s.impressions).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  {Number(s.reach).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">{s.purchases ?? "-"}</td>
                <td className="px-3 py-2 text-right">
                  {s.cost_per_purchase_idr
                    ? currencyFormatter.format(Number(s.cost_per_purchase_idr))
                    : "-"}
                </td>
                <td className="px-3 py-2">{s.quality_ranking ?? "-"}</td>
                <td className="px-3 py-2">{s.engagement_ranking ?? "-"}</td>
                <td className="px-3 py-2">{s.conversion_ranking ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
