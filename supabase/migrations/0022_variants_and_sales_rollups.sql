-- /operations adjustments: full product-variant attributes + sales rollups
--
-- Two separate things in here:
--
-- 1. Product variants. The Odoo adapter only ever resolved two attributes -
--    Color and Size - and threw every other one away. Odoo models all
--    variant dimensions identically (product.template.attribute.value), so
--    whatever this catalogue calls its third dimension ("Type", "Style",
--    "Fit", ...) was being silently dropped. `variant_attributes` now stores
--    the complete attribute-name -> value map exactly as Odoo reports it, so
--    nothing is lost regardless of naming; `variant_type` is a convenience
--    column derived from it (see the comment below) so the dashboard can
--    filter and group on it without digging into JSON.
--
-- 2. Rollups. The dashboard table is capped at 1000 rows. That's fine for a
--    browsable list but wrong as the basis for totals, a "top 20", or a
--    chart - they'd quietly describe only the first 1000 lines. These
--    functions aggregate in Postgres across the whole filtered range
--    instead, so the new sections are correct at any row count.
--
--    Days are bucketed in Asia/Makassar (WITA), which is where the stores
--    actually are - a sale at 07:00 Bali on the 3rd belongs to the 3rd, not
--    to the 2nd as UTC bucketing would have it.

-- 1. Product variant attributes ----------------------------------------------

alter table products add column if not exists variant_type text;
alter table products add column if not exists variant_attributes jsonb;

create index if not exists products_variant_type_idx on products (variant_type);

comment on column products.variant_attributes is
  'Every product.template.attribute.value on this Odoo variant, as {"<Odoo attribute name>": "<value>"}. Source of truth: color/size/variant_type are conveniences derived from it at sync time.';
comment on column products.variant_type is
  'Derived at sync time: the variant attribute value(s) that are neither Colour nor Size, joined by " / ". Resolved positionally rather than by matching a guessed attribute name, because Odoo instances name this dimension differently.';

-- 2. Sales rollups -----------------------------------------------------------
--
-- Every function takes the same filter set. A null array means "no filter on
-- this dimension" (the dashboard passes null rather than an empty array).

