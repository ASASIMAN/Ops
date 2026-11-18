-- Marketing budget planner (/planning/budget): extra marketing money to
-- shift large or old piles of the core items (Affine, Kavash, Linen
-- Pants, Origin), and when in the year to ask for it.
--
-- Marketing (or admin) proposes a "push" - extra spend on one item in one
-- month - ops confirms the stock is there, and the CEO approves or
-- rejects. Every step is kept in marketing_push_events so each department
-- sees who did what and why.

-- Each variant's cost price (Odoo product.product.standard_price), filled
-- by the stock sync. Null = Odoo has no cost for it; nothing is guessed.
alter table products add column if not exists cost_price numeric(14, 2);

-- How long stock has been sitting: Odoo's stock.quant "in_date" (when the
-- stock arrived at that location), summed per product, location and
-- arrival day. Replaced on every stock sync, like stock_levels.
create table if not exists stock_lot_ages (
  product_id bigint not null references products (id) on delete cascade,
  location_id bigint not null references stock_locations (id) on delete cascade,
  received_on date not null,
  qty numeric(14, 3) not null,
  synced_at timestamptz not null default now(),
  primary key (product_id, location_id, received_on)
);
alter table stock_lot_ages enable row level security;

-- Who approves pushes (the CEO). Ticked by an admin on the planner page.
alter table profiles add column if not exists can_approve_budget boolean not null default false;

create table if not exists marketing_pushes (
  id bigint generated always as identity primary key,
  -- One of the planner's core items (src/lib/budget/items.ts).
  item_key text not null,
  -- The month the extra money is spent in (first of the month).
  month date not null check (extract(day from month) = 1),
  amount_idr numeric(14, 0) not null check (amount_idr > 0),
  -- The proposer's expectation: units of this item per Instagram-driven
  -- store sale. Null = the item's normal share of store sales.
  units_per_ig_sale numeric(8, 4) check (units_per_ig_sale is null or units_per_ig_sale > 0),
  reason text,
  status text not null default 'proposed'
    check (status in ('proposed', 'confirmed', 'approved', 'rejected', 'withdrawn')),
  proposed_by text not null,
  proposed_at timestamptz not null default now(),
  confirmed_by text,
  confirmed_at timestamptz,
  decided_by text,
  decided_at timestamptz,
  -- What the model predicted when it was proposed, kept so the result can
  -- be compared against what actually sold once the month is over.
  predicted_units numeric(12, 1),
  predicted_revenue_idr numeric(14, 0),
  predicted_profit_idr numeric(14, 0),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_pushes_month_idx on marketing_pushes (month);
alter table marketing_pushes enable row level security;

create table if not exists marketing_push_events (
  id bigint generated always as identity primary key,
  push_id bigint not null references marketing_pushes (id) on delete cascade,
  actor text not null,
  actor_role text,
  action text not null
    check (action in ('proposed', 'edited', 'confirmed', 'approved', 'rejected', 'withdrawn', 'commented')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists marketing_push_events_push_idx on marketing_push_events (push_id, created_at);
alter table marketing_push_events enable row level security;

-- Bulk-sets cost prices from the stock sync: [{"id": <odoo product id>, "cost": <number|null>}].
-- Returns how many products changed.
create or replace function set_product_costs(p_costs jsonb)
returns integer
language sql
volatile
set search_path = public
as $$
  with input as (
    select (x ->> 'id')::integer as odoo_product_id, (x ->> 'cost')::numeric as cost
    from jsonb_array_elements(p_costs) x
  ),
  updated as (
    update products p
       set cost_price = i.cost
      from input i
     where p.odoo_product_id = i.odoo_product_id
       and p.cost_price is distinct from i.cost
    returning 1
  )
  select count(*)::integer from updated;
$$;

notify pgrst, 'reload schema';
