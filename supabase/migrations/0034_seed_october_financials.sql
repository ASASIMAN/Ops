-- October 2026 results, from the updated "ASASI Marketing Financial
-- Report" workbook (Full Data, Ecom Breakdown, Visitors tabs) - same
-- shape as every prior monthly seed (0024/0028 for September).
--
-- Full Data's and Ecom Breakdown's "Online Sales" both read 7,634,369
-- for October - matching, nothing to flag this month (unlike March).
--
-- Skipped, same standing reasons as every prior month: "KOL Opportunity
-- Cost" is the text pointer "MODEL & KOL list"; Google/TikTok ad spend
-- are "—"; LTV (Online)/Offline-WA LTV/MRR are flat or "N/A" and
-- already covered by the single assumptions rows from 0019.

insert into facts_daily (date, source, entity_type, entity_id, metric, value) values
  ('2026-10-01', 'financials_sheet', 'company', 'asasi', 'instore_sales_orders', 16),
  ('2026-10-01', 'financials_sheet', 'company', 'asasi', 'messages_wa_count', 40),
  ('2026-10-01', 'financials_sheet', 'company', 'asasi', 'wa_sales_orders', 0),
  ('2026-10-01', 'financials_sheet', 'company', 'asasi', 'online_sales_idr', 7634369),
  ('2026-10-01', 'financials_sheet', 'company', 'asasi', 'meta_ad_spend_idr', 10906405),
  ('2026-10-01', 'financials_sheet', 'company', 'asasi', 'marketing_cost_idr', 3500000),
  ('2026-10-01', 'financials_sheet', 'company', 'asasi', 'total_spend_idr', 14406405),
  ('2026-10-01', 'financials_sheet', 'company', 'asasi', 'total_budget_idr', 15000000),

  ('2026-10-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'orders_online', 4),
  ('2026-10-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'orders_offline', 16),
  ('2026-10-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'orders_wa', 0),
  ('2026-10-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'meta_roas_online', 0.7),
  ('2026-10-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'blended_roas_online', 1),
  ('2026-10-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'meta_cac_online_idr', 2726601),
  ('2026-10-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'meta_cac_offline_wa_idr', 545320),
  ('2026-10-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'blended_cac_online_idr', 2726601),
  ('2026-10-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'blended_cac_offline_wa_idr', 545320),
  ('2026-10-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'first_time_contribution_online_idr', -1581446),
  ('2026-10-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'meta_pn_idr', -3272036),
  ('2026-10-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'full_marketing_pn_idr', -6325784),
  ('2026-10-01', 'ecom_breakdown_sheet', 'company', 'asasi', 'aov_online_idr', 1908592),

  -- Visitors tab - every channel tracked this month, no "—".
  ('2026-10-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_member_count', 122),
  ('2026-10-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_instagram_count', 16),
  ('2026-10-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_tiktok_count', 0),
  ('2026-10-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_google_maps_count', 127),
  ('2026-10-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_walking_by_count', 173),
  ('2026-10-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_friend_referral_count', 9),
  ('2026-10-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_chatgpt_count', 8),
  ('2026-10-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_wa_business_count', 2),
  ('2026-10-01', 'visitor_attribution_sheet', 'company', 'asasi', 'walkin_total_count', 457)
on conflict (date, source, entity_type, entity_id, metric) do update set value = excluded.value;
