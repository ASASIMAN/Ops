-- October 2026 Organic Social - a Metricool "Social Media Insights"
-- report (01-31 Oct '26), same source type and shape as July's (0011):
-- Instagram, Google Business Profile, website traffic (Metricool's own
-- site tracking), plus a Meta Ads overview.
--
-- Metricool's own Meta Ads summary (Impressions 959.37K, Spent 10.91M,
-- etc.) is NOT seeded here - it would duplicate the real, more granular
-- numbers the actual Ads Manager CSV import already provides via
-- ads/ad_performance_snapshots (see 0033's migration and the October
-- CSV import), and risks the two sources disagreeing. Metricool stays
-- the source for organic (Instagram/GBP/website) only, same division
-- of responsibility as every prior month.
--
-- "ig_new_followers" maps to this report's "Followers balance" card
-- (net change this period - the same concept July's number came from).
-- "ig_posts_count" maps to "Total content" (posts + reels + stories
-- combined, not just feed posts) - same as July, confirmed internally
-- this month: 2 posts + 3 reels + 40 stories = 45, matching the
-- "Total content" card exactly.

insert into facts_daily (date, source, entity_type, entity_id, metric, value) values
  ('2026-10-01', 'metricool_report', 'company', 'asasi', 'ig_followers', 3718),
  ('2026-10-01', 'metricool_report', 'company', 'asasi', 'ig_new_followers', 80),
  ('2026-10-01', 'metricool_report', 'company', 'asasi', 'ig_posts_count', 45),
  ('2026-10-01', 'metricool_report', 'company', 'asasi', 'ig_impressions', 954500),
  ('2026-10-01', 'metricool_report', 'company', 'asasi', 'ig_interactions', 103),
  ('2026-10-01', 'metricool_report', 'company', 'asasi', 'ig_stories_impressions', 1868),
  ('2026-10-01', 'metricool_report', 'company', 'asasi', 'ig_stories_count', 40),
  ('2026-10-01', 'gbp_report', 'company', 'asasi', 'gbp_impressions', 1868),
  ('2026-10-01', 'gbp_report', 'company', 'asasi', 'gbp_interactions', 243),
  ('2026-10-01', 'gbp_report', 'company', 'asasi', 'gbp_posts', 0),
  ('2026-10-01', 'metricool_web_report', 'company', 'asasi', 'website_views', 7739),
  ('2026-10-01', 'metricool_web_report', 'company', 'asasi', 'website_visits', 4110),
  ('2026-10-01', 'metricool_web_report', 'company', 'asasi', 'website_visitors', 3767)
on conflict (date, source, entity_type, entity_id, metric) do update set value = excluded.value;

-- Reels ranking (full engagement columns - likes/saved/comments/shares
-- individually, not just a combined interactions figure).
insert into organic_posts (post_type, published_at, text_snippet, impressions, reach, likes, saved, comments, shares, engagement_rate) values
  ('reel', '2026-10-06 18:05:00+08', 'Not many know we''ve been in Ubud since quite the beginning, somewhere behind the Monkey Forest. If y...', 1762, 1249, 37, 3, 4, 5, 3.92),
  ('reel', '2026-10-26 17:06:00+08', 'Origin Shirt in Black is a best seller for a reaso...', 481, 334, 13, 1, 2, 3, 5.69),
  ('reel', '2026-10-16 17:04:00+08', 'Not sure what to wear? What about this look, gents...', 1132, 854, 12, 4, 0, 3, 2.22);

-- Feed posts ranking (also full breakdown this month, unlike July's
-- export which only gave impressions+interactions for plain posts) -
-- "shares" isn't a tracked column for feed posts in this report's post
-- ranking table, so left null rather than assumed zero.
insert into organic_posts (post_type, published_at, text_snippet, impressions, reach, likes, saved, comments, engagement_rate) values
  ('post', '2026-10-29 17:05:00+08', 'Meet our Suede Tassel Loafers in Black and Brown. Made from soft suede leather with classic tassel d...', 437, 176, 8, 1, 1, 5.68),
  ('post', '2026-10-11 18:02:00+08', null, 626, 326, 6, 0, 0, 1.84);
