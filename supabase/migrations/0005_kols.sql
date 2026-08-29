-- KOL/talent booking log, ahead of the full KOL CRM module (build order
-- step 7) since real data is available now. This is the booking log table
-- only - tier definitions and prospect lists (the sheet's other tabs)
-- aren't seeded, since Google Drive access is still pending
-- re-authorization and only the booking log was provided as a file.
--
-- opportunity_cost_raw is kept verbatim (e.g. "500k Voucher", "1.5jt") -
-- NOT parsed into a number. Converting Indonesian shorthand (jt=million,
-- k=thousand) and deciding how voucher/in-kind value compares to cash
-- spend is a real metric-definition choice, not made here.
--
-- month_label is the raw source value (e.g. "Feb"); scheduled_month
-- assumes 2026 for every row based on the source filename
-- ("...Schedule_2026.csv") - flag if any row is actually a different year.

create table if not exists kols (
  id bigint generated always as identity primary key,
  name text,
  social_handle text,
  category text not null,
  status text not null,
  month_label text not null,
  scheduled_month date,
  notes text,
  product_given text,
  opportunity_cost_raw text,
  content_link text,
  created_at timestamptz not null default now()
);

alter table kols enable row level security;

insert into kols (name, social_handle, category, status, month_label, scheduled_month, notes, product_given, opportunity_cost_raw) values
  (null, null, 'ASASI Member Curation', 'Not confirmed', 'Feb', '2026-02-01', 'Total Month budget 3jt', '500k Voucher', '500k Voucher'),
  ('Scotty Cal', 'https://www.instagram.com/scottycal_/', 'KOL', 'On process', 'Feb', '2026-02-01', 'Total Month budget 3jt', '500k Voucher', '500k Voucher'),
  ('Geco Music', 'https://www.instagram.com/geco_music/', 'KOL', 'On process', 'Feb', '2026-02-01', 'Total Month budget 3jt', '500k Voucher', '500k Voucher'),
  ('Cam', 'https://www.instagram.com/cameron.denys/', 'KOL', 'Missed', 'Feb', '2026-02-01', 'Total Month budget 3jt + tikokt SEO/IG influencer (ideally female)', '1.5jt Voucher', '1.5jt'),
  ('Krayitor', 'https://www.instagram.com/kraytor_andrey/', 'KOL', 'Missed', 'Feb', '2026-02-01', null, null, '$? Model booking cost'),
  ('Ben Model', null, 'Branding Model', 'Confirmed', 'Feb', '2026-02-01', 'Model Budget Set by Kelly + Chris', '1.5jt Voucher', '?'),
  ('eric', 'https://www.instagram.com/ericdavis_3/', 'KOL', 'Missed', 'Feb', '2026-02-01', 'Total Month budget 3jt', '500k Voucher', '500k Voucher'),

  ('Dika (SOMA)', 'https://www.instagram.com/dikasochirin/', 'ASASI Member Curation', 'Confirmed', 'March', '2026-03-01', 'SOMA', 'Vayu size S and linen navy S', '1.5jt Voucher'),
  ('Antoine', 'https://www.instagram.com/antoinebesry/', 'KOL', 'Confirmed', 'March', '2026-03-01', 'Videographer', 'dead stock polo and linen pants olive LL', null),
  ('Hami nua', 'https://www.instagram.com/hami.nua/', 'Branding Model', 'Confirmed', 'March', '2026-03-01', 'Model', 'Affine brown S', null),
  ('shalom', 'https://www.instagram.com/daniellexshalom/', 'KOL', 'Confirmed', 'March', '2026-03-01', 'female content', 'Linen pants navy S and affine white S', null),

  ('Margaux', 'https://www.instagram.com/margauxgastine/', 'Influencer', 'Confirmed', 'April', '2026-04-01', 'female content', 'Vayu Black S', null),
  ('Holly Jamerson', null, 'KOL', 'On process', 'April', '2026-04-01', 'Female content, tom to ask sizing.', 'Dead stock +500k', '500k'),
  ('Zea', 'https://www.instagram.com/zea_ml/', 'KOL', 'Confirmed', 'April', '2026-04-01', 'female content', 'vayu', null),
  ('vicent', 'https://www.instagram.com/vincentbdss/', 'New Ambassador', 'Confirmed', 'April', '2026-04-01', 'model', 'linen pants white, loafers, black opulent', null),
  ('Antoine', 'https://www.instagram.com/antoinebesry/?hl=id', 'KOL', 'Confirmed', 'April', '2026-04-01', 'Videographer', 'origin long sleeve ocra', null),
  ('deby', 'https://www.instagram.com/iamdebyyyy/', 'KOL', 'Confirmed', 'April', '2026-04-01', 'female content', 'swinshorts somerset', null),
  ('Keba Keps', 'https://www.instagram.com/keba_keps/', 'Branding Model', 'Confirmed', 'April', '2026-04-01', 'Male model', 'on kelly', null),

  (null, 'Tiktok SEO', 'Influencer', 'Missed', 'July', '2026-07-01', null, null, null),
  ('Older Dude', 'friends IG stories and tags', 'KOL', 'Missed', 'July', '2026-07-01', null, null, null),
  ('Wild Card', 'friends IG stories and tags', 'KOL', 'Missed', 'July', '2026-07-01', null, null, null),
  (null, 'Photo shoot Esya', 'Branding Model', 'Missed', 'July', '2026-07-01', null, null, null),
  (null, 'Dika?', 'Ambassador Collab', 'Confirmed', 'July', '2026-07-01',
   'Deadstock:
1. Vayu T-Shirt - Off White (M)
2. Ribbed Vest - Off White (M)
3. Origin Shorts - Hearthstone (L)', null, null),
  (null, 'Male fort shoot with sekar maybe', 'Branding Model', 'Missed', 'July', '2026-07-01', null, null, null),

  (null, 'Vespa Owner', 'Branding Model', 'Confirmed', 'August', '2026-08-01', 'Ask Asha for what items (store credit)', null, null),
  ('Julian + GF', 'Vespa model', 'Branding Model', 'Confirmed', 'August', '2026-08-01',
   'New:
1. Underwear [off white] - M x1
2. Underwear [black] - M x1
3. Ribbed vest [off white] - M x1
4. Totebag [brown] - x2

Deadstock:
1. Opulent shirt [off white] - S x1', null, 'Esya to calculate'),
  (null, 'Tiktok SEO', 'Influencer', 'Not confirmed', 'August', '2026-08-01', null, null, null),
  (null, 'friends IG stories and tags', 'KOL', 'Not confirmed', 'August', '2026-08-01', null, null, null),
  (null, 'friends IG stories and tags', 'KOL', 'Not confirmed', 'August', '2026-08-01', null, null, null),
  (null, 'Photo shoot Esya', 'Branding Model', 'Not confirmed', 'August', '2026-08-01', null, null, null),
  (null, 'Dika?', 'Ambassador Collab', 'Not confirmed', 'August', '2026-08-01', null, null, null);
