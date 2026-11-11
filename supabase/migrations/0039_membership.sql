-- ASASI Membership: public sign-up (via the QR tent card), a wallet pass per
-- member, partner-venue discounts and a points ledger.
--
-- All access goes through the service-role client in server code (join page,
-- member card, staff tools). RLS is enabled with no policies on purpose, so
-- the anon key can never read member data.

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  -- Short human-friendly code encoded in the pass QR (/v/<code>). Safe to
  -- show to partner venues - it only reveals first name + validity.
  code text not null unique,
  -- Unguessable secret for the member's own card page (/member/<token>) and
  -- wallet downloads. Never encoded in the QR.
  access_token uuid not null unique default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  marketing_opt_in boolean not null default false,
  status text not null default 'active' check (status in ('active', 'suspended')),
  points_balance integer not null default 0 check (points_balance >= 0),
  lifetime_points integer not null default 0,
  signup_source text,
  created_at timestamptz not null default now()
);

create unique index if not exists members_email_lower_idx on members (lower(email));

alter table members enable row level security;

create table if not exists partner_venues (
  id bigint generated always as identity primary key,
  name text not null,
  -- What members get, as shown on the card, e.g. "10% off the bill".
  discount_text text not null,
  notes text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table partner_venues enable row level security;

create table if not exists member_transactions (
  id bigint generated always as identity primary key,
  member_id uuid not null references members (id) on delete cascade,
  kind text not null check (kind in ('earn', 'redeem', 'adjust')),
  -- Signed: positive for earn, negative for redeem, either for adjust.
  points integer not null,
  amount_idr numeric,
  location text,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists member_transactions_member_idx
  on member_transactions (member_id, created_at desc);

alter table member_transactions enable row level security;

-- Ledger insert + balance update in one transaction; refuses to overdraw.
create or replace function member_apply_points(
  p_member uuid,
  p_kind text,
  p_points integer,
  p_amount_idr numeric,
  p_location text,
  p_note text,
  p_created_by text
) returns integer
language plpgsql
as $$
declare
  new_balance integer;
begin
  update members
  set points_balance = points_balance + p_points,
      lifetime_points = lifetime_points + greatest(p_points, 0)
  where id = p_member
  returning points_balance into new_balance;

  if new_balance is null then
    raise exception 'member not found';
  end if;

  insert into member_transactions
    (member_id, kind, points, amount_idr, location, note, created_by)
  values
    (p_member, p_kind, p_points, p_amount_idr, p_location, p_note, p_created_by);

  return new_balance;
end;
$$;

-- Spend per point earned (IDR). Editable under assumptions.
insert into assumptions (key, value, label) values
  ('membership_idr_per_point', 10000, 'Membership: IDR spent per point earned')
on conflict (key) do nothing;
