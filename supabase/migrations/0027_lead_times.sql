-- Product lead-time tracking: vendor-quoted estimates, an editable
-- override table, purchase order history (for measuring real lead
-- times), and the explicit name-mapping layer between however a product
-- is spelled on a PO/vendor sheet and Odoo's own product records.
--
-- Design notes:
-- * `lead_time_products` is the canonical product identity this whole
--   subsystem keys off - NOT Odoo's product_id, because vendor lead
--   times are quoted per *style* (e.g. "Linen Pants"), not per Odoo
--   variant/SKU. Colour/size variants of the same style share one row
--   here; that's a grain assumption (lead time doesn't vary by colour),
--   flagged here rather than silently baked into code with no record of
--   the choice.
-- * `lead_time_name_mappings` is the ONLY place a raw product-name
--   string (from a PO sheet or Odoo) becomes a `lead_time_products` row.
--   Nothing in this app ever splits a name on " - " to guess a colour vs.
--   a variant - "Linen Pants - Black" and "Origin Shirt - Long Sleeve"
--   use the same separator for two different things, so every raw name
--   is mapped explicitly, one row at a time, by a human or the importer
--   creating a 1:1 default mapping (never a merge) for a name it hasn't
--   seen before.
-- * `lead_times` is the editable table the brief asked for - product,
--   vendor (nullable), min/max days, source, note. `raw_text` keeps
--   whatever string was actually imported (e.g. "2-3 Months") for audit
--   against the normalized min/max.
-- * `lead_time_settings` is a single editable settings row (id = 1):
--   the late-end buffer applied to single-point estimates, the global
--   default range used when nothing else applies, the minimum PO count
--   before "measured" lead time activates for a product, and the two
--   assumptions the brief asked to be visible and editable rather than
--   baked in - clock start (PO date) and whether an estimate covers only
--   the first delivery/batch or the whole PO.
-- * `purchase_orders`/`purchase_order_lines` mirror the provided
--   po_lines_clean.csv shape closely (see migration 0028's seed) so
--   future re-imports of the same export format need no mapping work
--   beyond new product names. `manual_eta_date` on a PO is the business
--   overriding everything below it in the ETA priority order (see
--   src/lib/leadtime/resolve.ts).

create table if not exists lead_time_products (
  id bigint generated always as identity primary key,
  canonical_name text not null unique,
  is_garment boolean,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists lead_time_name_mappings (
  id bigint generated always as identity primary key,
  raw_name text not null unique,
  lead_time_product_id bigint references lead_time_products (id),
  odoo_template_id integer,
  -- true when an importer created this mapping automatically (1:1, same
  -- name as the product) rather than a human confirming it - surfaced in
  -- the UI so look-alike names (e.g. "Shadow - Long Sleeve" vs
  -- "Shadow Shirt") get a second look instead of quietly staying split.
  auto_created boolean not null default false,
  note text
);

create table if not exists lead_times (
  id bigint generated always as identity primary key,
  lead_time_product_id bigint not null references lead_time_products (id),
  vendor text,
  min_days integer not null check (min_days >= 0),
  max_days integer not null check (max_days >= min_days),
  source text not null check (source in ('vendor estimate', 'measured', 'manual')),
  raw_text text, -- the original string this was normalized from, if any
  note text,
  updated_at timestamptz not null default now()
);

create index if not exists lead_times_product_idx on lead_times (lead_time_product_id);

create table if not exists lead_time_settings (
  id integer primary key default 1 check (id = 1), -- singleton row
  late_end_buffer_pct numeric(5, 2) not null default 25,
  global_default_min_days integer not null default 42,
  global_default_max_days integer not null default 56,
  measured_min_po_count integer not null default 5,
  clock_start text not null default 'po_date' check (clock_start in ('po_date')),
  first_delivery_only boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into lead_time_settings (id) values (1) on conflict (id) do nothing;

comment on column lead_time_settings.late_end_buffer_pct is
  'Added to a single-point vendor estimate''s high end only (min_days = max_days in lead_times) when used for alerts - a range estimate is used as-is. Editable; see src/lib/leadtime/resolve.ts.';
comment on column lead_time_settings.clock_start is
  'Visible/editable per the brief - currently only "po_date" is implemented (lead time counts from the PO date). Not "confirmation date" or anything else yet.';
comment on column lead_time_settings.first_delivery_only is
  'If true, a lead-time estimate is assumed to cover only the first batch delivery (b1_date) of a PO, not the whole order. If false (default), it''s assumed to cover the whole PO (the last batch delivered). Affects how "measured" lead time is computed from purchase_order_lines.';

-- po_no/po_date are the only truly PO-level fields in the source export -
-- status and flags vary line-by-line within the same PO (e.g. one line
-- "finish", another "not finish yet" on the same po_no), so those live
-- on purchase_order_lines below, matching the source grain exactly
-- rather than collapsing them into one PO-level value that would hide
-- the disagreement.
create table if not exists purchase_orders (
  id bigint generated always as identity primary key,
  po_no text not null unique,
  po_date date not null,
  manual_eta_date date, -- highest-priority ETA override for this PO - see resolve.ts
  manual_eta_note text
);

create table if not exists purchase_order_lines (
  id bigint generated always as identity primary key,
  po_id bigint not null references purchase_orders (id) on delete cascade,
  style text not null, -- raw name exactly as given - mapped via lead_time_name_mappings, never parsed
  colorway text,
  size text,
  sku_key text,
  material text,
  fabric_meters_on_po numeric(12, 3),
  qty_ordered numeric(12, 3),
  unit_price_idr numeric(14, 2),
  b1_qty numeric(12, 3),
  b2_qty numeric(12, 3),
  b3_qty numeric(12, 3),
  qty_received_total numeric(12, 3),
  status text,
  is_garment boolean,
  has_receipt_columns boolean,
  b1_date date,
  b2_date date,
  b3_date date,
  lead_time_product_id bigint references lead_time_products (id), -- resolved at import time via lead_time_name_mappings
  flags text
);

create index if not exists purchase_order_lines_po_idx on purchase_order_lines (po_id);
create index if not exists purchase_order_lines_product_idx on purchase_order_lines (lead_time_product_id);

alter table lead_time_products enable row level security;
alter table lead_time_name_mappings enable row level security;
alter table lead_times enable row level security;
alter table lead_time_settings enable row level security;
alter table purchase_orders enable row level security;
alter table purchase_order_lines enable row level security;
-- Intentionally no policies: only the service role (server-side) can read/write, same as every other table here.
