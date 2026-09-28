-- /operations: surfaces the full Odoo attribute map (products.variant_attributes,
-- populated since migration 0022 - see its comment) on ops_top_variants, so
-- the Top variants table can show every attribute Odoo has for a SKU, not
-- just the ones broken out into their own colour/size/type columns.
--
-- Only ops_top_variants gets this - it's the one rollup that's already
-- one row per SKU. ops_top_products aggregates every colour/size/type
-- variant of a template into one row, so a single attribute map wouldn't
-- describe it; the per-product-line query below (used by the Sales lines
-- table) already joins products directly and just needs the column added
-- to its select list, no migration required for that half.
--
-- Return type changed, so this has to be dropped and recreated rather
-- than `create or replace function`-ed in place.

drop function if exists ops_top_variants(timestamptz, timestamptz, bigint[], text[], text[], text[], integer, text);

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
  group by 1, 2, 3, 4, 5, 6, 7, 8
  order by 9 desc, 10 desc
  limit greatest(coalesce(p_limit, 20), 0);
$$;

revoke execute on function ops_top_variants(
  timestamptz, timestamptz, bigint[], text[], text[], text[], integer, text
) from public;
grant execute on function ops_top_variants(
  timestamptz, timestamptz, bigint[], text[], text[], text[], integer, text
) to service_role;
