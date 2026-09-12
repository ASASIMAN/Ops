import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadCreativeBriefMonthAction } from "./actions";
import {
  parseNotesObservations,
  parseTestBriefs,
  parseNominatedAds,
  type Observation,
  type Confidence,
} from "@/lib/creative-brief/parse";
import { formatBaliDateTime, formatRupiahCompact, baliMonthFormatter } from "@/lib/creative-brief/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ASASI palette - dark forest green, cream/gold, deep burgundy. Scoped to
// this page only; the rest of the app keeps its neutral zinc/amber look.
const PAGE_BG = "bg-[#FBF7EC] dark:bg-[#10201A]";
const INK = "text-[#241C12] dark:text-[#F3ECDD]";
const MUTED = "text-[#6b6252] dark:text-[#b9ae98]";
const FOREST = "text-[#16342A] dark:text-[#7BB596]";
const CARD = "border border-[#e4dcc6] bg-white/70 dark:border-[#2a3b30] dark:bg-[#17281F]/70";

interface MonthRow {
  month_key: string;
  meta_ads_reporting_start: string | null;
  meta_ads_reporting_end: string | null;
  review_md: string | null;
  notes_md: string | null;
  ad_links: { adName: string; permalink: string }[] | null;
}

interface Snapshot {
  ad_id: number;
  amount_spent_idr: number;
  results: number | null;
  result_indicator: string | null;
  cost_per_results: number | null;
  purchases: number | null;
  cost_per_purchase_idr: number | null;
  total_messaging_contacts: number | null;
  quality_ranking: string | null;
  engagement_ranking: string | null;
  conversion_ranking: string | null;
  last_significant_edit: string | null;
  ads: { ad_name: string } | null;
}

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  Strong: "bg-[#16342A] text-[#F3ECDD] dark:bg-[#4C8768] dark:text-[#0d1712]",
  Directional: "bg-[#B8862B] text-white dark:bg-[#D8B24C] dark:text-[#241C12]",
  Anecdote: "border border-[#B8862B] text-[#6b6252] dark:border-[#D8B24C] dark:text-[#b9ae98]",
};

