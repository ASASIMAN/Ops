import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface FactRow {
  date: string;
  source: string;
  metric: string;
  value: number;
}

interface Post {
  id: number;
  post_type: string | null;
  published_at: string;
  text_snippet: string | null;
  impressions: number | null;
  interactions: number | null;
  reach: number | null;
  likes: number | null;
  saved: number | null;
  comments: number | null;
  shares: number | null;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

export default async function OrganicSocialPage() {
  const admin = createAdminClient();

  const [{ data: factRows }, { data: postRows }] = await Promise.all([
    admin
      .from("facts_daily")
      .select("date, source, metric, value")
      .in("source", ["metricool_report", "gbp_report", "metricool_web_report"]),
    admin
      .from("organic_posts")
      .select(
        "id, post_type, published_at, text_snippet, impressions, interactions, reach, likes, saved, comments, shares",
      )
      .order("impressions", { ascending: false, nullsFirst: false }),
  ]);

  const metrics: Record<string, number> = {};
  for (const row of (factRows ?? []) as FactRow[]) {
    metrics[row.metric] = row.value;
  }
  const posts = (postRows ?? []) as Post[];
  const hasData = Object.keys(metrics).length > 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Organic Social</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        From a Metricool report covering 1-31 Jul &apos;26 - the only
        organic social data available so far. No Metricool CSV adapter
        exists yet (see README); this is hand-extracted from a report
        export, not a repeatable import.
      </p>

      {!hasData ? (
        <p className="mt-6 text-sm text-zinc-500">No data yet.</p>
      ) : (
        <>
          <h2 className="mt-6 text-sm font-medium text-zinc-500">Instagram</h2>
          <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Followers" value={metrics.ig_followers?.toLocaleString() ?? "-"} />
            <Stat label="New followers" value={metrics.ig_new_followers?.toLocaleString() ?? "-"} />
            <Stat label="Posts" value={metrics.ig_posts_count?.toLocaleString() ?? "-"} />
            <Stat label="Impressions" value={metrics.ig_impressions?.toLocaleString() ?? "-"} />
          </div>

          <h2 className="mt-6 text-sm font-medium text-zinc-500">
            Google Business Profile (business-wide, not per-store)
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Impressions" value={metrics.gbp_impressions?.toLocaleString() ?? "-"} />
            <Stat label="Interactions" value={metrics.gbp_interactions?.toLocaleString() ?? "-"} />
            <Stat label="Posts" value={metrics.gbp_posts?.toLocaleString() ?? "-"} />
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            The brief&apos;s Retail &amp; Local module wants this broken out
            per store (4 separate Business Profiles) - this report only
            gives one business-wide number, so a per-store view isn&apos;t
            built yet rather than splitting this arbitrarily across
            stores.
          </p>

          <h2 className="mt-6 text-sm font-medium text-zinc-500">
            Website (via Metricool&apos;s site tracking)
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Views" value={metrics.website_views?.toLocaleString() ?? "-"} />
            <Stat label="Visits" value={metrics.website_visits?.toLocaleString() ?? "-"} />
            <Stat label="Visitors" value={metrics.website_visitors?.toLocaleString() ?? "-"} />
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Not confirmed to be literally GA4 - the report doesn&apos;t say
            what feeds this. Shopify revenue/orders aren&apos;t shown at
            all: no Shopify export or API access has been provided.
          </p>
        </>
      )}

      <h2 className="mt-8 text-lg font-medium">Top posts &amp; reels this period</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2">Published</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Text</th>
              <th className="px-3 py-2 text-right">Impressions</th>
              <th className="px-3 py-2 text-right">Interactions</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-3 py-2 whitespace-nowrap">
                  {new Date(p.published_at).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 capitalize">{p.post_type ?? "-"}</td>
                <td className="px-3 py-2 max-w-xs truncate" title={p.text_snippet ?? ""}>
                  {p.text_snippet ?? "-"}
                </td>
                <td className="px-3 py-2 text-right">
                  {p.impressions?.toLocaleString() ?? "-"}
                </td>
                <td className="px-3 py-2 text-right">
                  {p.interactions?.toLocaleString() ??
                    (p.likes !== null
                      ? `${(p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saved ?? 0)}`
                      : "-")}
                </td>
              </tr>
            ))}
            {!posts.length && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  No posts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
