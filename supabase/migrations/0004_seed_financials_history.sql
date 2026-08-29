-- Seeds the real monthly P&L history (Dec '24 - Jul '26) from
-- ASASI_Marketing_Financial_Report_Full_Data.csv into facts_daily.
-- date = first of month. entity_type/entity_id are 'company'/'asasi'
-- since this is business-wide, not per-store or per-ad.
--
-- "-" (em dash) and blank cells in the source are skipped entirely, not
-- stored as 0 - missing is missing.
--
-- "WA Messages" mixed "IG143" and "WA 56" style values in the source, so
-- it's split into two metrics (messages_ig_count / messages_wa_count)
-- rather than merged into one, since the channel prefix looks meaningful.
--
-- Where the source's "KOL Opportunity Cost" cell just says "MODEL & KOL
-- list" (Mar-Jul '26) instead of a number, nothing is inserted for that
-- metric that month - it's meant to be computed from the kols table.

insert into facts_daily (date, source, entity_type, entity_id, metric, value) values
  ('2024-12-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 3),
  ('2024-12-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 4131253),
  ('2024-12-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 9412571),
  ('2024-12-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 9412571),

  ('2025-01-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 9),
  ('2025-01-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 6368144),
  ('2025-01-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 9469750),
  ('2025-01-01', 'financials_sheet', 'company', 'asasi', 'google_ad_spend_idr', 150000),
  ('2025-01-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 9619750),

  ('2025-02-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 9),
  ('2025-02-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 4446510),
  ('2025-02-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 14212474),
  ('2025-02-01', 'financials_sheet', 'company', 'asasi', 'google_ad_spend_idr', 5050000),
  ('2025-02-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 19262474),

  ('2025-03-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 8),
  ('2025-03-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 4596131),
  ('2025-03-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 6163118),
  ('2025-03-01', 'financials_sheet', 'company', 'asasi', 'google_ad_spend_idr', 3000000),
  ('2025-03-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 9163118),

  ('2025-04-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 11),
  ('2025-04-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 2600000),
  ('2025-04-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 6018000),
  ('2025-04-01', 'financials_sheet', 'company', 'asasi', 'google_ad_spend_idr', 2350000),
  ('2025-04-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 8368000),

  ('2025-05-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 17),
  ('2025-05-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 14301804),
  ('2025-05-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 3314792),
  ('2025-05-01', 'financials_sheet', 'company', 'asasi', 'tiktok_spend_idr', 1000000),
  ('2025-05-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 7629584),

  ('2025-06-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 9),
  ('2025-06-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 16579989),
  ('2025-06-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 1071969),
  ('2025-06-01', 'financials_sheet', 'company', 'asasi', 'google_ad_spend_idr', 3314792),
  ('2025-06-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 4386761),

  ('2025-07-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 10),
  ('2025-07-01', 'financials_sheet', 'company', 'asasi', 'messages_ig_count', 143),
  ('2025-07-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 8498436),
  ('2025-07-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 4402056),
  ('2025-07-01', 'financials_sheet', 'company', 'asasi', 'google_ad_spend_idr', 2925027),
  ('2025-07-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 7327083),

  ('2025-08-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 8),
  ('2025-08-01', 'financials_sheet', 'company', 'asasi', 'messages_ig_count', 202),
  ('2025-08-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 2520000),
  ('2025-08-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 8178430),
  ('2025-08-01', 'financials_sheet', 'company', 'asasi', 'google_ad_spend_idr', 2255492),
  ('2025-08-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 10433922),

  ('2025-09-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 9),
  ('2025-09-01', 'financials_sheet', 'company', 'asasi', 'messages_ig_count', 166),
  ('2025-09-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 5861392),
  ('2025-09-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 9188280),
  ('2025-09-01', 'financials_sheet', 'company', 'asasi', 'google_ad_spend_idr', 682548),
  ('2025-09-01', 'financials_sheet', 'company', 'asasi', 'tiktok_spend_idr', 200000),
  ('2025-09-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 10070828),

  ('2025-10-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 11),
  ('2025-10-01', 'financials_sheet', 'company', 'asasi', 'messages_ig_count', 106),
  ('2025-10-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 14303668),
  ('2025-10-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 8696513),
  ('2025-10-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 8696513),

  ('2025-11-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 7),
  ('2025-11-01', 'financials_sheet', 'company', 'asasi', 'messages_ig_count', 101),
  ('2025-11-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 2200708),
  ('2025-11-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 4876823),
  ('2025-11-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 4876823),

  ('2025-12-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 13),
  ('2025-12-01', 'financials_sheet', 'company', 'asasi', 'messages_wa_count', 56),
  ('2025-12-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 15964065),
  ('2025-12-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 8426552),
  ('2025-12-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 8426552),

  ('2026-01-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 13),
  ('2026-01-01', 'financials_sheet', 'company', 'asasi', 'messages_wa_count', 3),
  ('2026-01-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 3028513),
  ('2026-01-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 3029353),
  ('2026-01-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 3029353),

  ('2026-02-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 14),
  ('2026-02-01', 'financials_sheet', 'company', 'asasi', 'messages_wa_count', 12),
  ('2026-02-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 2545503),
  ('2026-02-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 2777515),
  ('2026-02-01', 'financials_sheet', 'company', 'asasi', 'marketing_cost_idr', 3500000),
  ('2026-02-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 6277515),

  ('2026-03-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 32),
  ('2026-03-01', 'financials_sheet', 'company', 'asasi', 'messages_wa_count', 16),
  ('2026-03-01', 'financials_sheet', 'company', 'asasi', 'wa_sales_orders', 3),
  ('2026-03-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 9720011),
  ('2026-03-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 4592416),
  ('2026-03-01', 'financials_sheet', 'company', 'asasi', 'marketing_cost_idr', 3500000),
  ('2026-03-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 13592416),
  ('2026-03-01', 'financials_sheet', 'company', 'asasi', 'total_budget_idr', 15000000),

  ('2026-04-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 20),
  ('2026-04-01', 'financials_sheet', 'company', 'asasi', 'messages_wa_count', 40),
  ('2026-04-01', 'financials_sheet', 'company', 'asasi', 'wa_sales_orders', 4),
  ('2026-04-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 27887887),
  ('2026-04-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 9703574),
  ('2026-04-01', 'financials_sheet', 'company', 'asasi', 'marketing_cost_idr', 3500000),
  ('2026-04-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 13203574),
  ('2026-04-01', 'financials_sheet', 'company', 'asasi', 'total_budget_idr', 15000000),

  ('2026-05-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 27),
  ('2026-05-01', 'financials_sheet', 'company', 'asasi', 'messages_wa_count', 64),
  ('2026-05-01', 'financials_sheet', 'company', 'asasi', 'wa_sales_orders', 6),
  ('2026-05-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 19404062),
  ('2026-05-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 8952002),
  ('2026-05-01', 'financials_sheet', 'company', 'asasi', 'marketing_cost_idr', 3500000),
  ('2026-05-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 12452002),
  ('2026-05-01', 'financials_sheet', 'company', 'asasi', 'total_budget_idr', 15000000),

  ('2026-06-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 20),
  ('2026-06-01', 'financials_sheet', 'company', 'asasi', 'messages_wa_count', 25),
  ('2026-06-01', 'financials_sheet', 'company', 'asasi', 'wa_sales_orders', 0),
  ('2026-06-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 23382840),
  ('2026-06-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 6113647),
  ('2026-06-01', 'financials_sheet', 'company', 'asasi', 'marketing_cost_idr', 3500000),
  ('2026-06-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 9133647),
  ('2026-06-01', 'financials_sheet', 'company', 'asasi', 'total_budget_idr', 15000000),

  ('2026-07-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 24),
  ('2026-07-01', 'financials_sheet', 'company', 'asasi', 'messages_wa_count', 31),
  ('2026-07-01', 'financials_sheet', 'company', 'asasi', 'wa_sales_orders', 0),
  ('2026-07-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 13808000),
  ('2026-07-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 10643033),
  ('2026-07-01', 'financials_sheet', 'company', 'asasi', 'marketing_cost_idr', 3500000),
  ('2026-07-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 14143033),
  ('2026-07-01', 'financials_sheet', 'company', 'asasi', 'total_budget_idr', 15000000)
on conflict (date, source, entity_type, entity_id, metric) do update set value = excluded.value;
