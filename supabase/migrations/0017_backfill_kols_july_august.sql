-- Real outcomes for July/August KOL bookings, given by hand (same kind
-- of update the Creative Planner got from real Metricool data - except
-- here there's no export to pull from, just the real answers).
--
-- Three of the original placeholder rows (name unknown at seed time,
-- described by social_handle instead - see 0005's note on this) turn
-- out to be the same bookings as three of these new rows, matched by
-- their identical product lists and dates: "Dika?" (July, Ambassador
-- Collab) is Dika (SOMA); "Vespa Owner" (August) is Gauthier; "Julian +
-- GF" (August) is Giulian. Those are updated in place rather than
-- inserted as new rows, so the booking count doesn't double-count.
--
-- Rows given that already matched what's on file exactly (Tiktok SEO,
-- Photo shoot Esya, Dika? and "Male fort shoot with sekar maybe" all
-- Not confirmed/Missed for their month) aren't touched - no new
-- information in them.

update kols
set name = 'Dika (SOMA)',
    social_handle = 'https://www.instagram.com/dikasochirin/',
    notes = 'SOMA. Gifted 30 July 2026',
    product_given = 'Vayu T-Shirt - Off White M (deadstock); Ribbed Vest - Off White M (deadstock); Origin Shorts - Hearthstone L (deadstock)'
where social_handle = 'Dika?' and month_label = 'July' and category = 'Ambassador Collab';

update kols
set name = 'Gauthier',
    notes = 'Vespa guy. Gifted 14 August 2026. Store credit - ask Asha',
    product_given = 'Opulent Shirt - Black M (Pererenan store)'
where social_handle = 'Vespa Owner' and month_label = 'August';

update kols
set name = 'Giulian',
    notes = 'Talent. Gifted 5 August 2026',
    product_given = 'Underwear - Off White M (HQ stock); Underwear - Black M (HQ stock); Ribbed Vest - Off White M (HQ stock); Tote Bag - Brown (HQ stock)'
where name = 'Julian + GF' and month_label = 'August';

insert into kols (name, category, status, month_label, scheduled_month, notes, product_given) values
  ('Isaac', 'KOL', 'Confirmed', 'August', '2026-08-01', 'Gifted 18 August 2026', 'Shadow Long Sleeve - L (ex-content); Tote Bag - Brown (HQ stock)'),
  ('Reggy', 'KOL', 'Confirmed', 'August', '2026-08-01', 'Gifted 18 August 2026', 'Falmouth Pinstripe Shirt - M (HQ stock); Falmouth Pinstripe Shorts - M (HQ stock); Origin Long Sleeve - Black M (HQ stock)'),
  ('Hannah', 'Branding Model', 'Confirmed', 'August', '2026-08-01', 'Talent. Gifted 5 August 2026', 'Opulent Shirt - Off White (deadstock jahitan); Tote Bag - Brown (HQ stock)'),
  ('Mem', 'KOL', 'Confirmed', 'August', '2026-08-01', 'Gifted 18 August 2026', 'Falmouth Pinstripe Shirt - S (deadstock, HSP -2.5cm)'),
  ('Jean', 'KOL', 'Confirmed', 'August', '2026-08-01', 'Gifted 18 August 2026', 'Crop Top - Black (deadstock, sisa kain Kavash)'),
  ('Simion', 'KOL', 'Confirmed', 'August', '2026-08-01', 'Gifted 21 August 2026', 'Standard Issue Classic - Navy L (deadstock); Standard Issue Oversized - White L (deadstock)'),
  ('Komang', 'KOL', 'Confirmed', 'August', '2026-08-01', 'Gifted 21 August 2026', 'Origin Shorts - Black S (deadstock)');
