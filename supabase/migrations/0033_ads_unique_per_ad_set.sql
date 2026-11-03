-- Fixes a real import-breaking bug found while verifying the October
-- Meta Ads CSV (a full-account export, 206 rows, vs. the single-month
-- 12-row exports seen so far): `ads.ad_name` was unique on its own,
-- but this account genuinely reuses the same ad name across more than
-- one ad set (Meta lets a creative be duplicated into several ad sets
-- while keeping its name - e.g. "zOLD | 2411 | LAL | Creative 03 | VID
-- | v1" exists in both a "BALI+JKT" and an "AUS" ad set this month).
--
-- With ad_name alone unique, both ad sets' rows collapsed onto one
-- `ads` row, and upserting two ad_performance_snapshots rows for the
-- same (ad_id, reporting period) in one batch - once per real distinct
-- ad - fails outright ("ON CONFLICT DO UPDATE command cannot affect
-- row a second time"), taking the entire import down with it, not just
-- the colliding rows. Verified against a local Postgres 16 with the
-- real 206-row export before and after this fix.
--
-- The identity of an ad, for this app's purposes, is really (ad_name,
-- ad_set_name) - matching how src/lib/adapters/ingest-meta-ads.ts
-- already de-duplicates incoming rows.

alter table ads drop constraint if exists ads_ad_name_key;
alter table ads add constraint ads_ad_name_ad_set_name_key unique (ad_name, ad_set_name);
