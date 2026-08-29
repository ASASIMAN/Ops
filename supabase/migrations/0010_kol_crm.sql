-- Build order step 7: full KOL CRM, extending the booking-log-only kols
-- table from step 1 with the rest of the record fields the brief wants.
--
-- opportunity_cost_idr is a NEW, separate numeric column - it does not
-- parse the existing opportunity_cost_raw text ("500k Voucher", "1.5jt").
-- Per an explicit decision earlier in this build, opportunity_cost_raw
-- stays as free/editable text rather than being auto-converted. This
-- column exists so new or updated records can carry a clean number for
-- the monthly budget tracker and the Financials roll-up, without
-- silently guessing a conversion for the records that already have only
-- text.
alter table kols add column if not exists gender text;
alter table kols add column if not exists location text;
alter table kols add column if not exists follower_count integer;
alter table kols add column if not exists engagement_rate numeric;
alter table kols add column if not exists priority text;
alter table kols add column if not exists pic text;
alter table kols add column if not exists approved_by text;
alter table kols add column if not exists deal_terms text;
alter table kols add column if not exists kitas_requirement boolean;
alter table kols add column if not exists deliverables text;
alter table kols add column if not exists booking_date date;
alter table kols add column if not exists opportunity_cost_idr numeric;
alter table kols add column if not exists performance_notes text;

-- Tier definitions (KOL / Influencer / Ambassador / Model - follower
-- threshold, deliverables, compensation, KITAS requirement per the
-- brief's description of the KOL sheet's second tab). Not seeded: that
-- tab hasn't been read (Drive access still pending) - editable in-app
-- once real tier rules are entered.
create table if not exists kol_tiers (
  id bigint generated always as identity primary key,
  tier_name text not null unique,
  follower_threshold_min integer,
  deliverables text,
  compensation text,
  kitas_requirement boolean,
  notes text,
  created_at timestamptz not null default now()
);

alter table kol_tiers enable row level security;

-- Explicitly stated in the brief ("Monthly KOL budget tracker against
-- the 3M IDR/mo line") - distinct from monthly_agency_cost_idr (3.5M),
-- which is a separate line per the brief's own numbers.
insert into assumptions (key, value, label) values
  ('monthly_kol_budget_idr', 3000000, 'Monthly KOL budget (IDR)')
on conflict (key) do update set value = excluded.value, label = excluded.label, updated_at = now();
