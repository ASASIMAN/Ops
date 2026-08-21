-- Sales dashboard schema (Odoo POS sync target)
--
-- Design notes:
-- * order_lines is the grain everything else rolls up from - one row per
--   product sold in one order. Trends, best/worst sellers, sell-through by
--   store/category/size/color are all aggregations over this table.
-- * RLS is enabled with no policies, so the anon/publishable key gets zero
--   access. The sync job and the dashboard both read/write with the
--   Supabase service role key, server-side only - this data never goes
--   through the browser-exposed client.
-- * Every table keeps its Odoo id (odoo_id) as the join key back to the
--   source system, so re-syncing is an upsert on that column, not a guess.

create table if not exists stores (
  id bigint generated always as identity primary key,
  odoo_pos_config_id integer not null unique,
  name text not null,
  active boolean not null default true
);

create table if not exists product_categories (
  id bigint generated always as identity primary key,
  odoo_id integer not null unique,
  name text not null,
  parent_odoo_id integer
);

create table if not exists products (
  id bigint generated always as identity primary key,
  odoo_product_id integer not null unique, -- product.product id (the variant)
  odoo_template_id integer not null,       -- product.template id
  name text not null,
  sku text,
  category_id bigint references product_categories (id),
  color text,
  size text,
  list_price numeric(12, 2)
);

create table if not exists orders (
  id bigint generated always as identity primary key,
  odoo_order_id integer not null unique,
  store_id bigint references stores (id),
  order_date timestamptz not null,
  pos_reference text,
  state text,
  total_amount numeric(12, 2)
);

create table if not exists order_lines (
  id bigint generated always as identity primary key,
  odoo_line_id integer not null unique,
  order_id bigint not null references orders (id) on delete cascade,
  product_id bigint references products (id),
  qty numeric(12, 3) not null,
  unit_price numeric(12, 2) not null,
  discount_percent numeric(5, 2) not null default 0,
  subtotal numeric(12, 2) not null
);

create index if not exists order_lines_order_id_idx on order_lines (order_id);
create index if not exists order_lines_product_id_idx on order_lines (product_id);
create index if not exists orders_order_date_idx on orders (order_date);
create index if not exists orders_store_id_idx on orders (store_id);
create index if not exists products_category_id_idx on products (category_id);
create index if not exists products_color_idx on products (color);
create index if not exists products_size_idx on products (size);

-- Tracks each sync run so a bad sync is visible without digging through logs.
create table if not exists sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running', -- running | success | error
  orders_synced integer not null default 0,
  error_message text
);

alter table stores enable row level security;
alter table product_categories enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table order_lines enable row level security;
alter table sync_runs enable row level security;
-- Intentionally no policies: only the service role (server-side) can read/write.
