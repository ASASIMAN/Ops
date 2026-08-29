-- Meta Ads import target (build order step 2 - Paid Media module).
--
-- This is period-based data (each row summarizes a reporting date range
-- per ad, e.g. "30 Jul - 28 Aug"), not daily-grain like facts_daily -
-- forcing it into facts_daily would mean fabricating a daily split that
-- isn't in the source. A dedicated table fits what the export actually is.
--
-- ads is one row per distinct ad (identity), ad_performance_snapshots is
-- one row per (ad, reporting period) - re-importing an overlapping export
-- upserts on that pair rather than duplicating.

create table if not exists ads (
  id bigint generated always as identity primary key,
  ad_name text not null unique,
  ad_set_name text not null,
  temperature text not null default 'unknown'
    check (temperature in ('cold', 'warm', 'unknown')),
  variant_label text,
  -- Manually assigned later (Store / GRWM / Gifting / Carousel / Campaign /
  -- Lifestyle per the brief) - not derivable from the export itself.
  style_tag text,
  created_at timestamptz not null default now()
);

alter table ads enable row level security;

create table if not exists ad_performance_snapshots (
  id bigint generated always as identity primary key,
  ad_id bigint not null references ads (id) on delete cascade,
  reporting_start date not null,
  reporting_end date not null,
  ad_delivery text,
  results numeric,
  result_indicator text,
  cost_per_results numeric,
  ad_set_budget_raw text,
  ad_set_budget_type text,
  amount_spent_idr numeric not null default 0,
  impressions numeric not null default 0,
  reach numeric not null default 0,
  total_messaging_contacts numeric,
  new_messaging_contacts numeric,
  purchases numeric,
  ends text,
  attribution_setting text,
  bid numeric,
  bid_type text,
  last_significant_edit timestamptz,
  quality_ranking text,
  engagement_ranking text,
  conversion_ranking text,
  cost_per_purchase_idr numeric,
  results_initial numeric,
  results_initial_indicator text,
  imported_at timestamptz not null default now(),
  unique (ad_id, reporting_start, reporting_end)
);

create index if not exists ad_performance_ad_id_idx on ad_performance_snapshots (ad_id);
create index if not exists ad_performance_period_idx
  on ad_performance_snapshots (reporting_start, reporting_end);

alter table ad_performance_snapshots enable row level security;

-- Tracks each CSV upload, same purpose as sync_runs for the Odoo sync.
create table if not exists ad_imports (
  id bigint generated always as identity primary key,
  filename text,
  reporting_start date,
  reporting_end date,
  row_count integer not null default 0,
  skipped_row_count integer not null default 0,
  unmapped_columns jsonb,
  missing_expected_columns jsonb,
  imported_at timestamptz not null default now()
);

alter table ad_imports enable row level security;
