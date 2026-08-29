-- Build order step 5: Campaign Tracker + shared task model.
--
-- Design notes:
-- * campaigns.linked_ad_set_names drives the "auto-pull spend and results
--   from the Meta import" requirement: a campaign lists the ad set
--   name(s) it corresponds to, and the app sums ad_performance_snapshots
--   for ads whose ad_set_name matches, rather than manually re-entering
--   numbers that already exist from the Paid Media import.
-- * tasks uses a polymorphic link (link_type/link_id/link_label) instead
--   of a foreign key per linkable type, since the brief wants tasks
--   attachable to campaigns, creative assets, KOLs, and stores - a
--   growing list. link_label is a denormalized display string (e.g.
--   "Campaign: Ramadan Sale") since a polymorphic reference can't be
--   joined generically across different tables. owner_user_id is
--   optional - not everyone doing tasks necessarily has a login account
--   yet, so owner_name (free text) is the fallback.

create table if not exists campaigns (
  id bigint generated always as identity primary key,
  name text not null,
  objective text,
  channels text[] not null default '{}',
  status text not null default 'Brief'
    check (status in ('Brief', 'In production', 'Scheduled', 'Live', 'Ended', 'Reviewed')),
  start_date date,
  end_date date,
  budget_idr numeric,
  linked_ad_set_names text[] not null default '{}',
  post_mortem text,
  created_at timestamptz not null default now()
);

alter table campaigns enable row level security;

create table if not exists tasks (
  id bigint generated always as identity primary key,
  title text not null,
  description text,
  owner_user_id uuid references profiles (id),
  owner_name text,
  due_date date,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  link_type text,
  link_id bigint,
  link_label text,
  created_at timestamptz not null default now()
);

create index if not exists tasks_status_idx on tasks (status);
create index if not exists tasks_due_date_idx on tasks (due_date);
create index if not exists tasks_link_idx on tasks (link_type, link_id);

alter table tasks enable row level security;
