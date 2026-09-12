-- September '26 Creative Brief - the narrative/review month is September,
-- but it's written about August's ad performance (0015), which is why
-- meta_ads_reporting_start/end point at August dates while month_key is
-- '2026-09'. That link is recorded explicitly here, not assumed by a
-- "always look at last month" rule in the app.
--
-- No review.md was provided for this month, so it's left null on
-- purpose - Block C ("What to test next") will render its honest empty
-- state rather than a fabricated one. No ad-links.csv either, so Block B
-- uses notes.md's "Best performing ads (nominated)" section instead,
-- rendered as team picks, not a ranking.
--
-- Confidence tags: item 1 is Directional (given explicitly); items 2, 6
-- and 7 are Anecdote (given explicitly); items 3, 4 and 5 default to
-- Anecdote per the standing rule (no number behind them). Item 3 keeps
-- its two measurements - weakest-performing-content and low-Instagram-
-- visits - as separate evidence lines rather than one proven cause,
-- since this month's data shows Instagram visits don't track Meta spend.
-- No specific figures are attached to any item beyond what's written
-- here - none were provided for September, so none are invented.

insert into creative_brief_months (month_key, meta_ads_reporting_start, meta_ads_reporting_end, review_md, notes_md, ad_links)
values (
  '2026-09',
  '2026-08-01',
  '2026-08-31',
  null,
  $md$1. Shop videos perform best when posted early in the month [Directional]

2. Vespa content drew engagement but skewed negative [Anecdote]

3. Underwear posts have been the weakest performing category — low number of Instagram visits [Anecdote]
   - weakest performing category: based on organic content performance, not ad spend
   - low Instagram visits: a separate, Instagram-sourced visitor metric — this month's review shows Instagram visits don't track Meta ad spend, so this isn't presented as one proven cause

4. Strongest ad under Esya: https://www.instagram.com/reel/DZuSUXSiByu/ [Anecdote]

5. Proven content goes first, experimentation follows [Anecdote]

6. Free product gifting for TikTok creators around 1–1.5 mio — give away low-sales products and deadstock, as referrals are low [Anecdote]

7. TikTok fresh start in Q4 (GRWM, raw KOL footage self-edited, funny EGC). Threads to follow once TikTok shows results. Still the biggest market left on the table. [Anecdote]

## Best performing ads (nominated)
1. https://www.instagram.com/p/DWVT8iVk7lG/
2. https://www.instagram.com/p/DZj-7bNDm-k/
3. https://www.instagram.com/p/DVqUo_ViuiP/
$md$,
  null
)
on conflict (month_key) do update set
  meta_ads_reporting_start = excluded.meta_ads_reporting_start,
  meta_ads_reporting_end = excluded.meta_ads_reporting_end,
  notes_md = excluded.notes_md,
  updated_at = now();
