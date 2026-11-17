-- Rollups for the executive dashboard, the Sales & Retail section and the
-- Inventory stock screen. Everything here READS the tables the Odoo sync
-- already fills (orders, order_lines, products, stock_levels) - no new
-- synced data, no change to any existing function.
--
-- Definitions, stated once so every screen means the same thing:
--
-- * Revenue is sum(order_lines.subtotal) - Odoo's price_subtotal, i.e. net
--   of line discounts and EXCLUDING tax - exactly the basis the existing
--   ops_sales_* functions (and so /operations) already use. The headline
--   revenue / units / orders tiles keep calling ops_sales_totals itself, so
--   the dashboard and the Sales explorer can never disagree.
-- * Days and months are Bali time (Asia/Makassar, WITA), as everywhere else.
-- * A "return" is a line with a negative quantity - how Odoo POS records a
--   refund. Nothing is inferred beyond that.
-- * A "redemption" is one of Odoo's loyalty reward lines (product name
--   starting "Redeem", the same match migration 0026 uses). They are not
--   merchandise, so they are left out of category / product breakdowns and
--   reported on their own line; they stay IN revenue, because a redemption
--   really did reduce what the store took (same choice as migration 0026).
-- * Line-discount value is what the discount took off, on the same ex-tax
--   basis as revenue: subtotal * d / (100 - d) for a d% line (for a 100%
--   line, where subtotal is 0, quantity * unit price).
-- * Inventory value is on-hand units x the product's Odoo LIST price - retail
--   value, not cost. Cost prices are not synced, so there is no cost value
--   and no gross margin here; the screens say so rather than estimate one.
-- * Negative on-hand quantities (Odoo allows them) count as 0 for totals.
--
-- Same access posture as the rest of the schema: these run for the
-- service-role client only.

