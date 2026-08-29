-- Build order step 6: Creative Planner + Activation.
--
-- No real content-plan data is seeded here. The brief's "Project
-- Spearhead" Creative Plan deck (Google Slides, marked CONFIDENTIAL) is
-- still blocked on Drive access - a separately-uploaded PPTX turned out
-- to be a Metricool/GBP analytics export, not that deck, so there's
-- nothing real to seed the content calendar or activations with yet.
-- Built structurally so real entries can be added through the app once
-- that deck is readable, without fabricating placeholder posts.

create table if not exists content_calendar (
  id bigint generated always as identity primary key,
  post_date date,
  format text check (format in ('Video', 'Single Image', 'Carousel')),
  carousel_slide_count integer,
  pillar text,
  copy text,
  remarks text,
  asset_link text,
  reference_link text,
  production_status text not null default 'Concept'
    check (production_status in (
      'Concept', 'Shoot scheduled', 'Shot', 'In edit',
      'Awaiting delivery', 'Approved', 'Scheduled', 'Published'
    )),
  -- Filled in later once Metricool data exists (build order step 8) -
  -- the brief wants a published post's performance pulled back onto its
  -- card rather than tracked separately.
  metricool_performance jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_calendar_post_date_idx on content_calendar (post_date);
create index if not exists content_calendar_status_idx on content_calendar (production_status);

alter table content_calendar enable row level security;

create table if not exists activations (
  id bigint generated always as identity primary key,
  name text not null,
  type text,
  period_start date,
  period_end date,
  prize text,
  entry_mechanic text,
  -- Array of {label, done} - the brief's example checklist (e-flyer,
  -- e-invitation, PR package to 10 KOLs) is a default, not a fixed
  -- schema, since different activation types need different checklists.
  checklist jsonb not null default '[]',
  notes text,
  created_at timestamptz not null default now()
);

alter table activations enable row level security;
