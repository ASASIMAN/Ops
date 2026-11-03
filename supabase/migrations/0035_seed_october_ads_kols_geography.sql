-- Rest of October 2026, same workbook as 0034 ("Ads Data", "KOL",
-- "Source" tabs).

-- --- Ads Data: monthly ad history ------------------------------------
-- October's campaign structure changed ("New structure (VID)" replaces
-- the "Mixed/old" style tag every month since April has carried) - kept
-- as given rather than normalized to the old style label.
insert into ad_monthly_history (month_label, scheduled_month, ad_label, spend_idr, purchases, impressions, reach, link_clicks, cpm_idr, cost_per_reach_idr, cost_per_purchase_idr, style_tag, pct_change_vs_previous_month) values
  ('Oct ''26', '2026-10-01', 'Warm Campaign', 3126580, 0, 253484, 109349, null, 12334, 29, null, 'New structure (VID)', '+5%'),
  ('Oct ''26', '2026-10-01', 'Cold Campaign', 7779825, 1, 705881, 287928, null, 11021, 27, 7779825, 'New structure (VID)', '+4%');

-- ad_monthly_highlights (Top 10) is intentionally NOT touched this
-- round - the source sheet's own ranked table wasn't updated for
-- October either (still ends at September's "Dec Store" #10). That
-- checks out: October's one purchase cost 7.78M, far worse than every
-- existing entry's CPA, so nothing from this month would qualify
-- regardless.

-- --- KOL tab: two corrections from a more complete export, plus real
-- new bookings (August gap, September already on file, November
-- confirmed ahead of schedule) -----------------------------------------
--
-- Correction 1: "Simion" (Aug 21) was recorded with two products -
-- Standard Issue Classic Navy L AND Standard Issue Oversized White L.
-- This export lists Simion with only the Classic Navy L, and a
-- previously-unknown person, "Putrianti Yunida" (Aug 21, same day),
-- with exactly the Oversized White L - the two gifts were to two
-- different people, not one. Corrected here rather than left
-- double-counted.
update kols
set product_given = 'Standard Issue Classic - Navy L (deadstock)'
where name = 'Simion' and month_label = 'August';

insert into kols (name, social_handle, gender, category, status, month_label, scheduled_month, booking_date, product_given, deliverables) values
  ('Putrianti Yunida', 'https://www.instagram.com/putriantiyunida/', 'Woman', 'KOL', 'Confirmed', 'August', '2026-08-01', '2026-08-21', 'Standard Issue Oversize - White L (deadstock)', 'IG Story');

-- Correction 2: "Komang" (Aug 18) was recorded with one product
-- (Origin Shorts). This export shows a second item on the same gift -
-- Falmouth Pinstripe Shirt S - not a new booking, just more complete
-- than what was on file.
update kols
set product_given = 'Falmouth Pinstripe Shirt - S (deadstock); Origin Shorts - Black S (deadstock)'
where name = 'Komang' and month_label = 'August';

-- October: zero rows in this tab for October - a real gap, not
-- something to backfill. Worth flagging to the creative team on its
-- own (see the November Creative Brief notes).

-- November: confirmed/pending bookings already entered ahead of
-- schedule - real data, not fabricated, so seeded now rather than
-- waiting for the calendar to catch up.
insert into kols (name, social_handle, gender, category, status, month_label, scheduled_month, booking_date, product_given, notes, deliverables) values
  ('Sean Martin', 'https://www.instagram.com/seanwmartinn/', 'Man', 'Influencer', 'Confirmed', 'November', '2026-11-01', '2026-11-02', 'Standard Issue Oversize - Black S (deadstock); Kavash T-Shirt - Off White S (deadstock); Henley Shirt - Off White XL (deadstock)', 'SoW: TikTok + IG Reel + IG Story', 'WAITING'),
  ('Arisuta (Place 2 Go Bali)', 'https://www.instagram.com/place2gobali/', 'Media', 'Influencer', 'Confirmed', 'November', '2026-11-01', '2026-11-04', 'TBC', 'SoW: TikTok + IG Reel + IG Story', null),
  ('Adam Setiadi', 'https://www.instagram.com/adam.setiadii/', 'Man', 'Influencer', 'Confirmed', 'November', '2026-11-01', '2026-11-07', 'TBC', 'SoW: TikTok + IG Reel + IG Story', null),
  ('The Bali Guideline', 'https://www.instagram.com/thebaliguideline_/', 'Media', 'Influencer', 'Pending Schedule', 'November', '2026-11-01', null, 'TBC', 'SoW: TikTok + IG Reel + IG Story', null);

-- --- Source tab: visitor geography snapshot, refreshed -----------------
-- Point-in-time snapshot (0021/0025's note still applies), replaced
-- wholesale with this month's numbers, same as last round.
delete from visitor_geography;

insert into visitor_geography (location, approx_visitors, pct_share) values
  ('Live in Bali', 759, 24.8),
  ('Australia', 572, 18.7),
  ('Russia', 190, 6.2),
  ('UK', 184, 6.0),
  ('USA', 165, 5.4),
  ('Germany', 142, 4.6),
  ('France', 135, 4.4),
  ('Saudi Arabia', 128, 4.2),
  ('India', 99, 3.2),
  ('Jakarta (Domestic)', 97, 3.2),
  ('China', 91, 3.0),
  ('Singapore', 48, 1.6),
  ('Japan', 42, 1.4),
  ('New Zealand', 42, 1.4),
  ('Netherlands', 35, 1.1),
  ('Canada', 29, 0.9),
  ('Indonesia (other)', 27, 0.9),
  ('Dubai (UAE)', 26, 0.8),
  ('Italy', 23, 0.8),
  ('Taiwan', 23, 0.8),
  ('Korea', 18, 0.6),
  ('Argentina', 15, 0.5),
  ('Hong Kong', 15, 0.5),
  ('Africa (unspecified)', 12, 0.4),
  ('Colombia', 10, 0.3),
  ('Malaysia', 10, 0.3),
  ('Romania', 10, 0.3),
  ('Spain', 10, 0.3),
  ('Turkey', 10, 0.3),
  ('Europe (unspecified)', 9, 0.3),
  ('Poland', 9, 0.3),
  ('Switzerland', 8, 0.3),
  ('Belgium', 7, 0.2),
  ('Brazil', 5, 0.2),
  ('Philippines', 5, 0.2),
  ('Denmark', 4, 0.1),
  ('Finland', 4, 0.1),
  ('Hungary', 4, 0.1),
  ('Sweden', 4, 0.1),
  ('Thailand', 4, 0.1),
  ('Greece', 3, 0.1),
  ('Iran', 3, 0.1),
  ('Morocco', 3, 0.1),
  ('Portugal', 3, 0.1),
  ('South Africa', 3, 0.1),
  ('Ukraine', 3, 0.1),
  ('Vietnam', 3, 0.1),
  ('Austria', 2, 0.1),
  ('Israel', 2, 0.1),
  ('Kazakhstan', 2, 0.1),
  ('Mexico', 2, 0.1),
  ('Albania', 1, 0.0),
  ('Estonia', 1, 0.0),
  ('Ireland', 1, 0.0),
  ('Lebanon', 1, 0.0),
  ('Lithuania', 1, 0.0),
  ('Maldives', 1, 0.0),
  ('Norway', 1, 0.0);
