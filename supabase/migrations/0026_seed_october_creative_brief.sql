-- October 2026 Creative Brief - the narrative/review month is October,
-- written about September's ad performance (meta_ads_reporting_start/end
-- point at September's dates), same lag convention as 0016's "September
-- narrative about August's ads".
--
-- Source: "ASASI · Marketing Review · Q3 2026 · July-September", a
-- polished quarterly PDF the user dropped and said was "notes from
-- September" - so it's being used as September's narrative, even though
-- its own text is framed as a Q3 (Jul-Sep) read. Only content that's
-- genuinely about September / the ad behaviour described is carried into
-- notes_md and review_md below - the document's quarter-level headline
-- numbers (guests +30% vs Q2, Meta spend +29% vs Q2, etc.) aren't
-- shoehorned in here, since this table's Account Health section reads
-- real per-month ad_performance_snapshots for a single reporting period,
-- not a quarterly rollup - those headline stats already have a home on
-- /marketing (monthly) and aren't duplicated into this table.
--
-- Confidence tags are NOT from the source document - it's a designed
-- report, not written in this app's notes.md convention, so it carries
-- no [Strong|Directional|Anecdote] tags of its own. Assigned here by the
-- same rule used throughout this app: a tag only when real numbers back
-- it, Anecdote by default otherwise.
--   1. Directional - two real monthly series (friend referrals, IG
--      visitors), each falling every month, but short (3 points) and
--      self-reported by store staff.
--   2. Directional - a real before/after tied to a specific policy
--      change (free shipping ending), but the document only gives a
--      qualitative "almost stopped" for the overseas side, not an exact
--      before/after order count split by geography.
--   3. Anecdote - no sales figure for underwear specifically, just "it
--      hasn't sold the way we hoped".
--   4. Anecdote - a general operational explanation, no cost figure
--      attached to what the Meta relearning actually costs.
--   5. Strong - three independent real monthly series (spend, cost per
--      checkout-start, WhatsApp chats) all move consistently across the
--      full quarter with no contradiction - the most corroborated claim
--      in the document.
-- Flag any of these the user would tag differently - there's no
-- objectively correct cutoff, this is a judgment call in the absence of
-- the document supplying its own tags.
--
-- Block B (Best Performing Ads): the document names "Best Sellers" as
-- September's best ad under "What we did this quarter" - matching what
-- the real Ads Manager CSV already shows (ad_performance_snapshots:
-- "Laskar - Sept Cold - Best Sellers", 4 results at ~Rp522,684/result,
-- the cheapest this month - see the /marketing "Ads pulse" tile). No
-- Instagram permalink is given for it anywhere in the document, so it
-- isn't added as a nominated link (that field expects a real URL, not a
-- name) - Block B will read "unavailable" until an ad-links.csv or a
-- permalink is provided.
--
-- Block C ("What to test next"): the document's "What Q4 needs" section
-- maps onto this table's "Creative test" heading (the only Block-C
-- section this app's parser recognises that fits a set of forward
-- actions - none of these six items are really "open questions").

insert into creative_brief_months (month_key, meta_ads_reporting_start, meta_ads_reporting_end, review_md, notes_md, ad_links)
values (
  '2026-10',
  '2026-09-01',
  '2026-09-30',
  $md$## Creative test

- A Christmas activation - last December's gifting ad was one of the cheapest-selling ads run to date; plan it now, not in December
- More KOLs to replace lost referrals - give each a code or name so it's possible to see who actually brings people in
- Lock the production schedule earlier - fixed stock dates mean ads run longer and cheaper, without Meta "restarting learning" mid-flight
- Ask one extra question at the till: "Did you see an ad, or find our page?" - to find out whether ads are working in store
- Decide on overseas shipping - a small threshold could bring back international orders
- Keep Google Maps fresh with new photos and reviews monthly - it's the #2 channel and it's free
$md$,
  $md$1. Friend referrals and Instagram-sourced visits both fell every month this quarter, so fewer people are telling others about us organically [Directional]
   - Friend referrals: 28 -> 19 -> 8 (Jul -> Aug -> Sep)
   - Instagram-sourced visitors: 24 -> 12 -> 8 over the same three months

2. Overseas online orders have almost stopped since free shipping ended; what's left is mostly domestic (Indonesia) orders [Directional]
   - September's online sales still recovered to Rp 23.0M on 15 orders

3. Underwear isn't pulling its weight, so it's getting less space in ads and posts [Anecdote]
   - Budget and content now goes behind what already sells: shirts and best-sellers

4. A messy production schedule costs money - when stock dates move, ads and posts get rebuilt [Anecdote]
   - Every time an ad is changed, Meta "restarts learning" and spend goes up while it re-learns

5. More ad money did not mean more online sales this quarter, but the ads themselves got measurably more efficient [Strong]
   - Meta spend rose 29% vs Q2, but online sales fell 34% vs Q2
   - Cost per ad checkout-start fell every month: Rp 3.5M -> Rp 1.3M -> Rp 1.0M (Jul -> Aug -> Sep)
   - WhatsApp chats started from ads rose every month too: 31 -> 33 -> 43 (Jul -> Aug -> Sep)
$md$,
  null
)
on conflict (month_key) do update set
  meta_ads_reporting_start = excluded.meta_ads_reporting_start,
  meta_ads_reporting_end = excluded.meta_ads_reporting_end,
  review_md = excluded.review_md,
  notes_md = excluded.notes_md,
  updated_at = now();
