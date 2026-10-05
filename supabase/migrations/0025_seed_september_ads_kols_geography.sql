-- Rest of September 2026, same workbook as 0024 ("Ads Data", "KOL",
-- "Source" tabs).

-- --- Ads Data: monthly ad history ------------------------------------
insert into ad_monthly_history (month_label, scheduled_month, ad_label, spend_idr, purchases, impressions, reach, link_clicks, cpm_idr, cost_per_reach_idr, cost_per_purchase_idr, style_tag, pct_change_vs_previous_month) values
  ('Sep ''26', '2026-09-01', 'Warm Campaign', 2965453, 3, 110931, 38063, null, 26732, 78, 988484, 'Mixed/old', '-3%'),
  ('Sep ''26', '2026-09-01', 'Cold Campaign', 7494867, 7, 286044, 93923, null, 26202, 80, 1070695, 'Mixed/old', '-3%');

-- --- Ads Data: Top 10 highlights table --------------------------------
-- The sheet's own ranked table was recompiled with September's ads
-- folded in (two new entries at rank 5 and 8; everyone else's "NEW."
-- callout from last month's read was dropped by the sheet since they're
-- no longer new). It's a full re-rank, not an append, so this replaces
-- the table wholesale rather than inserting alongside the stale ranks
-- from 0020.
--
-- Two "Best Ad" cells for ranks 3 and 6 ("March 02 (shop)" and
-- "June 02") are stored by the sheet as the literal dates 2 Mar 2026 /
-- 2 Jun 2026 (format "mmmm dd") - Google Sheets autocorrecting a typed
-- "March 02" / "June 02" label into a date, the same kind of spreadsheet
-- artifact as the "#ERROR!" cell skipped in 0020. Restored to the text
-- label here rather than stored as a date that was never really meant.
delete from ad_monthly_highlights;

insert into ad_monthly_highlights (rank, ad_label, reason, month_label, spend_idr, purchases, cpm_idr, best_ad_label, instore_purchase_count) values
  (1, 'Laskar – March Pic Carousel warm', '• Lowest CPA of the entire period (181,459) • Warm/retargeting • Spend fell -59% and still converted', 'June ''26', 181459, 1, 30616, 'March Pic Carousel warm', 20),
  (2, 'Laskar – June – Warm', '• 2nd-lowest CPA (277,658), best of August • Warm audience, mid-size budget', 'Aug ''26', 832973, 3, 35246, 'June Warm', 12),
  (3, 'Laskar – March 02 (shop)', '• 3rd-lowest CPA (314,114) • Cold audience, low spend, still converted', 'May ''26', 314114, 1, 28676, 'March 02', 27),
  (4, 'Laskar – June 02 – Warm', '• CPA 490,917 on 2 results • Warm, consistent converter across two months', 'Aug ''26', 981834, 2, 27805, 'June 02 Warm', 12),
  (5, 'Laskar – Sept Cold – Best Sellers', '• NEW. Best CPA of September (522,684) • Cold, best-sellers creative • Highest-volume converter of the month (4 results, 2 purchases)', 'Sep ''26', 2090737, 4, 22049, 'Sept Cold Best Sellers', 8),
  (6, 'Laskar – June 02', '• CPA 654,295 • Delivered 2 of July''s 3 results on just 12% of spend', 'July ''26', 1308590, 2, 22906, 'June 02', 24),
  (7, 'New Store (canggu)', '• Scalable • Strong CPA • Only Jan converter', 'Jan ''26', null, 4, 16573, 'New Store', 13),
  (8, 'Laskar – Sept Cold – Best Sellers Vid', '• NEW. CPA 855,555 on 2 results • Video creative, cold audience • Second-best September performer', 'Sep ''26', 1711110, 2, 33338, 'Sept Cold BS Vid', 8),
  (9, 'Gifting Ad', '• Best CPA by far • Lowest CPM • Proven converter', 'Dec ''25', null, 3, 20110, 'Gifting', 13),
  (10, 'Dec Store', '• Volume driver • High clicks', 'Dec ''25', null, null, null, null, null);

