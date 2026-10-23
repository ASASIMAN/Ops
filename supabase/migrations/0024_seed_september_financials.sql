-- September 2026 results, from the "Financial Report" Google Sheet
-- (uploaded directly as .xlsx this round - same workbook, same tabs as
-- every prior monthly seed: Full Data, Ecom Breakdown, Visitors).
--
-- Full Data's "Online Sales (IDR)" for Sep ('23,035,944') matches Ecom
-- Breakdown's "Online Sales" for Sep exactly - unlike March '26 (the
-- discrepancy flagged in 0019 and left for the user to check), there's
-- nothing to flag this month.
--
-- Skipped, same reasons as every prior month: "KOL Opportunity Cost" is
-- the text "MODEL & KOL list" (a pointer, not a number); Google/TikTok
-- ad spend are "—"; LTV (Online), Offline/WA LTV and every
-- Offline/WA-suffixed ecom metric are flat/"N/A" and already covered by
-- the single assumptions rows from 0019, not repeated here; MRR is
-- "N/A" for Sep same as every month since April '26.

insert into facts_daily (date, source, entity_type, entity_id, metric, value) values
  ('2026-09-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 8),
  ('2026-09-01', 'financials_sheet', 'company', 'asasi', 'messages_wa_count', 43),
  ('2026-09-01', 'financials_sheet', 'company', 'asasi', 'wa_sales_orders', 0),
  ('2026-09-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 23035944),
  ('2026-09-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 10460320),
  ('2026-09-01', 'financials_sheet', 'company', 'asasi', 'marketing_cost_idr', 3500000),
  ('2026-09-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 13960320),
  ('2026-09-01', 'financials_sheet', 'company', 'asasi', 'total_budget_idr', 15000000),

  ('2026-09-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'orders_online', 15),
  ('2026-09-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'orders_offline', 8),
  ('2026-09-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'orders_wa', 0),
  ('2026-09-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'meta_roas_online', 2.2),
  ('2026-09-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'blended_roas_online', 2),
  ('2026-09-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'meta_cac_online_idr', 804640),
  ('2026-09-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'meta_cac_offline_wa_idr', 454796),
  ('2026-09-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'blended_cac_online_idr', 804640),
  ('2026-09-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'blended_cac_offline_wa_idr', 454796),
  ('2026-09-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'first_time_contribution_online_idr', 116798),
  ('2026-09-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'meta_pn_idr', 12575624),
  ('2026-09-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'full_marketing_pn_idr', 3361246),
  ('2026-09-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'aov_online_idr', 1535730),

  -- Visitors tab - every channel was tracked this month (no "—"), unlike
  -- some earlier months where ChatGPT/WA Business/TikTok were blank.
  ('2026-09-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_member_count', 93),
  ('2026-09-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_instagram_count', 8),
  ('2026-09-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_tiktok_count', 0),
  ('2026-09-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_google_maps_count', 119),
  ('2026-09-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_walking_by_count', 181),
  ('2026-09-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_friend_referral_count', 8),
  ('2026-09-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_chatgpt_count', 12),
  ('2026-09-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_wa_business_count', 0),
  ('2026-09-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_total_count', 421)
on conflict (date, source, entity_type, entity_id, metric) do update set value = excluded.value;
