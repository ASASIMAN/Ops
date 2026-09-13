-- Visitor nationality/location snapshot (Google Sheet "Source" tab,
-- second table). A point-in-time snapshot, not a monthly series like
-- the walk-in attribution data (0018) - doesn't carry a date, since the
-- source doesn't say what period it covers. New information, not
-- derivable from anything already in the app.
--
-- The channel-mix table at the top of the same "Source" tab (Walk-Ins
-- 38%, Members 24%, etc.) is NOT seeded here - it's just the average of
-- the monthly walk-in attribution counts already seeded in 0018
-- (verified: Instagram's "13.6 avg visits/month" there is exactly the
-- mean of the 21 real monthly Instagram counts), so it's computed in
-- the app from that real data instead of stored twice.

create table if not exists visitor_geography (
  id bigint generated always as identity primary key,
  location text not null,
  approx_visitors numeric not null,
  pct_share numeric,
  created_at timestamptz not null default now()
);

alter table visitor_geography enable row level security;

insert into visitor_geography (location, approx_visitors, pct_share) values
  ('Live in Bali', 670, 34),
  ('Australia', 326, 17),
  ('Germany', 114, 6),
  ('UK', 113, 6),
  ('Russia', 113, 6),
  ('Saudi Arabia', 94, 5),
  ('France', 81, 4),
  ('USA', 80, 4),
  ('Jakarta (Domestic)', 80, 4),
  ('India', 55, 3),
  ('China', 45, 2),
  ('Singapore', 29, 2),
  ('Japan', 23, 1),
  ('New Zealand', 22, 1),
  ('Dubai (UAE)', 16, 1),
  ('Argentina', 15, 1),
  ('Canada', 13, 1),
  ('Netherlands', 12, 1),
  ('Korea', 10, 1),
  ('Romania', 7, 0),
  ('Italy', 7, 0),
  ('Taiwan', 5, 0),
  ('Colombia', 5, 0),
  ('Hong Kong', 5, 0),
  ('Europe (unspecified)', 4, 0),
  ('Spain', 4, 0),
  ('Poland', 3, 0),
  ('Sweden', 3, 0),
  ('Mexico', 2, 0),
  ('Turkey', 2, 0),
  ('Africa (unspecified)', 1, 0);