-- --- KOL tab: September bookings + one August gap -----------------------
-- Three real September bookings (Barry, Mega, Ixfan - all "Confirmed").
--
-- "Jeane Ayu" (August 18, Kavash Crop T-Shirt - Black, KOL, Confirmed)
-- is on this sheet but wasn't in the hand-pasted August backfill (0017)
-- - a real gap in what's on file, not a duplicate of anyone already
-- there (checked against every August row's name and product).
insert into kols (name, social_handle, gender, category, status, month_label, scheduled_month, booking_date, product_given, notes) values
  ('Jeane Ayu', 'https://www.instagram.com/jeaneayu/', 'Woman', 'KOL', 'Confirmed', 'August', '2026-08-01', '2026-08-18', 'Kavash Crop T-Shirt - Black (deadstock)', 'Content: IG Story'),
  ('Barry', 'https://www.instagram.com/barryprawira.k/', 'Man', 'Influencer', 'Confirmed', 'September', '2026-09-01', '2026-09-24', 'Kavash T-Shirt - Off White M (deadstock); Origin Shorts - Black XL (deadstock)', 'Content: waiting'),
  ('Mega', 'https://www.instagram.com/trulyevils/', 'Woman', 'KOL', 'Confirmed', 'September', '2026-09-01', '2026-09-14', 'Kavash Crop T-Shirt - Off White (deadstock)', 'Content: https://www.instagram.com/reel/DdoH_ZES06s/'),
  ('Ixfan', 'https://www.instagram.com/ixfanh/', 'Man', 'Talent, Influencer', 'Confirmed', 'September', '2026-09-01', '2026-09-08', 'Ribbed Vest - Off White S; Ribbed Vest - Black S; Affine Shirt - Off White S; Falmouth Pinstripe Shirt S; Falmouth Pinstripe Shorts S (all deadstock)', 'Content: IG Story');

-- --- Source tab: visitor geography snapshot, refreshed -----------------
-- Point-in-time snapshot (0021's note still applies: doesn't carry a
-- date, the source doesn't say what period it covers) - replaced
-- wholesale with this month's refreshed numbers rather than kept
-- alongside the old ones, same as the highlights table above. The new
-- export also carries 3 decimal places on % share (e.g. 0.283) instead
-- of whole-number rounding, so pct_share here is to 1 decimal instead
-- of 0 - more precise than 0021, not a different measurement.
delete from visitor_geography;

insert into visitor_geography (location, approx_visitors, pct_share) values
  ('Live in Bali', 716, 28.3),
  ('Australia', 445, 17.6),
  ('UK', 155, 6.1),
  ('Russia', 149, 5.9),
  ('Germany', 132, 5.2),
  ('Saudi Arabia', 119, 4.7),
  ('USA', 119, 4.7),
  ('France', 113, 4.5),
  ('Jakarta (Domestic)', 97, 3.8),
  ('India', 72, 2.9),
  ('China', 62, 2.5),
  ('New Zealand', 38, 1.5),
  ('Singapore', 35, 1.4),
  ('Japan', 31, 1.2),
  ('Netherlands', 24, 1.0),
  ('Dubai (UAE)', 22, 0.9),
  ('Taiwan', 20, 0.8),
  ('Canada', 18, 0.7),
  ('Korea', 17, 0.7),
  ('Italy', 16, 0.6),
  ('Argentina', 15, 0.6),
  ('Hong Kong', 15, 0.6),
  ('Africa (unspecified)', 12, 0.5),
  ('Colombia', 9, 0.4),
  ('Europe (unspecified)', 8, 0.3),
  ('Romania', 8, 0.3),
  ('Malaysia', 5, 0.2),
  ('Poland', 5, 0.2),
  ('Spain', 5, 0.2),
  ('Brazil', 4, 0.2),
  ('Sweden', 4, 0.2),
  ('Belgium', 3, 0.1),
  ('Switzerland', 3, 0.1),
  ('Thailand', 3, 0.1),
  ('Turkey', 3, 0.1),
  ('Ukraine', 3, 0.1),
  ('Vietnam', 3, 0.1),
  ('Austria', 2, 0.1),
  ('Indonesia (other)', 2, 0.1),
  ('Israel', 2, 0.1),
  ('Mexico', 2, 0.1),
  ('Portugal', 2, 0.1),
  ('Albania', 1, 0.0),
  ('Estonia', 1, 0.0),
  ('Finland', 1, 0.0),
  ('Hungary', 1, 0.0),
  ('Iran', 1, 0.0),
  ('Lebanon', 1, 0.0),
  ('Morocco', 1, 0.0),
  ('Norway', 1, 0.0);