function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CONFIDENCE_STYLE[confidence]}`}
    >
      {confidence}
    </span>
  );
}

function monthLabel(monthKey: string) {
  return baliMonthFormatter.format(new Date(monthKey + "-01T00:00:00Z"));
}

async function fetchSnapshots(
  admin: ReturnType<typeof createAdminClient>,
  start: string | null,
  end: string | null,
): Promise<Snapshot[]> {
  if (!start || !end) return [];
  const { data } = await admin
    .from("ad_performance_snapshots")
    .select(
      "ad_id, amount_spent_idr, results, result_indicator, cost_per_results, purchases, cost_per_purchase_idr, total_messaging_contacts, quality_ranking, engagement_ranking, conversion_ranking, last_significant_edit, ads ( ad_name )",
    )
    .eq("reporting_start", start)
    .eq("reporting_end", end);
  return (data ?? []) as unknown as Snapshot[];
}

export default async function CreativeBriefPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; error?: string }>;
}) {
  const { month: monthParam, error } = await searchParams;
  const admin = createAdminClient();

  const { data: monthRows } = await admin
    .from("creative_brief_months")
    .select("month_key, meta_ads_reporting_start, meta_ads_reporting_end, review_md, notes_md, ad_links")
    .order("month_key", { ascending: true });

  const months = (monthRows ?? []) as MonthRow[];
  const selected = months.find((m) => m.month_key === monthParam) ?? months[months.length - 1];
  const selectedIndex = months.findIndex((m) => m.month_key === selected?.month_key);
  const previous = selectedIndex > 0 ? months[selectedIndex - 1] : undefined;

  const snapshots = selected
    ? await fetchSnapshots(admin, selected.meta_ads_reporting_start, selected.meta_ads_reporting_end)
    : [];
  const previousSnapshots = previous
    ? await fetchSnapshots(admin, previous.meta_ads_reporting_start, previous.meta_ads_reporting_end)
    : [];

  const observations: Observation[] = selected ? parseNotesObservations(selected.notes_md) : [];
  const testBriefs = selected ? parseTestBriefs(selected.review_md) : [];
  const nominatedAds = selected ? parseNominatedAds(selected.notes_md) : [];

  // Block B: ranked from the export when ad-links.csv exists and matches
  // real ad names; otherwise fall back to the team's own picks in
  // notes.md, honestly labeled as such rather than implied as a ranking.
  let bestAds: { permalink: string; adName: string | null; note: string | null; count: number | null }[] = [];
  let bestAdsSource: "ranked" | "nominated" | "none" = "none";
  let rankingSuppressed = false;

  if (selected?.ad_links && selected.ad_links.length > 0) {
    const byName = new Map(snapshots.map((s) => [s.ads?.ad_name, s]));
    const matched = selected.ad_links
      .map((link) => ({ link, snapshot: byName.get(link.adName) }))
      .filter((m) => m.snapshot)
      .map((m) => ({
        link: m.link,
        metric: m.snapshot!.results ?? m.snapshot!.total_messaging_contacts ?? 0,
      }))
      .sort((a, b) => b.metric - a.metric);

    if (matched.length > 0) {
      bestAdsSource = "ranked";
      if (matched.length >= 2 && matched[0].metric > 0 && matched[0].metric / matched[1].metric < 2) {
        rankingSuppressed = true;
      }
      bestAds = matched.slice(0, 3).map((m) => ({
        permalink: m.link.permalink,
        adName: m.link.adName,
        note: null,
        count: m.metric,
      }));
    }
  }
  if (bestAdsSource === "none" && nominatedAds.length > 0) {
    bestAdsSource = "nominated";
    bestAds = nominatedAds.slice(0, 3).map((n) => ({
      permalink: n.permalink,
      adName: null,
      note: n.note,
      count: null,
    }));
  }

  // Account Health - the operational stuff (rankings, CPA outliers, MoM
  // spend/results) collapsed behind a disclosure, not the headline.
  const belowAverage = snapshots.filter(
    (s) =>
      s.amount_spent_idr > 0 &&
      [s.quality_ranking, s.engagement_ranking, s.conversion_ranking].some((r) =>
        r?.toLowerCase().includes("below average"),
      ),
  );
  const totalSpend = snapshots.reduce((sum, s) => sum + (s.amount_spent_idr || 0), 0);
  const totalResults = snapshots.reduce((sum, s) => sum + (s.results || 0), 0);
  const prevTotalSpend = previousSnapshots.reduce((sum, s) => sum + (s.amount_spent_idr || 0), 0);
  const prevTotalResults = previousSnapshots.reduce((sum, s) => sum + (s.results || 0), 0);
  const hasMoM = previous && previousSnapshots.length > 0 && snapshots.length > 0;

  return (
    <div className={`${PAGE_BG} ${INK} print:bg-white print:text-black`}>
      <div className="mx-auto max-w-3xl px-6 py-10 print:py-4">
        <div className="flex items-center justify-between print:hidden">
          <Link href="/marketing" className={`text-xs ${MUTED} hover:underline`}>
            ← Marketing
          </Link>
        </div>

        <h1 className={`mt-4 text-2xl font-semibold tracking-tight ${FOREST} print:mt-0`}>
          Creative Brief
        </h1>

        {months.length === 0 ? (
          <p className={`mt-4 text-sm ${MUTED}`}>
            No months yet. Drop this month&apos;s documents below to publish the first one.
          </p>
        ) : (
          <>
            <p className={`mt-1 text-sm ${MUTED}`}>
              {selected && monthLabel(selected.month_key)}
              {months.length > 1 && !hasMoM && " · only one month with ad data - no month-over-month comparison"}
            </p>

            <div className="mt-4 flex flex-wrap gap-2 print:hidden">
              {months
                .slice()
                .reverse()
                .map((m) => (
                  <Link
                    key={m.month_key}
                    href={`/marketing/creative-brief?month=${m.month_key}`}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      m.month_key === selected?.month_key
                        ? "border-[#16342A] bg-[#16342A] text-white dark:border-[#4C8768] dark:bg-[#4C8768] dark:text-[#0d1712]"
                        : `border-[#e4dcc6] ${MUTED} hover:border-[#B8862B] dark:border-[#2a3b30]`
                    }`}
                  >
                    {monthLabel(m.month_key)}
                  </Link>
                ))}
            </div>
          </>
        )}

        {error && (
          <p className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">
            {error}
          </p>
        )}

        {selected && (
          <>
            {/* Block A - Content Observations & Direction */}
            <section className="mt-8">
              <h2 className={`text-lg font-semibold ${FOREST}`}>Content Observations &amp; Direction</h2>
              {!selected.notes_md ? (
                <p className={`mt-2 text-sm ${MUTED}`}>
                  No notes.md for {monthLabel(selected.month_key)} — content observations unavailable.
                </p>
              ) : observations.length === 0 ? (
                <p className={`mt-2 text-sm ${MUTED}`}>notes.md has no numbered observations.</p>
              ) : (
                <ol className="mt-3 space-y-3">
                  {observations.map((obs, i) => (
                    <li key={i} className={`rounded-lg p-4 ${CARD}`}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium">
                          {i + 1}. {obs.sentence}
                        </p>
                        <ConfidenceChip confidence={obs.confidence} />
                      </div>
                      {obs.evidence.map((e, j) => (
                        <p key={j} className={`mt-1 text-xs ${MUTED}`}>
                          {e}
                        </p>
                      ))}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Block B - Best Performing Ads */}
            <section className="mt-8">
              <h2 className={`text-lg font-semibold ${FOREST}`}>
                Best Performing Ads
                {bestAdsSource === "nominated" && (
                  <span className={`ml-2 text-xs font-normal ${MUTED}`}>(nominated by the team)</span>
                )}
              </h2>
              {bestAdsSource === "none" ? (
                <p className={`mt-2 text-sm ${MUTED}`}>
                  No ad-links.csv or team-nominated links for {monthLabel(selected.month_key)} — best
                  performing ads unavailable.
                </p>
              ) : (
                <>
                  {rankingSuppressed && (
                    <p className={`mt-2 text-xs ${MUTED}`}>
                      Shown unranked - the top two are within 2x of each other, and at this sample size
                      (roughly one purchase a week, a dozen messaging contacts across eight ads) that gap
                      is noise, not a real ordering.
                    </p>
                  )}
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {bestAds.map((ad, i) => (
                      <a
                        key={i}
                        href={ad.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`block rounded-lg p-4 text-sm hover:opacity-90 ${CARD}`}
                      >
                        <div className={`text-xs font-semibold ${FOREST}`}>
                          {bestAdsSource === "ranked" && !rankingSuppressed ? `#${i + 1} · ` : ""}
                          {monthLabel(selected.month_key)}
                        </div>
                        <div className="mt-1 truncate underline">{ad.permalink}</div>
                        {ad.adName && <div className={`mt-1 text-xs ${MUTED}`}>{ad.adName}</div>}
                        {ad.note && <p className={`mt-1 text-xs ${MUTED}`}>{ad.note}</p>}
                        {ad.count !== null && (
                          <p className={`mt-1 text-xs ${MUTED}`}>{ad.count} results (raw count)</p>
                        )}
                      </a>
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* Block C - What to test next */}
            <section className="mt-8">
              <h2 className={`text-lg font-semibold ${FOREST}`}>What to test next</h2>
              {!selected.review_md ? (
                <p className={`mt-2 text-sm ${MUTED}`}>
                  No review.md for {monthLabel(selected.month_key)} — creative-test / open-questions
                  briefs unavailable.
                </p>
              ) : testBriefs.length === 0 ? (
                <p className={`mt-2 text-sm ${MUTED}`}>
                  review.md has no Creative test or Open questions section.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {testBriefs.map((t, i) => (
                    <li key={i} className={`rounded-lg p-4 text-sm ${CARD}`}>
                      <p>{t.text}</p>
                      <p className={`mt-1 text-xs ${MUTED}`}>
                        Owner: {t.owner ?? "TBD"} · Due: {t.due ?? "TBD"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Account Health - operational stuff, collapsed, not the headline */}
            <details className="mt-10 rounded-lg border border-[#e4dcc6] p-4 text-sm dark:border-[#2a3b30] print:hidden">
              <summary className={`cursor-pointer text-sm font-medium ${FOREST}`}>
                Account health (operational - Meta rankings, spend, CPA)
              </summary>
              <div className="mt-3 space-y-3">
                {snapshots.length === 0 ? (
                  <p className={MUTED}>No ad data linked to this month yet.</p>
                ) : (
                  <>
                    <p>
                      Spend this period: {formatRupiahCompact(totalSpend)}
                      {hasMoM && ` (${formatRupiahCompact(prevTotalSpend)} last period)`} · Results:{" "}
                      {totalResults}
                      {hasMoM && ` (${prevTotalResults} last period)`}
                    </p>
                    {!hasMoM && (
                      <p className={`text-xs ${MUTED}`}>
                        Only one period of ad data exists for this comparison - no month-over-month delta
                        shown.
                      </p>
                    )}
                    {belowAverage.length > 0 ? (
                      <div>
                        <p className="font-medium">Below-average ranking, still spending:</p>
                        <ul className="mt-1 list-disc pl-5">
                          {belowAverage.map((s, i) => (
                            <li key={i}>
                              {s.ads?.ad_name ?? "unnamed ad"} — {formatRupiahCompact(s.amount_spent_idr)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className={MUTED}>No ads flagged below-average while spending this period.</p>
                    )}
                  </>
                )}
              </div>
            </details>
          </>
        )}

        {/* Drop documents */}
        <details className="mt-10 rounded-lg border border-[#e4dcc6] p-4 text-sm dark:border-[#2a3b30] print:hidden">
          <summary className={`cursor-pointer font-medium ${FOREST}`}>
            Drop documents for a month
          </summary>
          <form
            action={uploadCreativeBriefMonthAction}
            encType="multipart/form-data"
            className="mt-3 flex flex-col gap-3"
          >
            <label className="flex flex-col gap-1">
              Month (YYYY-MM)
              <input
                type="text"
                name="monthKey"
                placeholder="2026-10"
                required
                pattern="\d{4}-\d{2}"
                defaultValue={selected?.month_key}
                className="rounded border border-[#e4dcc6] px-2 py-1.5 dark:border-[#2a3b30] dark:bg-transparent"
              />
            </label>
            <label className="flex flex-col gap-1">
              meta-ads.csv (Ads Manager export)
              <input type="file" name="metaAdsCsv" accept=".csv" className="text-xs" />
            </label>
            <label className="flex flex-col gap-1">
              review.md (monthly review doc)
              <input type="file" name="reviewMd" accept=".md,.txt" className="text-xs" />
            </label>
            <label className="flex flex-col gap-1">
              notes.md (qualitative notes, optional)
              <input type="file" name="notesMd" accept=".md,.txt" className="text-xs" />
            </label>
            <label className="flex flex-col gap-1">
              ad-links.csv (ad_name,permalink — optional)
              <input type="file" name="adLinksCsv" accept=".csv" className="text-xs" />
            </label>
            <button
              type="submit"
              className="mt-1 self-start rounded bg-[#16342A] px-4 py-1.5 text-sm text-white dark:bg-[#4C8768] dark:text-[#0d1712]"
            >
              Save month
            </button>
            <p className={`text-xs ${MUTED}`}>
              Re-uploading a month updates it - any file left blank keeps what&apos;s already saved for
              that month.
            </p>
          </form>
        </details>

        {snapshots.some((s) => s.last_significant_edit) && (
          <p className={`mt-6 text-[10px] ${MUTED} print:hidden`}>
            Last ad edit: {formatBaliDateTime(snapshots.find((s) => s.last_significant_edit)!.last_significant_edit!)}
          </p>
        )}
      </div>
    </div>
  );
}
