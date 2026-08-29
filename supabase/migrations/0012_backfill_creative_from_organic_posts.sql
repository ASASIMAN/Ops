-- Backfills the Creative Planner with the real July '26 posts/reels
-- already seeded in organic_posts (0011), marked Published with their
-- real dates - so the planner shows real history instead of sitting
-- empty. Also pulls each post's real Metricool performance onto the
-- card via metricool_performance, per the brief's "after publish, pull
-- that post's performance back onto the card."
--
-- Not filled in: pillar (not knowable from the Metricool export - it
-- doesn't tag posts by content pillar), and asset_link/reference_link
-- (the source report has no real post URLs, just a placeholder "Go"
-- button with no href captured in the export - left null rather than
-- inventing a link).

insert into content_calendar (post_date, format, copy, production_status, metricool_performance)
select
  date(published_at),
  case when post_type = 'reel' then 'Video' else null end,
  text_snippet,
  'Published',
  jsonb_build_object(
    'impressions', impressions,
    'interactions', interactions,
    'reach', reach,
    'likes', likes,
    'saved', saved,
    'comments', comments,
    'shares', shares
  )
from organic_posts;
