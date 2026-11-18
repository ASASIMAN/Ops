-- Members portal, simplified: members type their email and see their card,
-- QR and points straight away - no emailed sign-in code. (Points can't be
-- spent online, so there's nothing a code would protect.)
--
-- Replaces the sign-in codes from 0042 with a per-network lookup limit, so
-- the page can't be used to read through a list of emails. Only the network
-- address and the time are kept - not the email typed.

drop function if exists portal_take_attempt(bigint, integer);
drop table if exists member_login_codes;

create table if not exists member_lookups (
  id bigint generated always as identity primary key,
  ip text,
  found boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists member_lookups_ip_idx on member_lookups (ip, created_at desc);
create index if not exists member_lookups_created_idx on member_lookups (created_at);

alter table member_lookups enable row level security;

notify pgrst, 'reload schema';
