-- Odoo POS loyalty -> the app's Members section.
--
-- Points are earned and redeemed at the till by Odoo's loyalty programme,
-- so Odoo is the record of every customer's balance. This migration adds a
-- read-only mirror of it (programmes, customers, loyalty cards), filled by
-- the loyalty sync in src/lib/odoo/sync.ts, and links it to the app's own
-- QR sign-ups (members) so one person is one row with one balance.
--
-- Nothing here writes to Odoo, and members.points_balance keeps its
-- existing meaning - points added in the app by staff. For a member linked
-- to Odoo the app shows Odoo's balance plus any in-app points, and stops
-- staff adding new points in the app (the till already does), so a sale is
-- never counted twice.
--
-- Same access posture as the rest of the schema: RLS on, no policies,
-- service-role only.

create table if not exists loyalty_programs (
  odoo_program_id integer primary key,
  name text not null,
  -- What Odoo calls its points ("Points", "Stars", ...).
  point_name text,
  synced_at timestamptz not null default now()
);

alter table loyalty_programs enable row level security;

-- Odoo customers (res.partner) the app has reason to know about: everyone
-- holding a loyalty card, plus everyone attached to a synced POS order.
create table if not exists odoo_customers (
  odoo_partner_id integer primary key,
  name text not null,
  email text,
  phone text,
  synced_at timestamptz not null default now()
);

create index if not exists odoo_customers_email_idx on odoo_customers (lower(email));

alter table odoo_customers enable row level security;

create table if not exists loyalty_cards (
  odoo_card_id integer primary key,
  odoo_partner_id integer not null references odoo_customers (odoo_partner_id) on delete cascade,
  odoo_program_id integer references loyalty_programs (odoo_program_id) on delete set null,
  code text,
  -- Odoo stores points as a decimal; kept exactly as Odoo reports it.
  points numeric(14, 2) not null default 0,
  expiration_date date,
  synced_at timestamptz not null default now()
);

create index if not exists loyalty_cards_partner_idx on loyalty_cards (odoo_partner_id);

alter table loyalty_cards enable row level security;

-- An app member's Odoo customer, once matched. One Odoo customer can be
-- linked to at most one app member.
alter table members add column if not exists odoo_partner_id integer;
create unique index if not exists members_odoo_partner_idx
  on members (odoo_partner_id) where odoo_partner_id is not null;

-- The customer attached to each POS order (null = no customer was added at
-- the till). Filled by the sales sync from now on, and back-filled for
-- older orders by the loyalty sync.
alter table orders add column if not exists odoo_partner_id integer;
create index if not exists orders_odoo_partner_idx
  on orders (odoo_partner_id) where odoo_partner_id is not null;

alter table sync_runs drop constraint if exists sync_runs_sync_type_check;
alter table sync_runs add constraint sync_runs_sync_type_check
  check (sync_type in ('sales', 'stock', 'loyalty'));

-- Phone numbers are typed every which way ("0812-...", "+62 812 ...",
-- "62812..."). Reduce to digits with the Indonesian country code so the
-- same number compares equal. Anything shorter than 8 digits isn't a
-- usable phone number and never matches.
create or replace function membership_phone_key(p text)
returns text
language sql
immutable
as $$
  select case
    when length(d) < 8 then null
    when d like '0%' then '62' || substr(d, 2)
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- Sets odoo_partner_id on POS orders from a JSON array of
-- {"o": odoo_order_id, "p": odoo_partner_id}. Used by the loyalty sync to
-- back-fill orders synced before the column existed. Returns rows changed.
create or replace function set_order_partners(p_pairs jsonb)
returns integer
language sql
as $$
  with pairs as (
    select (x->>'o')::integer as odoo_order_id, (x->>'p')::integer as partner_id
    from jsonb_array_elements(p_pairs) x
  ),
  updated as (
    update orders o
    set odoo_partner_id = pairs.partner_id
    from pairs
    where o.odoo_order_id = pairs.odoo_order_id
      and o.odoo_partner_id is distinct from pairs.partner_id
    returning 1
  )
  select count(*)::integer from updated;
$$;

-- Every Odoo customer attached to at least one synced POS order.
create or replace function order_customer_ids()
returns table (odoo_partner_id integer)
language sql
stable
as $$
  select distinct o.odoo_partner_id from orders o where o.odoo_partner_id is not null;
