-- November 2026 Creative Brief - month_key is November (published now),
-- about October's ad performance (meta_ads_reporting points at October),
-- same one-month lag convention as 0016/0026 before it.
--
-- UNLIKE those two: no team-written review document was provided this
-- round - the user asked for the observations and test briefs to be
-- generated from the real data itself (financials, Ads Data, the real
-- October Ads Manager CSV, Metricool's October social report, and the
-- KOL tab). Flagged here plainly: this is this app's own read of the
-- numbers, not a transcription of something the team wrote. Every claim
-- below traces to a real figure already seeded this round or previously
-- - nothing here is invented, but the synthesis/interpretation is mine.
--
-- Confidence tags, same house rule as every prior month: a real number
-- (or several, pointing the same way) earns Strong/Directional;
-- Anecdote is the default once a claim's base is too thin to trust
-- (item 5's "1 review" is a real count, but too small on its own to
-- read as a trend - hence Anecdote despite being a real figure).
--
-- Reach figures in item 2 are double-checked, not just copied from the
-- spreadsheet's own trend row: summing October's real Warm+Cold reach
-- (109,349 + 287,928 = 397,277) and September's (38,063 + 93,923 =
-- 131,986) from ad_monthly_history lines up with the sheet's own
-- "132k -> 397k" almost exactly.
--
-- Block B (Best Performing Ads) is left empty on purpose: the real
-- October CSV names exactly one ad with a result this month ("2609 |
-- COLD | Best Sellers | VID | v2 | B&S", 1 result at Rp 1,568,732) -
-- but there's no Instagram permalink for it (it's a Meta-only ad
-- creative), and that field needs a real URL, not just a name.

insert into creative_brief_months (month_key, meta_ads_reporting_start, meta_ads_reporting_end, review_md, notes_md, ad_links)
values (
  '2026-11',
  '2026-10-01',
  '2026-10-31',
  $md$## Creative test

- Find out why online orders cratered 73% on flat-to-higher ad spend and record reach - check the checkout funnel and landing pages before assuming it's a demand problem, since WhatsApp and in-store traffic didn't fall the same way
- Line up creative for the four confirmed/pending November KOLs now, so content doesn't sit idle into the Christmas window the September review already flagged
- Test whether October's lighter posting cadence (45 pieces, -36.62% vs September per Metricool) is driving the interaction drop - a content-pipeline question, not just a reach one
- Prompt for Google reviews at checkout or in-store - volume dropped from roughly 6 to 1 off an already-small base, and it costs nothing to ask
$md$,
  $md$1. Online sales fell sharply while in-store orders surged, and Meta's own online ROAS collapsed alongside it [Strong]
   - Online sales: Rp 23.0M (Sep) -> Rp 7.6M (Oct), -67%
   - In-store orders: 8 (Sep) -> 16 (Oct), +100%
   - Meta ROAS (online): 2.2x (Sep) -> 0.7x (Oct)

2. Meta hit its best reach and cheapest CPM of the entire 11-month tracked period, but conversions nearly disappeared [Strong]
   - Reach roughly tripled: ~132k (Sep) -> ~397k (Oct) - verified against the real per-campaign numbers (Warm 109,349 + Cold 287,928)
   - CPM fell to the lowest of the period: Rp 26,350 -> Rp 11,368 per thousand impressions
   - Purchases collapsed on flat-to-up spend: 10 (Sep) -> 1 (Oct), while spend rose Rp 10.46M -> Rp 10.91M

3. No KOL activity was logged in October - the only month since July with zero bookings [Strong]
   - July through September each had at least one real booking; October has none on file
   - Four November bookings are already Confirmed (Sean Martin, Arisuta, Adam Setiadi) or Pending Schedule (The Bali Guideline), so this reads as a one-month pause rather than a stalled pipeline

4. Organic Instagram engagement fell even as reach/impressions rose, on less content than usual [Directional]
   - Interactions: 103, -55.98% vs September
   - Impressions: 954.5K, +129.06% vs September - Metricool's combined figure isn't split out by organic vs. ad-amplified reach, so some of this rise may be the same Meta reach spike surfacing here rather than organic algorithm favor
   - Content published: 45 pieces, -36.62% vs September (2 posts, 3 reels, 40 stories)

5. Google Business Profile reviews nearly stopped - 1 new review in October vs roughly 6 in September [Anecdote]
   - Star rating held at 5.0, so this reads as a volume drop, not a quality one - the base (1 review) is too small to treat as a real trend yet
$md$,
  null
)
on conflict (month_key) do update set
  meta_ads_reporting_start = excluded.meta_ads_reporting_start,
  meta_ads_reporting_end = excluded.meta_ads_reporting_end,
  review_md = excluded.review_md,
  notes_md = excluded.notes_md,
  updated_at = now();
