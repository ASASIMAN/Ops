-- Hand-compiled monthly Meta ads history ("Ads Data" tab), Dec '24
-- through Aug '26 - a different grain from ads/ad_performance_snapshots
-- (that table is per real Meta ad_id, keyed to a specific Ads Manager
-- reporting_start/reporting_end; this is a monthly summary keyed by a
-- human campaign label like "Warm Campaign" reused across different
-- months for different real ads). Kept as its own table rather than
-- force-fit into ad_performance_snapshots, since "Warm Campaign" in
-- April isn't the same Meta ad as "Warm Campaign" in May.
--
-- "Dec"/"Jan"/"Feb"/"Mar" have no year in the source - inferred as
-- 2024-12/2025-01/2025-02/2025-03 since that lines up with the
-- company's documented start (financials also begin Dec '24). There's
-- a real gap between March '25 and April '26 in this tab - no ad
-- history rows for that year, not something to fill in.
--
-- Skipped rather than invented: the "% Change vs Previous Month" cell
-- that was a literal "#ERROR!" (a broken spreadsheet formula, not a
-- real percentage); the two highlight rows whose spend was written as
-- an abbreviated "5.64M"/"2.78M" rather than an exact figure - stored
-- as null rather than guessing what that rounds to in full.

create table if not exists ad_monthly_history (
  id bigint generated always as identity primary key,
  month_label text not null,
  scheduled_month date,
  ad_label text not null,
  spend_idr numeric,
  purchases numeric,
  impressions numeric,
  reach numeric,
  link_clicks numeric,
  cpm_idr numeric,
  cost_per_reach_idr numeric,
  cost_per_purchase_idr numeric,
  style_tag text,
  pct_change_vs_previous_month text,
  created_at timestamptz not null default now()
);

alter table ad_monthly_history enable row level security;

create table if not exists ad_monthly_highlights (
  id bigint generated always as identity primary key,
  rank int not null,
  ad_label text not null,
  reason text,
  month_label text,
  spend_idr numeric,
  purchases numeric,
  cpm_idr numeric,
  best_ad_label text,
  instore_purchase_count numeric,
  created_at timestamptz not null default now()
);

alter table ad_monthly_highlights enable row level security;

insert into ad_monthly_history (month_label, scheduled_month, ad_label, spend_idr, purchases, impressions, reach, link_clicks, cpm_idr, cost_per_reach_idr, cost_per_purchase_idr, style_tag, pct_change_vs_previous_month) values
  ('Dec', '2024-12-01', 'Dec Store', 3105610, 1, 154405, 49576, 758, 20110, 62645, 3105610, 'Store', null),
  ('Dec', '2024-12-01', 'Dec GRWM', 1805271, 0, 43355, 16809, 251, 41640, 107411, null, 'GRWM', null),
  ('Dec', '2024-12-01', 'Gifting Ad', 734705, 2, 57686, 24234, 292, 12736, 30317, 367352, 'Gifting', null),
  ('Jan', '2025-01-01', 'New Store', 1449767, 2, 87485, 48780, 438, 16573, 29719, 724883, 'Store', null),
  ('Jan', '2025-01-01', 'Store Build', 727580, 0, 26958, 15654, 178, 26988, 46493, null, 'Store', '−39%'),
  ('Jan', '2025-01-01', 'Jan Store', 601124, 0, 23882, 10888, 124, 25180, 55212, null, 'Store', '−53%'),
  ('Feb', '2025-02-01', 'Feb Campaign (Conversion)', 1512300, 0, 82145, 34210, null, 18410, 44200, null, 'Mixed', '−100% purchases'),
  ('Feb', '2025-02-01', 'Feb Campaign (Traffic)', 1265215, 0, 68626, 30808, null, 18435, 41050, null, 'Traffic', null),
  ('Mar', '2025-03-01', 'March Campaign (Conversion)', 1102880, 0, 59210, 27440, null, 18620, 40180, null, 'Mixed', '−27% spend'),
  ('Mar', '2025-03-01', 'March Campaign (Traffic)', 989536, 0, 53350, 25800, null, 18560, 38330, null, 'Traffic', null),
  ('April ''26', '2026-04-01', 'Warm Campaign', 2737900, 0, 88590, 36662, 243, 30905, 75, null, 'New', null),
  ('April ''26', '2026-04-01', 'Cold Campaign', 6965674, 1, 299848, 108268, 684, 23231, 64, 6965674, 'New', null),
  ('May ''26', '2026-05-01', 'Warm Campaign', 2496476, 0, 89508, 40394, 216, 27891, 62, null, 'Mixed/old', '-9%'),
  ('May ''26', '2026-05-01', 'Cold Campaign', 6455526, 3, 270355, 100391, 535, 23878, 64, 2151842, 'Mixed/old', '-7%'),
  ('June ''26', '2026-06-01', 'Warm Campaign', 1734144, 1, 105552, 38395, 541, 16429, 45, 1734144, 'Mixed/old', '-31%'),
  ('June ''26', '2026-06-01', 'Cold Campaign', 4379503, 0, 236535, 78178, 470, 18515, 56, null, 'Mixed/old', '-32%'),
  ('July ''26', '2026-07-01', 'Warm Campaign', 3041290, 0, 186122, 56249, null, 16340, 54, null, 'Mixed/old', '+75%'),
  ('July ''26', '2026-07-01', 'Cold Campaign', 7601743, 3, 518431, 80940, null, 14663, 94, 2533914, 'Mixed/old', '+74%'),
  ('Aug ''26', '2026-08-01', 'Warm Campaign', 3075474, 6, 108950, 41994, null, 28228, 73, 512579, 'Mixed/old', '+1%'),
  ('Aug ''26', '2026-08-01', 'Cold Campaign', 7671391, 2, 297487, 103572, null, 25787, 74, 3835696, 'Mixed/old', '+1%');

insert into ad_monthly_highlights (rank, ad_label, reason, month_label, spend_idr, purchases, cpm_idr, best_ad_label, instore_purchase_count) values
  (1, 'Laskar – March Pic Carousel warm', '• Lowest CPA of the entire period (181,459) • Warm/retargeting • Spend fell -59% and still converted', 'June ''26', 181459, 1, 30616, 'March Pic Carousel warm', 20),
  (2, 'Laskar – June – Warm', '• NEW. 2nd-lowest CPA (277,658), best of August • Warm audience, mid-size budget • Most efficient converter in August', 'Aug ''26', 832973, 3, 35246, 'June Warm', 12),
  (3, 'Laskar – March 02 (shop)', '• 3rd-lowest CPA (314,114) • Cold audience, low spend, still converted', 'May ''26', 314114, 1, 28676, 'March 02', 27),
  (4, 'Laskar – June 02 – Warm', '• NEW. CPA 490,917 on 2 purchases • Warm, consistent converter across two months', 'Aug ''26', 981834, 2, 27805, 'June 02 Warm', 12),
  (5, 'Laskar – June 02', '• CPA 654,295 • Delivered 2 of July''s 3 purchases on just 12% of spend • Cold audience, small budget', 'July ''26', 1308590, 2, 22906, 'June 02', 24),
  (6, 'New Store (canggu)', '• Scalable • Strong CPA • Only Jan converter', 'Jan ''26', null, 4, 16573, 'New Store', 13),
  (7, 'Gifting Ad', '• Best CPA by far • Lowest CPM • Proven converter', 'Dec ''25', null, 3, 20110, 'Gifting', 13),
  (8, 'Dec Store', '• Volume driver • High clicks', 'Dec ''25', null, null, null, null, null);
