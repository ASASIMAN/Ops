-- Forecasting + inventory schema for the /forecast module.
--
-- Design notes:
-- * Odoo doesn't have a `stores` row for the office - it's a stock
--   location, not a pos.config, so it can't live in the `stores` table.
--   `stock_locations` is a new table that models exactly what we sync
--   stock for: the office (staging warehouse) plus each store's stock
--   location, cross-referenced to `stores` where one exists.
-- * `stock_levels` holds current on-hand qty per product per location,
--   replaced (upserted) in place on every sync - Odoo's stock.quant is a
--   live snapshot, not a ledger, so there's nothing to append to. If
--   stock history is needed later (e.g. to backtest against past stock
--   positions), that's a new table, not a change to this one.
-- * `vendor_reorder_settings` holds the two restock inputs the brief
--   flagged as not yet available: per-SKU vendor lead time and the
--   target service level used for safety stock. `product_id null` is
--   the global default row (partial unique indexes below enforce at
--   most one). `lead_time_days` is left NULL until real data is
--   supplied - see `src/lib/forecast/restock.ts` for the flagged
--   fallback used in the meantime.
-- * Same RLS posture as every other table here: enabled, zero policies,
--   service-role only.

create table if not exists stock_locations (
  id bigint generated always as identity primary key,
  odoo_location_id integer not null unique,
  odoo_complete_name text not null, -- e.g. "ASOF/Stock", exactly as Odoo names it
  kind text not null check (kind in ('office', 'store')),
  store_id bigint references stores (id), -- set for kind = 'store'; null for the office
  active boolean not null default true
);

comment on table stock_locations is
  'Odoo stock.location rows this app syncs quants for - the office staging warehouse plus each store''s own stock location.';

create table if not exists stock_levels (
  id bigint generated always as identity primary key,
  product_id bigint not null references products (id),
  location_id bigint not null references stock_locations (id),
  qty_on_hand numeric(12, 3) not null default 0,
  synced_at timestamptz not null default now(),
  unique (product_id, location_id)
);

comment on table stock_levels is
  'Current on-hand qty per SKU per location, from Odoo stock.quant. Overwritten in place each sync - not a history table. qty_on_hand is gross on-hand (stock.quant.quantity), not netted against reservations - the brief did not ask for available-to-promise, and this app has no reservation data to net against yet; flagged here rather than guessed.';

create index if not exists stock_levels_product_id_idx on stock_levels (product_id);
create index if not exists stock_levels_location_id_idx on stock_levels (location_id);

create table if not exists vendor_reorder_settings (
  id bigint generated always as identity primary key,
  product_id bigint references products (id),
  lead_time_days numeric(6, 2), -- ASSUMPTION: NULL until real vendor lead times are supplied
  target_service_level numeric(4, 3) not null default 0.90,
  moq numeric(12, 3),
  review_period_days numeric(6, 2),
  updated_at timestamptz not null default now()
);

comment on table vendor_reorder_settings is
  'Restock inputs the brief flagged as not yet available. product_id = null is the single global default row (see the partial unique indexes below); per-SKU rows override it once real lead-time data lands.';
comment on column vendor_reorder_settings.lead_time_days is
  'ASSUMPTION: unset (null) until real vendor lead times are supplied. src/lib/forecast/restock.ts falls back to a flagged placeholder when this is null - never silently treated as 0.';

create unique index if not exists vendor_reorder_settings_product_idx
  on vendor_reorder_settings (product_id) where product_id is not null;
create unique index if not exists vendor_reorder_settings_global_idx
  on vendor_reorder_settings ((1)) where product_id is null;

insert into vendor_reorder_settings (product_id, target_service_level)
select null, 0.90
where not exists (select 1 from vendor_reorder_settings where product_id is null);

alter table sync_runs add column if not exists sync_type text not null default 'sales'
  check (sync_type in ('sales', 'stock'));

alter table stock_locations enable row level security;
alter table stock_levels enable row level security;
alter table vendor_reorder_settings enable row level security;
-- Intentionally no policies: only the service role (server-side) can read/write.

-- Sales/demand rollup used by the forecast engine ---------------------------
--
-- One flexible function rather than one per grain: it returns per-SKU,
-- per-store, per-category rows bucketed by day/week/month, and every
-- dashboard rollup (company total, per-store, per-category, per-SKU) is a
-- group-by over this same result set in application code. This keeps the
-- historical-demand query identical everywhere it's read from, which
-- matters because the restock alerts (function 1) and the demand/revenue
-- forecasts (functions 2 and 3) must never be able to drift onto two
-- different views of "what did we sell" - see src/lib/forecast/data.ts.
--
-- Bucketed in Asia/Makassar (WITA), same as ops_sales_daily (migration
-- 0022) - the stores are in Bali, so a day/month boundary means the
-- trading day/month staff actually worked.
create or replace function ops_period_demand(
  p_from timestamptz,
  p_to timestamptz,
  p_bucket text default 'month', -- 'day' | 'week' | 'month'
  p_store_ids bigint[] default null,
  p_product_ids bigint[] default null
)
returns table (
  product_id bigint,
  store_id bigint,
  category_id bigint,
  bucket_date date,
  units numeric,
  revenue numeric
)
language plpgsql
stable
set search_path = public
as $$
begin
  if p_bucket not in ('day', 'week', 'month') then
    raise exception 'ops_period_demand: unsupported bucket %', p_bucket;
  end if;

  return query
  select
    p.id,
    o.store_id,
    p.category_id,
    date_trunc(p_bucket, o.order_date at time zone 'Asia/Makassar')::date,
    sum(l.qty)::numeric,
    sum(l.subtotal)::numeric
  from order_lines l
  join orders o on o.id = l.order_id
  join products p on p.id = l.product_id
  where o.order_date >= p_from
    and o.order_date < p_to
    and (p_store_ids is null or o.store_id = any (p_store_ids))
    and (p_product_ids is null or p.id = any (p_product_ids))
  group by 1, 2, 3, 4
  order by 4;
end;
$$;

do $$
declare
  fn text;
begin
  for fn in
    select pr.oid::regprocedure::text
    from pg_proc pr
    join pg_namespace ns on ns.oid = pr.pronamespace
    where ns.nspname = 'public'
      and pr.proname in ('ops_period_demand')
  loop
    execute format('revoke execute on function %s from public', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;
