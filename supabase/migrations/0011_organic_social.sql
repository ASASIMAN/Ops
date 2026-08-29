-- Build order step 8, scoped to what's actually real: Organic Social.
--
-- Source: a PPTX uploaded earlier in this build turned out to be a
-- Metricool-generated "Social Media Insights" report for 01-31 Jul '26 -
-- Instagram, Google Business Profile, website traffic (via Metricool's
-- own site tracking, not confirmed to be literally GA4), and Meta Ads
-- overview numbers. Real data, extracted by hand from that report (not
-- a raw Metricool CSV export, so no reusable adapter is built yet - see
-- README).
--
-- Shopify and GA4 are NOT touched here: no export file or API access has
-- been provided for either, so there's nothing real to seed and nothing
-- to build against without guessing column names. Same for Retail &
-- Local's per-store cards - the GBP numbers in this report are
-- business-wide, not broken out per location, so a per-store view would
-- have to fabricate a split that isn't in the source.

create table if not exists organic_posts (
  id bigint generated always as identity primary key,
  platform text not null default 'instagram',
  post_type text check (post_type in ('post', 'reel', 'story')),
  published_at timestamptz not null,
  text_snippet text,
  impressions integer,
  interactions integer,
  reach integer,
  likes integer,
  saved integer,
  comments integer,
  shares integer,
  engagement_rate numeric,
  created_at timestamptz not null default now()
);

create index if not exists organic_posts_published_at_idx on organic_posts (published_at);

alter table organic_posts enable row level security;

-- Reels ranking (richer columns than the general post ranking) - 3 of
-- these overlap with posts also shown in the general ranking; kept once,
-- here, with the fuller data rather than duplicated as a plain post.
insert into organic_posts (post_type, published_at, text_snippet, impressions, reach, likes, saved, comments, shares, engagement_rate) values
  ('reel', '2026-07-21 18:04:00+08', 'It''s coming together in Nusa Dua. This space has been thought through more times than we can count.', 1309, 1078, 22, 5, 2, 6, 3.25),
  ('reel', '2026-07-29 18:11:00+08', 'The Duffle MK.II, a better version of itself. Refined where it matters, while keeping what made it work.', 1391, 1168, 21, 11, 1, 11, 3.77),
  ('reel', '2026-07-24 18:03:00+08', 'The Falmouth Pinstripe is back. Look closer. Every time it returns, it comes back slightly different.', 1281, 1001, 17, 10, 2, 10, 3.9);

-- General post ranking (impressions + interactions only) - the 3 posts
-- above are intentionally excluded here since they're already inserted
-- with fuller reel data.
insert into organic_posts (post_type, published_at, text_snippet, impressions, interactions) values
  ('post', '2026-07-22 18:03:00+08', 'Gents, when we do this, we make it worth it. Win IDR 5,000,000 worth of selected ASASI products.', 1810, 39),
  ('post', '2026-07-04 18:02:00+08', 'This one has been a long time coming. Every corner considered, every detail decided. More soon.', 1766, 39),
  ('post', '2026-07-17 18:02:00+08', 'For pieces worth wearing every day. Find us in Pererenan.', 1219, 28),
  ('post', '2026-07-13 18:03:00+08', null, 1073, 16),
  ('post', '2026-07-02 16:05:00+08', null, 309, null),
  ('post', '2026-07-03 12:02:00+08', null, 110, null),
  ('post', '2026-07-12 12:02:00+08', '@somafightclub', 96, null),
  ('post', '2026-07-13 14:31:00+08', null, 95, null),
  ('post', '2026-07-13 14:31:00+08', null, 90, null),
  ('post', '2026-07-13 14:31:00+08', null, 86, null),
  ('post', '2026-07-05 12:02:00+08', null, 83, null),
  ('post', '2026-07-13 14:32:00+08', null, 81, null),
  ('post', '2026-07-06 12:02:00+08', null, 80, null),
  ('post', '2026-07-13 14:32:00+08', null, 78, null),
  ('post', '2026-07-04 18:13:00+08', null, 73, null),
  ('post', '2026-07-27 15:10:00+08', null, 64, null),
  ('post', '2026-07-24 18:50:00+08', null, 64, null);

-- Aggregate metrics for the July '26 report period. entity is
-- company-wide, same as the financials data - no per-store breakdown
-- exists in this source.
insert into facts_daily (date, source, entity_type, entity_id, metric, value) values
  ('2026-07-01', 'metricool_report', 'company', 'asasi', 'ig_followers', 3481),
  ('2026-07-01', 'metricool_report', 'company', 'asasi', 'ig_new_followers', 120),
  ('2026-07-01', 'metricool_report', 'company', 'asasi', 'ig_posts_count', 74),
  ('2026-07-01', 'metricool_report', 'company', 'asasi', 'ig_impressions', 666120),
  ('2026-07-01', 'metricool_report', 'company', 'asasi', 'ig_interactions', 240),
  ('2026-07-01', 'metricool_report', 'company', 'asasi', 'ig_stories_impressions', 1605),
  ('2026-07-01', 'metricool_report', 'company', 'asasi', 'ig_stories_count', 67),
  ('2026-07-01', 'gbp_report', 'company', 'asasi', 'gbp_impressions', 1557),
  ('2026-07-01', 'gbp_report', 'company', 'asasi', 'gbp_interactions', 217),
  ('2026-07-01', 'gbp_report', 'company', 'asasi', 'gbp_posts', 0),
  ('2026-07-01', 'metricool_web_report', 'company', 'asasi', 'website_views', 9373),
  ('2026-07-01', 'metricool_web_report', 'company', 'asasi', 'website_visits', 4556),
  ('2026-07-01', 'metricool_web_report', 'company', 'asasi', 'website_visitors', 3883)
on conflict (date, source, entity_type, entity_id, metric) do update set value = excluded.value;
