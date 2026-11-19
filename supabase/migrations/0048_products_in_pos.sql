-- Which products are actually sold in the POS, so product pickers (the
-- /forecast product search) list only those - not services, samples,
-- marketing/building costs or archived items that also live in Odoo's
-- product table.
--
-- Copied from Odoo on every sync (stock sync and the sales sync's
-- catalogue refresh), for every company the API user can see:
--   available_in_pos - product.template's "Available in POS" checkbox
--   odoo_active      - false once the product or variant is archived
-- Both stay null until the first sync after this migration runs; while
-- every row is null the app lists all products, as before.

alter table products add column if not exists available_in_pos boolean;
alter table products add column if not exists odoo_active boolean;

create or replace function set_product_pos_flags(p_flags jsonb)
returns integer
language sql
volatile
set search_path = public
as $$
  with input as (
    select
      (x ->> 'id')::integer as odoo_product_id,
      (x ->> 'pos')::boolean as available_in_pos,
      (x ->> 'active')::boolean as odoo_active
    from jsonb_array_elements(p_flags) x
  ),
  updated as (
    update products p
       set available_in_pos = i.available_in_pos,
           odoo_active = i.odoo_active
      from input i
     where p.odoo_product_id = i.odoo_product_id
       and (p.available_in_pos is distinct from i.available_in_pos
            or p.odoo_active is distinct from i.odoo_active)
    returning 1
  )
  select count(*)::integer from updated;
$$;

notify pgrst, 'reload schema';
