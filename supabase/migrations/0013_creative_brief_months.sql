-- Creative Brief: monthly file-drop system, replacing the idea of wiring
-- up the Meta Marketing API. Each month's ad-level numbers still come
-- through the existing ads/ad_performance_snapshots tables (same CSV
-- import path, keyed by reporting_start/reporting_end) - this table only
-- holds the parts those don't cover: the monthly review doc, the
-- creative team's qualitative notes, and the ad-name -> Instagram
-- permalink mapping, plus which reporting period's ad data this
-- month's narrative is actually about (the September review can be
-- about August's numbers - that link isn't assumed, it's recorded).
create table if not exists creative_brief_months (
  month_key text primary key, -- 'YYYY-MM', the narrative/review month
  meta_ads_reporting_start date,
  meta_ads_reporting_end date,
  review_md text,
  notes_md text,
  -- [{ "ad_name": "...", "permalink": "https://instagram.com/..." }]
  ad_links jsonb,
  updated_at timestamptz not null default now()
);

alter table creative_brief_months enable row level security;
