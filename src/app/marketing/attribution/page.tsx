import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const CHANNEL_LABELS: Record<string, string> = {
  walkin_member_count: "Members",
  walkin_instagram_count: "Instagram",
  walkin_tiktok_count: "TikTok",
  walkin_google_maps_count: "Google Maps",
  walkin_walking_by_count: "Walking by",
  walkin_friend_referral_count: "Friend referral",
  walkin_chatgpt_count: "ChatGPT",
  walkin_wa_business_count: "WA Business",
};
const CHANNEL_ORDER = Object.keys(CHANNEL_LABELS);

interface MonthData {
  date: string;
  metrics: Record<string, number>;
}

export default async function AttributionPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const admin = createAdminClient();

  const [{ data: rows }, { data: geoRows }] = await Promise.all([
    admin
      .from("facts_daily")
      .select("date, metric, value")
      .eq("source", "visitor_attribution_sheet")
      .order("date", { ascending: true }),
    admin
      .from("visitor_geography")
      .select("location, approx_visitors, pct_share")
      .order("approx_visitors", { ascending: false }),
  ]);

  const byMonth = new Map<string, MonthData>();
  for (const row of rows ?? []) {
    if (!byMonth.has(row.date)) byMonth.set(row.date, { date: row.date, metrics: {} });
    byMonth.get(row.date)!.metrics[row.metric] = Number(row.value);
  }
  const months = Array.from(byMonth.values()).sort((a, b) => a.date.localeCompare(b.date));
  const selected = months.find((m) => m.date === monthParam) ?? months[months.length - 1];
  const selectedIndex = months.findIndex((m) => m.date === selected?.date);
  const prior = selectedIndex > 0 ? months[selectedIndex - 1] : undefined;

  const channels = selected
    ? CHANNEL_ORDER.map((metric) => ({
        metric,
        label: CHANNEL_LABELS[metric],
        count: selected.metrics[metric],
      })).filter((c) => c.count !== undefined)
    : [];
  const maxCount = Math.max(...channels.map((c) => c.count), 1);
  const total = selected?.metrics.walkin_total_count;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Attribution &amp; Visitors</h1>
        <Link href="/marketing" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50">
          ← Marketing
        </Link>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        What customers say brought them in, self-reported in store. Real monthly counts, not
        derived from Meta or Google Maps data - there&apos;s no per-channel platform number yet
        to check this against (see the Insights page).
      </p>

      {months.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-600 dark:text-zinc-400">No attribution data yet.</p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
            {months
              .slice()
              .reverse()
              .map((m) => (
                <Link
                  key={m.date}
                  href={`/marketing/attribution?month=${m.date}`}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    m.date === selected.date
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                      : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
                  }`}
                >
                  {MONTH_LABEL.format(new Date(m.date + "T00:00:00Z"))}
                </Link>
              ))}
          </div>

          <div className="mt-6">
            <h2 className="text-lg font-medium">
              {MONTH_LABEL.format(new Date(selected.date + "T00:00:00Z"))}
              {total !== undefined && (
                <span className="ml-2 text-sm font-normal text-zinc-500">{total} total</span>
              )}
            </h2>
            <div className="mt-3 space-y-2">
              {channels.map((c) => {
                const priorCount = prior?.metrics[c.metric];
                const delta =
                  priorCount !== undefined && priorCount !== 0
                    ? Math.round(((c.count - priorCount) / priorCount) * 100)
                    : null;
                return (
                  <div key={c.metric} className="text-xs">
                    <div className="flex justify-between text-zinc-500">
                      <span>{c.label}</span>
                      <span>
                        {c.count}
                        {delta !== null && (
                          <span className="ml-1">
                            ({delta > 0 ? "+" : ""}
                            {delta}% MoM)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mt-0.5 h-3 bg-zinc-100 dark:bg-zinc-900">
                      <div
                        className="h-3 bg-zinc-700 dark:bg-zinc-400"
                        style={{ width: `${(c.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {CHANNEL_ORDER.some((metric) => selected.metrics[metric] === undefined) && (
              <p className="mt-3 text-xs text-zinc-500">
                Some channels (ChatGPT, WA Business) weren&apos;t tracked as categories before
                April &apos;26 - not shown for earlier months rather than shown as zero.
              </p>
            )}
          </div>
        </>
      )}

      {geoRows && geoRows.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-medium">Visitor geography</h2>
          <p className="mt-1 text-xs text-zinc-500">
            A point-in-time snapshot, not tied to a specific month - the source doesn&apos;t say
            what period it covers.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-zinc-500">
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2 text-right">Approx. visitors</th>
                  <th className="px-3 py-2 text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {geoRows.map((g) => (
                  <tr key={g.location} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-2">{g.location}</td>
                    <td className="px-3 py-2 text-right">{g.approx_visitors}</td>
                    <td className="px-3 py-2 text-right">{g.pct_share}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