$$;

-- Links app members to their Odoo customer by email, then by phone. Only
-- an unambiguous match links: exactly one Odoo customer has that email (or
-- phone), and no other app member matches the same customer. Existing
-- links are never changed. Returns how many members were linked.
create or replace function link_members_to_odoo()
returns integer
language plpgsql
as $$
declare
  linked integer := 0;
  n integer;
begin
  with candidates as (
    select m.id as member_id, c.odoo_partner_id
    from members m
    join odoo_customers c
      on c.email is not null and lower(btrim(c.email)) = lower(btrim(m.email))
    where m.odoo_partner_id is null
      and not exists (select 1 from members x where x.odoo_partner_id = c.odoo_partner_id)
  ),
  unique_matches as (
    select member_id, min(odoo_partner_id) as odoo_partner_id
    from candidates
    group by member_id
    having count(distinct odoo_partner_id) = 1
  ),
  unclaimed as (
    select u.*
    from unique_matches u
    where (select count(*) from unique_matches u2 where u2.odoo_partner_id = u.odoo_partner_id) = 1
  )
  update members m set odoo_partner_id = u.odoo_partner_id
  from unclaimed u where m.id = u.member_id;
  get diagnostics n = row_count;
  linked := linked + n;

  with candidates as (
    select m.id as member_id, c.odoo_partner_id
    from members m
    join odoo_customers c
      on membership_phone_key(c.phone) is not null
     and membership_phone_key(c.phone) = membership_phone_key(m.phone)
    where m.odoo_partner_id is null
      and not exists (select 1 from members x where x.odoo_partner_id = c.odoo_partner_id)
  ),
  unique_matches as (
    select member_id, min(odoo_partner_id) as odoo_partner_id
    from candidates
    group by member_id
    having count(distinct odoo_partner_id) = 1
  ),
  unclaimed as (
    select u.*
    from unique_matches u
    where (select count(*) from unique_matches u2 where u2.odoo_partner_id = u.odoo_partner_id) = 1
  )
  update members m set odoo_partner_id = u.odoo_partner_id
  from unclaimed u where m.id = u.member_id;
  get diagnostics n = row_count;
  linked := linked + n;

  return linked;
end;
$$;

