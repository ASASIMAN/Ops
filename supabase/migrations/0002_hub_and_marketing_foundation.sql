-- Foundation for the ASASI ecosystem hub (Operations + Marketing) and the
-- Marketing Command Centre's cross-source data model.
--
-- Design notes:
-- * profiles carries the role used to gate hub tiles and edit access. It's
--   the one table here with a real RLS policy (self-read) since it's read
--   from the user-scoped client on the hub/login pages, not the service
--   role - everything else here follows the sales-data precedent (RLS on,
--   zero public policies, service-role only) since it's the same kind of
--   sensitive internal business data.
-- * facts_daily is the generic backbone described in the brief: new data
--   sources (Metricool, GA4, GBP, Shopify) plug in as rows keyed on
--   (date, source, entity_type, entity_id, metric) with no migrations
--   needed. Module-specific typed tables (campaigns, creative_assets,
--   content_calendar, kols, tasks) are added in their own build-order
--   steps rather than all at once here.
-- * app_settings holds editable taxonomy (pillars, statuses, attribution
--   sources) as jsonb, since this app runs on Vercel where the filesystem
--   is read-only at runtime - a literal editable settings.json file
--   wouldn't persist, so this is the practical equivalent of the brief's
--   "/config/settings.json ... editable in a Settings page."

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'viewer'
    check (role in ('admin', 'marketing', 'ops', 'viewer')),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
create policy "profiles: read own row" on profiles
  for select using (auth.uid() = id);

create table if not exists assumptions (
  id bigint generated always as identity primary key,
  key text not null unique,
  value numeric not null,
  label text,
  updated_at timestamptz not null default now()
);

alter table assumptions enable row level security;

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

create table if not exists facts_daily (
  id bigint generated always as identity primary key,
  date date not null,
  source text not null,
  entity_type text not null,
  entity_id text not null,
  metric text not null,
  value numeric not null,
  unique (date, source, entity_type, entity_id, metric)
);

create index if not exists facts_daily_date_idx on facts_daily (date);
create index if not exists facts_daily_source_idx on facts_daily (source);
create index if not exists facts_daily_entity_idx
  on facts_daily (entity_type, entity_id);

alter table facts_daily enable row level security;

-- The existing `stores` table (from the Odoo sales sync) already represents
-- the same four physical locations this brief describes - extend it rather
-- than duplicating a second stores table. odoo_pos_config_id becomes
-- nullable so a pre-opening store (e.g. "NSA") can exist here before it has
-- a real Odoo POS config - the brief requires adding stores without code
-- changes, and a NOT NULL Odoo link would block that for an unopened store.
alter table stores alter column odoo_pos_config_id drop not null;
alter table stores add column if not exists address text;
alter table stores add column if not exists gbp_location_id text;
alter table stores add column if not exists is_preopening boolean not null default false;
-- A stable identifier independent of whatever Odoo happens to name the
-- pos.config (used to attach the real addresses in the seed migration
-- without guessing an exact name match).
alter table stores add column if not exists slug text unique;
