-- Schema for the PO Planning Chart (/forecast's main view) and the PO
-- planner panel beside it.
--
-- Design notes:
-- * `forecast_uplift_factors` and `forecast_events` are manual,
--   business-entered inputs - nothing here infers a campaign or a
--   seasonal uplift from the sales data itself. `product_template_id`
--   is nullable (applies to every style) because an uplift like a
--   company-wide promotion isn't product-specific, while others are.
--   Date ranges, not a recurring "month of year": Lebaran moves ~11
--   days earlier every Gregorian year (lunar calendar), so a fixed
--   calendar month would silently drift wrong - each occurrence is
--   entered with its own real date range instead of guessed from a
--   rule.
-- * `stock_level_history` is new, append-only, daily stock history -
--   `stock_levels` (migration 0023) is overwritten in place each sync
--   and was never meant to answer "was this in stock on day X", so it
--   can't retroactively tell you about a stockout that happened before
--   this table existed. History starts accumulating from whenever the
--   stock sync first writes to it (see src/lib/odoo/sync.ts) - there is
--   no backfill, and the UI says so rather than showing a blank history
--   as "no stockouts".
-- * Lead-time-system products (migration 0027, `lead_time_products`,
--   style-level) and this app's Odoo-synced products (`products`,
--   variant-level, template-level via `odoo_template_id`) are still two
--   separate identities. `lead_time_name_mappings.odoo_template_id`
--   (already in 0027) is where a human links a chart style to its PO
--   sheet entry - until that link exists for a style, the planner can't
--   compute open-PO-qty or lead time for it, and says so rather than
--   showing 0.

create table if not exists forecast_uplift_factors (
  id bigint generated always as identity primary key,
  product_template_id integer, -- null = applies to every style
  label text not null, -- e.g. "Lebaran 2027"
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  uplift_pct numeric(6, 2) not null, -- e.g. 30 = +30% demand in this window
  note text,
  created_at timestamptz not null default now()
);

create index if not exists forecast_uplift_factors_template_idx on forecast_uplift_factors (product_template_id);

create table if not exists forecast_events (
  id bigint generated always as identity primary key,
  product_template_id integer, -- null = applies to every style
  event_date date not null,
  label text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists forecast_events_template_idx on forecast_events (product_template_id);

create table if not exists stock_level_history (
  id bigint generated always as identity primary key,
  product_id bigint not null references products (id),
  location_id bigint not null references stock_locations (id),
  qty_on_hand numeric(12, 3) not null,
  snapshot_date date not null,
  unique (product_id, location_id, snapshot_date)
);

create index if not exists stock_level_history_product_idx on stock_level_history (product_id, snapshot_date);

comment on table stock_level_history is
  'Append-only daily stock snapshot, written by runStockSync alongside the in-place stock_levels table (migration 0023). No historical backfill - only has data from whenever a stock sync first ran after this table was created. Used to detect stockout days (qty_on_hand = 0) for the PO planning chart.';

alter table forecast_uplift_factors enable row level security;
alter table forecast_events enable row level security;
alter table stock_level_history enable row level security;
-- Intentionally no policies: only the service role (server-side) can read/write, same as every other table here.