-- One row per person for the Members section: every Odoo customer holding
-- a loyalty card (whether or not they signed up in the app) and every app
-- sign-up (whether or not they're in Odoo), merged where linked. Spend and
-- visits come from synced POS orders that had the customer attached, on the
-- same ex-tax, net-of-discount basis as every other sales figure.
--   p_view: all | linked | odoo_only (in Odoo, not signed up in the app)
--           | app_only (signed up in the app, not found in Odoo)
--   p_sort: points | name | spend | recent
create or replace function membership_directory(
  p_search text default null,
  p_view text default 'all',
  p_sort text default 'points',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  odoo_partner_id integer,
  member_id uuid,
  member_code text,
  member_status text,
  name text,
  email text,
  phone text,
  odoo_points numeric,
  app_points integer,
  programs text,
  joined_app_at timestamptz,
  order_count bigint,
  spend numeric,
  last_order_at timestamptz,
  total_rows bigint
)
language sql
stable
set search_path = public
as $$
  with card_totals as (
    select lc.odoo_partner_id, sum(lc.points) as points,
           string_agg(distinct lp.name, ', ') as programs
    from loyalty_cards lc
    left join loyalty_programs lp on lp.odoo_program_id = lc.odoo_program_id
    group by lc.odoo_partner_id
  ),
  people as (
    -- Odoo loyalty customers, with their app sign-up if linked.
    select c.odoo_partner_id, m.id as member_id, m.code as member_code, m.status as member_status,
           coalesce(c.name, m.full_name) as name, coalesce(c.email, m.email) as email,
           coalesce(c.phone, m.phone) as phone,
           ct.points as odoo_points, m.points_balance as app_points, ct.programs,
           m.created_at as joined_app_at
    from card_totals ct
    join odoo_customers c on c.odoo_partner_id = ct.odoo_partner_id
    left join members m on m.odoo_partner_id = c.odoo_partner_id
    union all
    -- App sign-ups that aren't an Odoo loyalty customer (unlinked, or linked
    -- to an Odoo customer who holds no loyalty card).
    select m.odoo_partner_id, m.id, m.code, m.status, m.full_name, m.email, m.phone,
           null::numeric, m.points_balance, null::text, m.created_at
    from members m
    where m.odoo_partner_id is null
       or not exists (select 1 from card_totals ct where ct.odoo_partner_id = m.odoo_partner_id)
  ),
  filtered as (
    select p.*
    from people p
    where (
        p_search is null or btrim(p_search) = ''
        or p.name ilike '%' || btrim(p_search) || '%'
        or p.email ilike '%' || btrim(p_search) || '%'
        or p.phone ilike '%' || btrim(p_search) || '%'
        or p.member_code ilike '%' || btrim(p_search) || '%'
      )
      and case coalesce(p_view, 'all')
        when 'linked' then p.member_id is not null and p.odoo_partner_id is not null
        when 'odoo_only' then p.member_id is null
        when 'app_only' then p.odoo_partner_id is null
        else true
      end
  ),
  spend as (
    select o.odoo_partner_id, count(distinct o.id) as order_count,
           coalesce(sum(l.subtotal), 0) as spend, max(o.order_date) as last_order_at
    from orders o
    join order_lines l on l.order_id = o.id
    where o.odoo_partner_id in (select f.odoo_partner_id from filtered f where f.odoo_partner_id is not null)
    group by o.odoo_partner_id
  )
  select f.odoo_partner_id, f.member_id, f.member_code, f.member_status, f.name, f.email, f.phone,
         f.odoo_points, f.app_points, f.programs, f.joined_app_at,
         coalesce(s.order_count, 0)::bigint, coalesce(s.spend, 0)::numeric, s.last_order_at,
         count(*) over ()::bigint
  from filtered f
  left join spend s on s.odoo_partner_id = f.odoo_partner_id
  order by
    case when p_sort = 'name' then lower(f.name) end asc,
    case when p_sort = 'spend' then coalesce(s.spend, 0) end desc,
    case when p_sort = 'recent' then s.last_order_at end desc nulls last,
    coalesce(f.odoo_points, 0) + coalesce(f.app_points, 0) desc,
    lower(f.name), f.odoo_partner_id, f.member_id
  limit greatest(least(coalesce(p_limit, 50), 500), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function membership_summary()
returns table (
  odoo_customers bigint,
  odoo_points numeric,
  app_members bigint,
  linked_members bigint,
  app_only_points bigint,
  customers_with_orders bigint
)
language sql
stable
set search_path = public
as $$
  select
    (select count(distinct odoo_partner_id) from loyalty_cards),
    (select coalesce(sum(points), 0) from loyalty_cards),
    (select count(*) from members),
    (select count(*) from members where odoo_partner_id is not null),
    (select coalesce(sum(points_balance), 0) from members),
    (select count(distinct odoo_partner_id) from orders where odoo_partner_id is not null);
$$;

-- New vs returning customers over a window, from POS orders that had a
-- customer attached at the till. "Returning" = the customer has an earlier
-- attached order before p_from. Orders without a customer can't be told
-- apart, so the coverage (attached orders / all orders) is returned too and
-- every screen shows it next to the figures.
create or replace function biz_customer_mix(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  customers bigint,
  returning_customers bigint,
  new_customers bigint,
  repeat_customers bigint,
  orders_with_customer bigint,
  orders_total bigint
)
language sql
stable
set search_path = public
as $$
  with window_orders as (
    select o.id, o.odoo_partner_id
    from orders o
    where o.order_date >= p_from and o.order_date < p_to
  ),
  per_customer as (
    select w.odoo_partner_id, count(*) as orders_in_window,
           exists (
             select 1 from orders e
             where e.odoo_partner_id = w.odoo_partner_id and e.order_date < p_from
           ) as had_earlier
    from window_orders w
    where w.odoo_partner_id is not null
    group by w.odoo_partner_id
  )
  select
    (select count(*) from per_customer),
    (select count(*) from per_customer where had_earlier),
    (select count(*) from per_customer where not had_earlier),
    (select count(*) from per_customer where orders_in_window > 1 or had_earlier),
    (select count(*) from window_orders where odoo_partner_id is not null),
    (select count(*) from window_orders);
$$;

notify pgrst, 'reload schema';
