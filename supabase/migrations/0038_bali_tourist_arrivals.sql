-- Real monthly foreign tourist arrivals to Bali, from the Bali
-- provincial tourism office's (Disparda) official monthly release -
-- "THE NUMBER OF FOREIGN TOURISTS ARRIVAL TO BALI BY MONTH", via Ngurah
-- Rai airport. Source: https://disparda.baliprov.go.id/rilis-data-statistik-bulan-september-2026
-- (file "2. DISTRIBUSI 2026", downloaded 2026-11-10 - Disparda republishes
-- this file every month as a fresh release, not a stable permalink, so a
-- later re-check needs that month's own release page).
--
-- This exists to answer one question: when in the year is Bali
-- genuinely busier or quieter with tourists, so marketing spend timing
-- (and activation/content planning) can be judged against something
-- real rather than guessed. See src/lib/tourism/seasonality.ts for how
-- this table turns into a per-calendar-month index, and the "Seasonality"
-- section on /marketing for where it's used.
--
-- Years included: 2019 (last full pre-COVID year), 2023-2025 (three full
-- recovered years), and 2026 January-September (the most recent real
-- data - October-December 2026 haven't happened/been published yet as
-- of this seed). 2020-2022 are deliberately NOT seeded - Bali's borders
-- were closed or arrivals were near-zero for most of that span (the
-- source's own file shows e.g. 51 total arrivals for all of 2021), which
-- is real but tells you nothing about a normal year's seasonal shape and
-- would badly distort any index computed across it. 2008-2018 are also
-- not seeded - included years already give four full comparable cycles,
-- which is enough to average without reaching back through a very
-- different tourism-volume era. None of this is a judgment call hidden
-- in code: it's why the table only has the years it has.

create table if not exists bali_tourist_arrivals (
  id bigint generated always as identity primary key,
  year integer not null,
  month integer not null check (month between 1 and 12),
  foreign_arrivals numeric not null,
  unique (year, month)
);

alter table bali_tourist_arrivals enable row level security;

insert into bali_tourist_arrivals (year, month, foreign_arrivals) values
  (2019, 1, 456218), (2019, 2, 437537), (2019, 3, 449637), (2019, 4, 476327),
  (2019, 5, 485795), (2019, 6, 549751), (2019, 7, 594279), (2019, 8, 616706),
  (2019, 9, 590565), (2019, 10, 568067), (2019, 11, 497925), (2019, 12, 552403),

  (2023, 1, 331785), (2023, 2, 323510), (2023, 3, 370695), (2023, 4, 411510),
  (2023, 5, 439475), (2023, 6, 478198), (2023, 7, 541353), (2023, 8, 522141),
  (2023, 9, 508350), (2023, 10, 461441), (2023, 11, 403154), (2023, 12, 481646),

  (2024, 1, 420037), (2024, 2, 455277), (2024, 3, 469227), (2024, 4, 503194),
  (2024, 5, 544601), (2024, 6, 520898), (2024, 7, 625665), (2024, 8, 616641),
  (2024, 9, 593909), (2024, 10, 559911), (2024, 11, 472900), (2024, 12, 551100),

  (2025, 1, 529897), (2025, 2, 450697), (2025, 3, 470851), (2025, 4, 591221),
  (2025, 5, 602213), (2025, 6, 637868), (2025, 7, 697107), (2025, 8, 682866),
  (2025, 9, 635149), (2025, 10, 594853), (2025, 11, 483364), (2025, 12, 572668),

  (2026, 1, 502205), (2026, 2, 492289), (2026, 3, 472070), (2026, 4, 553328),
  (2026, 5, 578251), (2026, 6, 605013), (2026, 7, 697809), (2026, 8, 685994),
  (2026, 9, 650169)
on conflict (year, month) do update set foreign_arrivals = excluded.foreign_arrivals;
