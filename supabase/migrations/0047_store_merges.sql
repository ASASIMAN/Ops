-- Merges every Odoo POS config of the same physical store into that
-- store's live row. ASASI's company-profile change in Odoo left two POS
-- configs per store, e.g. "ASASI Pererenan" (old company) next to
-- "ASASI. PERERENAN" (current) - confirmed by the business (2026-11-18)
-- for all four stores: Pererenan, Canggu, Nusa Dua, Ubud.
--
-- stores.merged_into_store_id records the merge explicitly: a row with it
-- set is another POS config for that store. Its orders are moved onto the
-- live store here, and the Odoo sync stores any order it later reads for
-- that config against the live store too (src/lib/odoo/sync.ts). Nothing
-- is deleted; the old rows stay, inactive.
--
-- Which rows: any store row without a slug whose name, lowercased with
-- everything but letters and digits removed, contains the live store's
-- slug without its hyphen ("asasipererenan" contains "pererenan",
-- "asasinusadua" contains "nusadua"). The four live rows themselves have
-- slugs (migration 0006), so they're never matched.
--
-- Safe to re-run.

alter table stores
  add column if not exists merged_into_store_id bigint references stores (id);

comment on column stores.merged_into_store_id is
  'Set when this row is another Odoo POS config for the same physical store: orders on it are stored against this store id instead. See migration 0047.';

with live as (
  select id, replace(slug, '-', '') as key
  from stores
  where slug in ('pererenan', 'canggu', 'nusa-dua', 'ubud')
)
update stores s
set merged_into_store_id = live.id,
    active = false
from live
where s.slug is null
  and s.id <> live.id
  and regexp_replace(lower(s.name), '[^a-z0-9]', '', 'g') like '%' || live.key || '%';

update orders o
set store_id = s.merged_into_store_id
from stores s
where o.store_id = s.id
  and s.merged_into_store_id is not null;

-- To check the result:
--   select s.id, s.name, s.active, m.name as merged_into
--   from stores s left join stores m on m.id = s.merged_into_store_id
--   order by coalesce(s.merged_into_store_id, s.id), s.id;
