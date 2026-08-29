-- One-time cleanup for duplicate pos.config rows discovered when running
-- 0003: Odoo has both an old-style config ("ASASI Pererenan") and a
-- newer one ("ASASI. PERERENAN") for the same physical store, plus a
-- generic "Clothes Shop" demo config that isn't a real store. Identified
-- the real, live store per location by which one actually has synced
-- orders (checked via `select s.*, count(o.id) from stores s left join
-- orders o on o.store_id = s.id group by s.id`).
--
-- Real stores confirmed by order_count > 0 on this instance:
--   id 9 = ASASI. CANGGU     (44 orders)
--   id 6 = ASASI. NUSA DUA   (21 orders)
--   id 7 = ASASI. PERERENAN  (47 orders)
--   id 8 = ASASI. UBUD       (14 orders)
-- These ids are specific to this database, not portable - this is a
-- one-time data fix, not a reusable pattern.

update stores set slug = 'canggu', address = 'Jl. Pantai Batu Bolong No.21, Canggu, Kec. Kuta Utara, Kab. Badung, Bali 80361' where id = 9;
update stores set slug = 'nusa-dua', address = 'Bali Collection, Jl. Kw. Nusa Dua Resort, Benoa, Kec. Kuta Sel., Kab. Badung, Bali 80361' where id = 6;
update stores set slug = 'pererenan', address = 'Jl. Pantai Pererenan Br. Batu No.61, Pererenan, Kec. Mengwi, Kab. Badung, Bali 80351' where id = 7;
update stores set slug = 'ubud', address = 'Jl. Nyuh Bojog No.28, Mas, Kec. Ubud, Kab. Gianyar, Bali 80571' where id = 8;

-- Deactivate every other store row that has no slug yet (the stale
-- duplicate configs and the demo "Clothes Shop") so they drop out of
-- filters/dropdowns without deleting anything.
update stores
set active = false
where id not in (6, 7, 8, 9)
  and slug is null;

-- The rest of 0003 that never ran, since canggu's UPDATE (the first
-- statement in that script) errored before reaching these.
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
