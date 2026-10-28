-- Colour/size name reconciliation across sources.
--
-- Odoo's own `products.color`/`products.size` and the PO sheet's
-- `colorway`/`size` columns don't always spell the same physical
-- attribute the same way (the business's own example: "Bone" in one
-- place, "Off White" in another). The forecast page's colour/size
-- dropdowns, the colour/size trailing-sales-mix allocation, and the PO
-- grid's CMT-price lookup (which joins Odoo variants against PO lines by
-- colour+size) all need one canonical spelling per attribute value - and
-- per the brief, that comes from an explicit mapping table, never from
-- parsing or guessing a string similarity.
--
-- A value with no row here is its own canonical form (no alias needed).
-- `alias_value` is unique per `attribute_type` so a lookup is a single
-- row, never ambiguous.

create table if not exists attribute_aliases (
  id bigint generated always as identity primary key,
  attribute_type text not null check (attribute_type in ('color', 'size')),
  canonical_value text not null,
  alias_value text not null,
  note text,
  created_at timestamptz not null default now(),
  unique (attribute_type, alias_value)
);

comment on table attribute_aliases is
  'Explicit colour/size name reconciliation (e.g. alias "Off White" -> canonical "Bone") - never inferred from string matching. A value absent here is its own canonical form.';

alter table attribute_aliases enable row level security;
-- Intentionally no policies: only the service role (server-side) can read/write, same as every other table here.