create or replace function ops_sales_totals(
  p_from timestamptz,
  p_to timestamptz,
  p_store_ids bigint[] default null,
  p_colors text[] default null,
  p_sizes text[] default null,
  p_types text[] default null
)
returns table (
  revenue numeric,
  units numeric,
  order_count bigint,
  line_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(sum(l.subtotal), 0)::numeric,
    coalesce(sum(l.qty), 0)::numeric,
    count(distinct o.id)::bigint,
    count(l.id)::bigint
  from order_lines l
  join orders o on o.id = l.order_id
  left join products p on p.id = l.product_id
  where o.order_date >= p_from
    and o.order_date < p_to
    and (p_store_ids is null or o.store_id = any (p_store_ids))
    and (p_colors is null or p.color = any (p_colors))
    and (p_sizes is null or p.size = any (p_sizes))
    and (p_types is null or p.variant_type = any (p_types));
$$;

create or replace function ops_sales_daily(
  p_from timestamptz,
  p_to timestamptz,
  p_store_ids bigint[] default null,
  p_colors text[] default null,
  p_sizes text[] default null,
  p_types text[] default null
)
returns table (
  day date,
  revenue numeric,
  units numeric,
  order_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    (o.order_date at time zone 'Asia/Makassar')::date,
    sum(l.subtotal)::numeric,
    sum(l.qty)::numeric,
    count(distinct o.id)::bigint
  from order_lines l
  join orders o on o.id = l.order_id
  left join products p on p.id = l.product_id
  where o.order_date >= p_from
    and o.order_date < p_to
    and (p_store_ids is null or o.store_id = any (p_store_ids))
    and (p_colors is null or p.color = any (p_colors))
    and (p_sizes is null or p.size = any (p_sizes))
    and (p_types is null or p.variant_type = any (p_types))
  group by 1
  order by 1;
$$;

create or replace function ops_sales_by_store(
  p_from timestamptz,
  p_to timestamptz,
  p_store_ids bigint[] default null,
  p_colors text[] default null,
  p_sizes text[] default null,
  p_types text[] default null
)
returns table (
  store_id bigint,
  store_name text,
  units numeric,
  revenue numeric
)
language sql
stable
set search_path = public
as $$
  select
    o.store_id,
    coalesce(s.name, 'Unassigned'),
    sum(l.qty)::numeric,
    sum(l.subtotal)::numeric
  from order_lines l
  join orders o on o.id = l.order_id
  left join stores s on s.id = o.store_id
  left join products p on p.id = l.product_id
  where o.order_date >= p_from
    and o.order_date < p_to
    and (p_store_ids is null or o.store_id = any (p_store_ids))
    and (p_colors is null or p.color = any (p_colors))
    and (p_sizes is null or p.size = any (p_sizes))
    and (p_types is null or p.variant_type = any (p_types))
  group by 1, 2
  order by 4 desc;
$$;

-- Top *products*: one row per Odoo product template, variants collapsed
-- together. products.name on product.product is the template name in Odoo
-- (display_name is the one carrying the attribute suffix), so grouping on it
-- alongside the template id is safe.
create or replace function ops_top_products(
  p_from timestamptz,
  p_to timestamptz,
  p_store_ids bigint[] default null,
  p_colors text[] default null,
  p_sizes text[] default null,
  p_types text[] default null,
  p_limit integer default 10
)
returns table (
  template_id integer,
  product_name text,
  units numeric,
  revenue numeric
)
language sql
stable
set search_path = public
as $$
  select
    p.odoo_template_id,
    min(p.name),
    sum(l.qty)::numeric,
    sum(l.subtotal)::numeric
  from order_lines l
  join orders o on o.id = l.order_id
  join products p on p.id = l.product_id
  where o.order_date >= p_from
    and o.order_date < p_to
    and (p_store_ids is null or o.store_id = any (p_store_ids))
    and (p_colors is null or p.color = any (p_colors))
    and (p_sizes is null or p.size = any (p_sizes))
    and (p_types is null or p.variant_type = any (p_types))
  group by 1
  order by 3 desc, 4 desc
  limit greatest(coalesce(p_limit, 10), 0);
$$;

-- Top *variants*: one row per product.product, i.e. per SKU.
create or replace function ops_top_variants(
  p_from timestamptz,
  p_to timestamptz,
  p_store_ids bigint[] default null,
  p_colors text[] default null,
  p_sizes text[] default null,
  p_types text[] default null,
  p_limit integer default 20
)
returns table (
  product_id bigint,
  product_name text,
  sku text,
  color text,
  size text,
  variant_type text,
  category_name text,
  units numeric,
  revenue numeric
)
language sql
stable
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.sku,
    p.color,
    p.size,
    p.variant_type,
    c.name,
    sum(l.qty)::numeric,
    sum(l.subtotal)::numeric
  from order_lines l
  join orders o on o.id = l.order_id
  join products p on p.id = l.product_id
  left join product_categories c on c.id = p.category_id
  where o.order_date >= p_from
    and o.order_date < p_to
    and (p_store_ids is null or o.store_id = any (p_store_ids))
    and (p_colors is null or p.color = any (p_colors))
    and (p_sizes is null or p.size = any (p_sizes))
    and (p_types is null or p.variant_type = any (p_types))
  group by 1, 2, 3, 4, 5, 6, 7
  order by 8 desc, 9 desc
  limit greatest(coalesce(p_limit, 20), 0);
$$;

-- Same posture as the tables these read: server-side only. RLS would block
-- anon anyway (these run as the invoker, not as definer), but revoking makes
-- the intent explicit rather than relying on that.
do $$
declare
  fn text;
begin
  for fn in
    select pr.oid::regprocedure::text
    from pg_proc pr
    join pg_namespace ns on ns.oid = pr.pronamespace
    where ns.nspname = 'public'
      and pr.proname in (
        'ops_sales_totals',
        'ops_sales_daily',
        'ops_sales_by_store',
        'ops_top_products',
        'ops_top_variants'
      )
  loop
    execute format('revoke execute on function %s from public', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;
