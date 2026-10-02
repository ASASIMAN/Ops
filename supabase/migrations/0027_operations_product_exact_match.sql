-- /operations: the product filter is now a dropdown of product families
-- (Linen Pants, Kavash T-Shirt, ...) rather than a free-text search box,
-- so p_product_name changes from a case-insensitive substring match to an
-- exact match on products.name.
--
-- Substring matching would be wrong for a picker: "Origin Shirt" would
-- also pull in "Origin Shirt - Long Sleeve", and "Linen Pants" anything
-- that merely contains it. products.name is the Odoo template name shared
-- by every colour/size variant of a product, which is exactly what each
-- dropdown entry represents.
--
-- Parameters and return types are unchanged for all five functions, so
-- these are plain create-or-replace statements - no drop, and no PostgREST
-- schema-cache reload needed. ops_top_products / ops_top_variants keep the
-- 'redeem%' exclusion from migration 0026.

create or replace function ops_sales_totals(
  p_from timestamptz,
  p_to timestamptz,
  p_store_ids bigint[] default null,
  p_colors text[] default null,
  p_sizes text[] default null,
  p_types text[] default null,
  p_product_name text default null
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
    and (p_types is null or p.variant_type = any (p_types))
    and (p_product_name is null or p.name = p_product_name);
$$;

create or replace function ops_sales_daily(
  p_from timestamptz,
  p_to timestamptz,
  p_store_ids bigint[] default null,
  p_colors text[] default null,
  p_sizes text[] default null,
  p_types text[] default null,
  p_product_name text default null
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
    and (p_product_name is null or p.name = p_product_name)
  group by 1
  order by 1;
$$;

create or replace function ops_sales_by_store(
  p_from timestamptz,
  p_to timestamptz,
  p_store_ids bigint[] default null,
  p_colors text[] default null,
  p_sizes text[] default null,
  p_types text[] default null,
  p_product_name text default null
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
    and (p_product_name is null or p.name = p_product_name)
  group by 1, 2
  order by 4 desc;
$$;

create or replace function ops_top_products(
  p_from timestamptz,
  p_to timestamptz,
  p_store_ids bigint[] default null,
  p_colors text[] default null,
  p_sizes text[] default null,
  p_types text[] default null,
  p_limit integer default 10,
  p_product_name text default null
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
    and (p_product_name is null or p.name = p_product_name)
    and p.name not ilike 'redeem%'
  group by 1
  order by 3 desc, 4 desc
  limit greatest(coalesce(p_limit, 10), 0);
$$;

create or replace function ops_top_variants(
  p_from timestamptz,
  p_to timestamptz,
  p_store_ids bigint[] default null,
  p_colors text[] default null,
  p_sizes text[] default null,
  p_types text[] default null,
  p_limit integer default 20,
  p_product_name text default null
)
returns table (
  product_id bigint,
  product_name text,
  sku text,
  color text,
  size text,
  variant_type text,
  category_name text,
  variant_attributes jsonb,
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
    p.variant_attributes,
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
    and (p_product_name is null or p.name = p_product_name)
    and p.name not ilike 'redeem%'
  group by 1, 2, 3, 4, 5, 6, 7, 8
  order by 9 desc, 10 desc
  limit greatest(coalesce(p_limit, 20), 0);
$$;
