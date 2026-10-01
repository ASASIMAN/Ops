-- /operations: excludes Odoo's loyalty-point redemption lines ("Redeem
-- Rp100,000", "Redeem Rp.250,000", ...) from the Top products / Top
-- variants rankings.
--
-- These sync as real rows in `products` (so they do have a product_id -
-- that's why they show up at all), but they aren't merchandise: no SKU,
-- no colour/size, and their "units" count is really a count of how many
-- orders redeemed that reward, not units of anything sold. Worse, a
-- popular round-number reward can out-rank real products in units,
-- crowding them off a Top 20 list.
--
-- Deliberately NOT excluded from ops_sales_totals / ops_sales_daily /
-- ops_sales_by_store - a redemption is a real discount that reduced that
-- day's/store's actual revenue, so the totals and the Sales over time
-- chart should keep reflecting it. Only "what did we sell" rankings
-- exclude it.
--
-- Matched by name prefix (case-insensitive) since that's the one
-- consistent thing across however Odoo/the POS config formats the
-- amount ("Rp100,000" vs "Rp.250,000" have been seen).
--
-- No parameter/return-type change, so this is a plain create-or-replace,
-- no drop needed.

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
    and (p_product_name is null or p.name ilike '%' || p_product_name || '%')
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
    and (p_product_name is null or p.name ilike '%' || p_product_name || '%')
    and p.name not ilike 'redeem%'
  group by 1, 2, 3, 4, 5, 6, 7, 8
  order by 9 desc, 10 desc
  limit greatest(coalesce(p_limit, 20), 0);
$$;
