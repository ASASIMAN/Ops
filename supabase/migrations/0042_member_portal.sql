-- Members portal (members.studioasasi.com): members sign in with a one-time
-- code sent to their email, then see their points, card and QR.
--
-- Codes are stored hashed, expire after 10 minutes and allow 5 tries. A row
-- is written for every request - whether or not the email belongs to a
-- member - so the request limits apply the same either way and the portal
-- never reveals who is a member.

create table if not exists member_login_codes (
  id bigint generated always as identity primary key,
  email text not null,
  code_hash text not null,
  ip text,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists member_login_codes_email_idx
  on member_login_codes (lower(email), created_at desc);
create index if not exists member_login_codes_ip_idx
  on member_login_codes (ip, created_at desc);

alter table member_login_codes enable row level security;

-- When the member last opened the portal (shown to staff on Members).
alter table members add column if not exists last_seen_at timestamptz;

-- Old codes are no use to anyone; keep the table small.
delete from member_login_codes where created_at < now() - interval '30 days';

-- Who an email belongs to, for portal sign-in: the app member with that
-- email, and/or every Odoo customer holding a loyalty card with it. Exact
-- match ignoring case and stray spaces (Odoo emails are typed by hand).
create or replace function portal_lookup(p_email text)
returns table (member_id uuid, odoo_partner_id integer, name text, phone text)
language sql
stable
set search_path = public
as $$
  select m.id, null::integer, null::text, null::text
  from members m
  where lower(btrim(m.email)) = lower(btrim(p_email))
  union all
  select null::uuid, c.odoo_partner_id, c.name, c.phone
  from odoo_customers c
  where lower(btrim(c.email)) = lower(btrim(p_email))
    and exists (select 1 from loyalty_cards lc where lc.odoo_partner_id = c.odoo_partner_id);
$$;

-- Uses up one try of a sign-in code, in one statement, before the code is
-- compared - so guesses sent at the same moment can't all slip past the
-- 5-try limit. True if a try was left (the code is live and unused).
create or replace function portal_take_attempt(p_id bigint, p_max integer)
returns boolean
language sql
volatile
set search_path = public
as $$
  update member_login_codes
     set attempts = attempts + 1
   where id = p_id and attempts < p_max and used_at is null and expires_at > now()
  returning true;
$$;

notify pgrst, 'reload schema';
