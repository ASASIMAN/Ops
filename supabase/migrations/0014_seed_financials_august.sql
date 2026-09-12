-- Adds August '26 to the real monthly P&L (0004 covered through July '26).
-- Same encoding rules as 0004: Google/TikTok spend are "—" in the source
-- (skipped, not stored as 0), and "KOL Opportunity Cost" is the text
-- "MODEL & KOL list" (a pointer to another sheet, not a number) in both
-- July and August - so it's skipped here too, same as July.
insert into facts_daily (date, source, entity_type, entity_id, metric, value) values
  ('2026-08-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 12),
  ('2026-08-01', 'financials_sheet', 'company', 'asasi', 'messages_wa_count', 33),
  ('2026-08-01', 'financials_sheet', 'company', 'asasi', 'wa_sales_orders', 3),
  ('2026-08-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 9600000),
  ('2026-08-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 10746865),
  ('2026-08-01', 'financials_sheet', 'company', 'asasi', 'marketing_cost_idr', 3500000),
  ('2026-08-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 14246865),
  ('2026-08-01', 'financials_sheet', 'company', 'asasi', 'total_budget_idr', 15000000)
on conflict (date, source, entity_type, entity_id, metric) do update set value = excluded.value;
