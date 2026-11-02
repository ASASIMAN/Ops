-- Merges Odoo templates that are genuinely the same product under two
-- different template ids. Confirmed by the business (2026-11-02): a
-- company-profile change in Odoo re-created products under new ids,
-- duplicating them rather than updating in place.
--
-- An explicit mapping, not an automatic "same name = same product" rule
-- applied forever - a *future* name collision could just as easily be a
-- real, unrelated duplicate (a typo, a copy-paste in Odoo) that
-- shouldn't be silently merged without someone looking at it. This
-- table only merges what's listed in it; anything colliding without a
-- row here still gets flagged (see fetchStyleOptions in
-- src/lib/forecast/style.ts), not auto-merged.
--
-- The seed below captures every name collision that exists in `products`
-- at the moment this migration runs - that's the real, current set the
-- business confirmed, not a hypothetical list written from here without
-- access to the live data. Canonical = the lowest template id per
-- colliding name (whichever synced first), picked for stability, not
-- because it's more "correct" than the other one.

create table if not exists style_merges (
  id bigint generated always as identity primary key,
  canonical_template_id integer not null,
  merged_template_id integer not null unique,
  note text,
  created_at timestamptz not null default now(),
  check (canonical_template_id <> merged_template_id)
);

comment on table style_merges is
  'Explicit "these two Odoo templates are the same product" mapping - never inferred automatically from a name match alone. merged_template_id rolls up into canonical_template_id everywhere a style is queried (fetchStyleVariants, fetchUpliftFactors, fetchForecastEvents, fetchLinkedLeadTimeProductId).';

alter table style_merges enable row level security;
-- Intentionally no policies: only the service role (server-side) can read/write, same as every other table here.

with distinct_templates as (
  select distinct odoo_template_id, name from products
),
collisions as (
  select name, min(odoo_template_id) as canonical_template_id
  from distinct_templates
  group by name
  having count(*) > 1
)
insert into style_merges (canonical_template_id, merged_template_id, note)
select
  c.canonical_template_id,
  d.odoo_template_id,
  'Auto-merged 2026-11-02: same name ("' || d.name || '") as template ' || c.canonical_template_id || ' - confirmed by the business to be the same product, duplicated by an Odoo company-profile change.'
from distinct_templates d
join collisions c on c.name = d.name
where d.odoo_template_id <> c.canonical_template_id
on conflict (merged_template_id) do nothing;
