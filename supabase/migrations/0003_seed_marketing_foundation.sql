-- Seeds only what's explicitly given in the brief - no fabricated history.
-- Monthly P&L / unit economics / walk-in attribution history is NOT seeded
-- here: that requires reading the actual Financials Google Sheet, which is
-- blocked pending Google Drive re-authorization. Run this after
-- 0002_hub_and_marketing_foundation.sql.

-- The 4 existing stores should already exist as rows synced from Odoo
-- (pos.config). This attaches the real address + a stable slug via a
-- partial name match, since the exact Odoo pos.config naming is unknown
-- from here - check the result and adjust the ILIKE patterns if a store
-- doesn't match (`select id, name from stores;` to see what's there).
update stores set
  slug = 'canggu',
  address = 'Jl. Pantai Batu Bolong No.21, Canggu, Kec. Kuta Utara, Kab. Badung, Bali 80361'
where name ilike '%canggu%' and slug is null;

update stores set
  slug = 'pererenan',
  address = 'Jl. Pantai Pererenan Br. Batu No.61, Pererenan, Kec. Mengwi, Kab. Badung, Bali 80351'
where name ilike '%pererenan%' and slug is null;

update stores set
  slug = 'ubud',
  address = 'Jl. Nyuh Bojog No.28, Mas, Kec. Ubud, Kab. Gianyar, Bali 80571'
where name ilike '%ubud%' and slug is null;

update stores set
  slug = 'nusa-dua',
  address = 'Bali Collection, Jl. Kw. Nusa Dua Resort, Benoa, Kec. Kuta Sel., Kab. Badung, Bali 80361'
where name ilike '%nusa%dua%' and slug is null;

-- NSA doesn't exist in Odoo yet (pre-opening) - safe to insert directly,
-- no risk of duplicating an Odoo-synced row.
insert into stores (name, slug, is_preopening, odoo_pos_config_id)
values ('NSA', 'nsa', true, null)
on conflict (slug) do nothing;

insert into assumptions (key, value, label) values
  ('ltv_multiplier_offline_wa', 1.4433, 'Offline/WA LTV multiplier applied to AOV'),
  ('monthly_marketing_budget_idr', 15000000, 'Total monthly marketing budget (IDR)'),
  ('monthly_agency_cost_idr', 3500000, 'Standing agency/marketing cost per month (IDR)')
on conflict (key) do update set value = excluded.value, label = excluded.label, updated_at = now();

insert into app_settings (key, value) values
  ('walkin_attribution_sources', '["Member", "Instagram", "TikTok", "Google Maps", "Walking by", "Friend Referral", "ChatGPT", "WA Business"]'),
  ('content_pillars', '{"Story": ["Promotions", "Operational Hours"], "Feed": ["Store Walkthroughs", "Get Ready with Me", "Production", "Promotions", "Styling Guides", "Moodboard", "Off-Cuts", "User Generated Content", "Drop Details"]}'),
  ('kol_statuses', '["Confirmed", "On process", "Not confirmed", "Missed", "Booked", "Contacted", "Not asked", "Not a fit", "Denied", "Done", "Available", "Onboarded", "Needs a schedule"]'),
  ('campaign_statuses', '["Brief", "In production", "Scheduled", "Live", "Ended", "Reviewed"]')
on conflict (key) do update set value = excluded.value, updated_at = now();