create or replace function biz_sales_extras(
  p_from timestamptz,
  p_to timestamptz,
  p_store_ids bigint[] default null
)
returns table (
  discount_value numeric,
  discounted_lines bigint,
  redemption_value numeric,
  redemption_lines bigint,
  return_units numeric,
  return_value numeric,
  return_lines bigint
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(sum(
      case
        when l.discount_percent >= 100 then l.qty * l.unit_price
        else l.subtotal * l.discount_percent / (100 - l.discount_percent)
      end
    ) filter (where l.qty > 0 and l.discount_percent > 0 and not r.is_redeem), 0)::numeric,
    count(*) filter (where l.qty > 0 and l.discount_percent > 0 and not r.is_redeem)::bigint,
    coalesce(-sum(l.subtotal) filter (where r.is_redeem), 0)::numeric,
    count(*) filter (where r.is_redeem)::bigint,
    coalesce(-sum(l.qty) filter (where l.qty < 0 and not r.is_redeem), 0)::numeric,
    coalesce(-sum(l.subtotal) filter (where l.qty < 0 and not r.is_redeem), 0)::numeric,
    count(*) filter (where l.qty < 0 and not r.is_redeem)::bigint
  from order_lines l
  join orders o on o.id = l.order_id
  left join products p on p.id = l.product_id
  cross join lateral (select coalesce(p.name ilike 'redeem%', false) as is_redeem) r
  where o.order_date >= p_from
    and o.order_date < p_to
    and (p_store_ids is null or o.store_id = any (p_store_ids));
$$;

-- Per POS register. Same revenue/units basis as ops_sales_by_store, plus the
-- order count that function doesn't return (needed for a store's average
-- order value). The app folds duplicate registers of one shop together
-- (see operations/store-groups.ts), which is safe for order_count because an
-- order belongs to exactly one register.
create or replace function biz_sales_by_store(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  store_id bigint,
  store_name text,
  revenue numeric,
  units numeric,
  order_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    o.store_id,
    coalesce(s.name, 'Unassigned'),
    coalesce(sum(l.subtotal), 0)::numeric,
    coalesce(sum(l.qty), 0)::numeric,
    count(distinct o.id)::bigint
  from order_lines l
  join orders o on o.id = l.order_id
  left join stores s on s.id = o.store_id
  where o.order_date >= p_from
    and o.order_date < p_to
  group by 1, 2
  order by 3 desc;
$$;

-- One row per register per day/week/month, for store trend lines.
create or replace function biz_sales_series_by_store(
  p_from timestamptz,
  p_to timestamptz,
  p_bucket text default 'day'
)
returns table (
  bucket_date date,
  store_id bigint,
  revenue numeric,
  units numeric,
  order_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    date_trunc(
      case p_bucket when 'week' then 'week' when 'month' then 'month' else 'day' end,
      o.order_date at time zone 'Asia/Makassar'
    )::date,
    o.store_id,
    coalesce(sum(l.subtotal), 0)::numeric,
    coalesce(sum(l.qty), 0)::numeric,
    count(distinct o.id)::bigint
  from order_lines l
  join orders o on o.id = l.order_id
  where o.order_date >= p_from
    and o.order_date < p_to
  group by 1, 2
  order by 1, 2;
$$;

create or replace function biz_sales_by_category(
  p_from timestamptz,
  p_to timestamptz,
  p_store_ids bigint[] default null
)
returns table (
  category_id bigint,
  category_name text,
  revenue numeric,
  units numeric
)
language sql
stable
set search_path = public
as $$
  select
    c.id,
    coalesce(c.name, 'Uncategorised'),
    coalesce(sum(l.subtotal), 0)::numeric,
    coalesce(sum(l.qty), 0)::numeric
  from order_lines l
  join orders o on o.id = l.order_id
  join products p on p.id = l.product_id
  left join product_categories c on c.id = p.category_id
  where o.order_date >= p_from
    and o.order_date < p_to
    and (p_store_ids is null or o.store_id = any (p_store_ids))
    and p.name not ilike 'redeem%'
  group by 1, 2
  order by 3 desc;
$$;

-- One row per style (Odoo product template): what sold, how much, and how
-- much came back.
create or replace function biz_sales_by_product(
  p_from timestamptz,
  p_to timestamptz,
  p_store_ids bigint[] default null
)
returns table (
  template_id integer,
  product_name text,
  category_name text,
  units numeric,
  revenue numeric,
  order_count bigint,
  return_units numeric
)
language sql
stable
set search_path = public
as $$
  select
    p.odoo_template_id,
    min(p.name),
    min(c.name),
    coalesce(sum(l.qty), 0)::numeric,
    coalesce(sum(l.subtotal), 0)::numeric,
    count(distinct o.id)::bigint,
    coalesce(-sum(l.qty) filter (where l.qty < 0), 0)::numeric
  from order_lines l
  join orders o on o.id = l.order_id
  join products p on p.id = l.product_id
  left join product_categories c on c.id = p.category_id
  where o.order_date >= p_from
    and o.order_date < p_to
    and (p_store_ids is null or o.store_id = any (p_store_ids))
    and p.name not ilike 'redeem%'
  group by 1
  order by 5 desc, 4 desc, 1;
$$;

-- On-hand position per tracked stock location (office + each store).
create or replace function biz_inventory_summary()
returns table (
  location_id bigint,
  location_name text,
  kind text,
  store_id bigint,
  store_name text,
  units numeric,
  retail_value numeric,
  skus_in_stock bigint,
  skus_at_zero bigint,
  synced_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    sl.id,
    sl.odoo_complete_name,
    sl.kind,
    sl.store_id,
    s.name,
    coalesce(sum(greatest(lv.qty_on_hand, 0)), 0)::numeric,
    coalesce(sum(greatest(lv.qty_on_hand, 0) * coalesce(p.list_price, 0)), 0)::numeric,
    count(lv.id) filter (where lv.qty_on_hand > 0)::bigint,
    count(lv.id) filter (where lv.qty_on_hand <= 0)::bigint,
    max(lv.synced_at)
  from stock_locations sl
  left join stores s on s.id = sl.store_id
  left join stock_levels lv on lv.location_id = sl.id
  left join products p on p.id = lv.product_id
  where sl.active
  group by sl.id, sl.odoo_complete_name, sl.kind, sl.store_id, s.name
  order by sl.kind, sl.odoo_complete_name;
$$;

-- Styles holding stock, ranked by how little they sold over the last
-- p_days. "Slow" here is only that ranking - units on hand against units
-- actually sold - not a judgement about what should be marked down.
create or replace function biz_slow_movers(
  p_days integer default 90,
  p_limit integer default 20
)
returns table (
  template_id integer,
  product_name text,
  category_name text,
  on_hand numeric,
  retail_value numeric,
  units_sold numeric,
  last_sold date
)
language sql
stable
set search_path = public
as $$
  with stock as (
    select
      p.odoo_template_id as template_id,
      min(p.name) as product_name,
      min(c.name) as category_name,
      sum(greatest(lv.qty_on_hand, 0)) as on_hand,
      sum(greatest(lv.qty_on_hand, 0) * coalesce(p.list_price, 0)) as retail_value
    from stock_levels lv
    join stock_locations sl on sl.id = lv.location_id and sl.active
    join products p on p.id = lv.product_id
    left join product_categories c on c.id = p.category_id
    where p.name not ilike 'redeem%'
    group by 1
    having sum(greatest(lv.qty_on_hand, 0)) > 0
  ),
  sold as (
    select
      p.odoo_template_id as template_id,
      sum(l.qty) filter (
        where o.order_date >= now() - make_interval(days => greatest(coalesce(p_days, 90), 1))
      ) as units_sold,
      max((o.order_date at time zone 'Asia/Makassar')::date) filter (where l.qty > 0) as last_sold
    from order_lines l
    join orders o on o.id = l.order_id
    join products p on p.id = l.product_id
    group by 1
  )
  select
    st.template_id,
    st.product_name,
    st.category_name,
    st.on_hand::numeric,
    st.retail_value::numeric,
    coalesce(so.units_sold, 0)::numeric,
    so.last_sold
  from stock st
  left join sold so on so.template_id = st.template_id
  order by coalesce(so.units_sold, 0) asc, st.on_hand desc, st.template_id
  limit greatest(coalesce(p_limit, 20), 0);
$$;

-- One row per variant (SKU) with its stock at the office, across stores,
-- and per location, plus units sold in the last 30 days for context. Feeds
-- the Inventory > Stock table; filtering and paging happen here so the
-- screen never has to pull the whole catalogue.
--   p_view: 'all' | 'in' (anything on hand) | 'out' (nothing on hand
--   anywhere) | 'store_out' (on hand at the office or another shop but 0 in
--   at least one shop) | 'low' (total on hand between 1 and p_low_at).
create or replace function biz_stock_levels(
  p_search text default null,
  p_category_id bigint default null,
  p_view text default 'all',
  p_low_at numeric default 2,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  product_id bigint,
  template_id integer,
  product_name text,
  sku text,
  color text,
  size text,
  category_name text,
  list_price numeric,
  office_qty numeric,
  store_qty numeric,
  total_qty numeric,
  by_location jsonb,
  stores_at_zero integer,
  units_sold_30d numeric,
  total_rows bigint
)
language sql
stable
set search_path = public
as $$
  with locs as (
    select id, kind, odoo_complete_name from stock_locations where active
  ),
  per_product as (
    select
      p.id as product_id,
      p.odoo_template_id as template_id,
      p.name as product_name,
      p.sku,
      p.color,
      p.size,
      c.name as category_name,
      p.list_price,
      coalesce(sum(greatest(lv.qty_on_hand, 0)) filter (where l.kind = 'office'), 0) as office_qty,
      coalesce(sum(greatest(lv.qty_on_hand, 0)) filter (where l.kind = 'store'), 0) as store_qty,
      coalesce(sum(greatest(lv.qty_on_hand, 0)), 0) as total_qty,
      coalesce(
        jsonb_object_agg(l.odoo_complete_name, greatest(coalesce(lv.qty_on_hand, 0), 0))
          filter (where l.id is not null),
        '{}'::jsonb
      ) as by_location,
      (count(l.id) filter (where l.kind = 'store' and coalesce(lv.qty_on_hand, 0) <= 0))::integer as stores_at_zero
    from products p
    left join product_categories c on c.id = p.category_id
    cross join locs l
    left join stock_levels lv on lv.product_id = p.id and lv.location_id = l.id
    where p.name not ilike 'redeem%'
      and (p_category_id is null or p.category_id = p_category_id)
      and (
        p_search is null or btrim(p_search) = ''
        or p.name ilike '%' || btrim(p_search) || '%'
        or p.sku ilike '%' || btrim(p_search) || '%'
        or p.color ilike '%' || btrim(p_search) || '%'
      )
    group by p.id, p.odoo_template_id, p.name, p.sku, p.color, p.size, c.name, p.list_price
  ),
  filtered as (
    select *
    from per_product pp
    where case coalesce(p_view, 'all')
      when 'in' then pp.total_qty > 0
      when 'out' then pp.total_qty <= 0
      when 'store_out' then pp.total_qty > 0 and pp.stores_at_zero > 0
      when 'low' then pp.total_qty > 0 and pp.total_qty <= coalesce(p_low_at, 2)
      else true
    end
  ),
  sold as (
    select l.product_id, sum(l.qty) as units
    from order_lines l
    join orders o on o.id = l.order_id
    where o.order_date >= now() - interval '30 days'
    group by 1
  )
  select
    f.product_id,
    f.template_id,
    f.product_name,
    f.sku,
    f.color,
    f.size,
    f.category_name,
    f.list_price,
    f.office_qty::numeric,
    f.store_qty::numeric,
    f.total_qty::numeric,
    f.by_location,
    f.stores_at_zero,
    coalesce(s.units, 0)::numeric,
    count(*) over ()::bigint
  from filtered f
  left join sold s on s.product_id = f.product_id
  order by f.product_name, f.color nulls first, f.size nulls first, f.product_id
  limit greatest(least(coalesce(p_limit, 100), 500), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Purchase orders that still have units to arrive. "Open" is the PO
-- planner's own definition (src/lib/forecast/planner.ts): ordered minus
-- received, never below 0, with a line that has no receipt recorded counted
-- as nothing received yet.
create or replace function biz_open_purchase_orders()
returns table (
  po_id bigint,
  po_no text,
  po_date date,
  manual_eta_date date,
  line_count bigint,
  qty_ordered numeric,
  qty_received numeric,
  qty_open numeric
)
language sql
stable
set search_path = public
as $$
  select
    po.id,
    po.po_no,
    po.po_date,
    po.manual_eta_date,
    count(l.id)::bigint,
    coalesce(sum(l.qty_ordered), 0)::numeric,
    coalesce(sum(coalesce(l.qty_received_total, 0)), 0)::numeric,
    coalesce(sum(greatest(coalesce(l.qty_ordered, 0) - coalesce(l.qty_received_total, 0), 0)), 0)::numeric
  from purchase_orders po
  join purchase_order_lines l on l.po_id = po.id
  group by po.id, po.po_no, po.po_date, po.manual_eta_date
  having sum(greatest(coalesce(l.qty_ordered, 0) - coalesce(l.qty_received_total, 0), 0)) > 0
  order by po.po_date desc, po.id desc;
$$;

-- Monthly sales targets, entered by management on Sales > Stores. Keyed by
-- the shop (the same folded key the app groups registers by - "canggu",
-- "ubud", ...), not by an Odoo register id, since one shop can have more
-- than one register. A month with no row simply has no target: nothing is
-- defaulted or carried forward.
create table if not exists store_targets (
  id bigint generated always as identity primary key,
  store_key text not null,
  month date not null check (extract(day from month) = 1),
  target_idr numeric not null check (target_idr >= 0),
  updated_at timestamptz not null default now(),
  unique (store_key, month)
);

alter table store_targets enable row level security;

notify pgrst, 'reload schema';
