## ASASI Internal Ecosystem

Next.js (App Router) + TypeScript + Tailwind CSS + Supabase. One deployed
app, gated by login, with a hub that routes into separate workspaces:
**Operations** (live — the Odoo POS sales dashboard) and **Marketing**
(in progress — the Marketing Command Centre).

### Local development

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev
```

Auth requires reaching your real Supabase project even locally (no local
auth emulator), so `SUPABASE_SERVICE_ROLE_KEY` and the Supabase URL/anon
key need to be real values for local dev to fully work.

### Environment variables

Set these in `.env.local` for local dev, and in the Vercel project settings for
deployed environments.

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API → `anon`/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API → `service_role`/secret key. **Server-only, never expose to the browser.** Used wherever RLS needs bypassing (sales sync, admin account creation). |
| `ODOO_URL` | Your Odoo instance URL, e.g. `https://yourcompany.odoo.com` |
| `ODOO_DB` | Your Odoo database name |
| `ODOO_USERNAME` | A user with read access to POS/product data — ideally a dedicated read-only user |
| `ODOO_API_KEY` | Generate under that user's profile → Account Security → New API Key |
| `CRON_SECRET` | Any random string. Authorizes calls to `/api/sync/odoo` — Vercel sends this automatically on its own scheduled cron requests once the var is set. |
| `SETUP_SECRET` | Any random string. Gates the one-time `/setup` page that creates the first admin login. |

### Deploying (Vercel)

1. On [vercel.com](https://vercel.com), **Add New → Project**, import this
   GitHub repo (`asasiman/ops`).
2. Framework preset is auto-detected as Next.js — no build config needed.
3. Add the two environment variables above under **Environment Variables**
   before the first deploy (or add them after and redeploy).
4. Deploy. Every push to `main` redeploys production automatically; every
   other branch/PR gets its own preview URL.

### Supabase

1. Create a project at [supabase.com](https://supabase.com) (or use an
   existing one).
2. Copy the Project URL and anon key into the env vars above.
3. Add tables/policies as features are built — the client helpers already
   exist:
   - `src/lib/supabase/client.ts` — browser client (Client Components)
   - `src/lib/supabase/server.ts` — server client (Server Components,
     Route Handlers)

### Project structure

```
src/app/                routes (App Router)
src/app/login/          sign in
src/app/setup/          one-time admin account creation
src/app/change-password/forced password change on first login
src/app/hub/             post-login landing - two tiles, config-driven
src/app/operations/     Sales Dashboard (Odoo POS data) - the "Operations" tile
src/app/marketing/      Marketing Command Centre - the "Marketing" tile (stub for now)
src/app/api/sync/       Odoo -> Supabase sync job
src/components/shell/   shared chrome (header, sign-out) used by every gated route
src/lib/supabase/       Supabase client helpers (browser, server, admin/service-role)
src/lib/odoo/           Odoo external API client
src/middleware.ts       session refresh + auth gate + forced-password-change redirect
config/modules.json     hub tile definitions (add a tile here, not by editing the hub)
supabase/migrations/    hand-run SQL migrations (see below)
```

### First-time setup (auth)

1. Run all three SQL migrations in order (Supabase dashboard → SQL Editor):
   `0001_sales_schema.sql`, `0002_hub_and_marketing_foundation.sql`,
   `0003_seed_marketing_foundation.sql`.
2. Set `SETUP_SECRET` in Vercel, redeploy.
3. Visit `/setup`, enter the setup key + your email + a password. This
   creates the first (and only, via this page) admin account.
4. Sign in at `/login`. You'll land on `/hub`.

New team members: an admin creates their `auth.users` row + a `profiles`
row (role + `must_change_password = true`) directly in Supabase for now —
there's no in-app "invite a teammate" flow yet.

### The hub

`/hub` reads `config/modules.json` and renders one tile per module the
signed-in user's role can see. Roles: `admin` (sees everything), `ops`,
`marketing`, `viewer`. To add a third tile later (Retail Ops, Inventory,
etc.), add an entry to `modules.json` — the hub itself doesn't need
changes.

## Sales Dashboard (Odoo POS)

### Status: Phase 1 - data pipeline + basic filtered table

**Architecture decision: sync, not live-query.** A scheduled job pulls data
from Odoo into Supabase; the dashboard reads from Supabase, not Odoo
directly. This was chosen over live-querying Odoo on every filter change
because Odoo's API isn't built for interactive filtering (XML/JSON-RPC,
not indexed for arbitrary `WHERE` clauses at speed), and because syncing
into Supabase gives us historical snapshots to build forecasting on later.
Tradeoff: data is as fresh as the last sync (daily by default), not
real-time to the second.

**Odoo API findings (needs your instance to confirm — see below).** Based
on Odoo's documented external API (not yet tested against your live
instance, since I don't have connection details):
- Auth is `db` + `username` + API key over JSON-RPC (`/jsonrpc`) — no
  OAuth needed.
- Line-item detail (`pos.order.line`) is available, gated by normal Odoo
  access rights for whichever user's API key is used.
- **Color and size aren't flat fields** — Odoo models them as product
  variant attributes. The client resolves them by matching attribute
  names "Color"/"Size" (case-insensitive) — if your instance names these
  attributes differently, that match needs adjusting in
  `src/lib/odoo/sales.ts`.
- **Store** is inferred as `pos.order → pos.session → pos.config`, i.e.
  one `pos.config` per physical store. If your four stores aren't set up
  as four separate POS configs, this mapping needs rethinking.
- None of this is confirmed against your real data yet — it's built from
  Odoo's documented schema. **This is the main open item**: once you can
  hand over `ODOO_URL` / `ODOO_DB` / `ODOO_USERNAME` / `ODOO_API_KEY`
  (ideally a dedicated read-only user), the next step is a real test sync
  and fixing whatever doesn't match your instance.

**What's built:**
- `supabase/migrations/0001_sales_schema.sql` — tables for stores,
  categories, products (with resolved color/size), orders, order lines,
  plus a `sync_runs` log table. RLS is on with zero public policies —
  only the service-role key can touch this data, so sales figures are
  never reachable through the publicly-exposed anon key.
- `src/lib/odoo/` — JSON-RPC client + typed fetchers for stores,
  categories, products/variants, orders, order lines.
- `POST /api/sync/odoo` (also accepts `GET`, since Vercel Cron calls via
  GET) — pulls from Odoo and upserts into Supabase. Protected by
  `CRON_SECRET`. `?days=N` controls the sync window (default 2).
- `vercel.json` — a daily cron (6am UTC) calling the sync endpoint. This
  is deliberately conservative: Vercel's free Hobby tier limits cron
  frequency, so for more-than-daily syncing you'd either need a paid plan
  or an external scheduler (e.g. a scheduled GitHub Action hitting the
  endpoint) — not set up yet, flag if you want tighter freshness sooner.
- `/operations` — filters (date range, store multi-select, category,
  color, size) as a plain HTML GET form (filter state lives in the URL,
  no client JS needed), a revenue/units/line-count summary, and a table
  of matching order lines. Capped at 1000 rows for now — no pagination
  yet.

**What's not built yet (next phases):**
- Charts / trend visualization
- Best/worst seller and sell-through views
- Forecasting formulas on top of the trend data
- Pagination past 1000 rows
- A historical backfill strategy beyond the rolling daily sync (needs to
  run in date-chunked batches to stay under the 60s function limit - not
  built yet, will design once we know your order volume)

### Running the SQL migrations

Supabase migrations here are plain `.sql` files, run manually for now (no
CLI/CI wiring yet): open the Supabase dashboard → SQL Editor → paste each
file's contents in order → run.

### Triggering a sync manually

Easiest: click **"Sync now"** on the `/operations` page itself - it runs
the sync directly (a Server Action, not an HTTP call), so `CRON_SECRET`
never has to leave the server, and the page shows the result (success +
order count, or the specific error) right above the filters.

Or, from the command line:

```bash
curl -X POST "https://<your-deployment>/api/sync/odoo?days=7" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

## Marketing Command Centre

### Status: Build order step 1 - hub, auth, shared shell, foundation schema

This is the first step of a much larger, multi-phase build (see the full
brief for the complete spec - Paid Media, Organic Social, Web & Ecom,
Retail & Local, Financials, Campaign Tracker, Creative Planner, KOL CRM,
To-Dos, and an insights engine are not built yet). What's here now is the
scaffolding everything else plugs into.

**Architecture decision: one app, not two.** The brief as written called
for a locally-run SQLite app, but also wanted a shared hub with the
already-deployed Ops sales dashboard - those don't fit together (SQLite on
one laptop can't be "the team's shared tool"). Went with extending this
app instead: same Vercel + Supabase (Postgres) + GitHub pipeline, one
login, `/hub` → `/operations` (existing sales dashboard) or `/marketing`
(new). Confidential creative/KOL data stays private via auth + Supabase
RLS rather than via "never leaves a laptop" - cloud-hosted isn't the same
as public.

**Blocked on:** Google Drive access still needs re-authorizing before I
can read the live Financials/KOL Google Sheets directly (tier
definitions, prospect lists, the full multi-tab KOL sheet). That said,
real CSV exports for both were provided directly and are now seeded (see
`0004`/`0005` below) - so historical P&L and the KOL booking log are real
data now, not placeholders.

**What's built:**
- `supabase/migrations/0002_hub_and_marketing_foundation.sql` —
  `profiles` (role + forced-password-change flag), `facts_daily` (the
  generic cross-source metric table the brief specifies - new data
  sources plug in as rows, no migration needed), `assumptions`
  (editable business constants), `app_settings` (taxonomy: pillars,
  statuses, attribution sources), and extends the existing `stores` table
  with `address`/`slug`/`is_preopening` rather than creating a duplicate
  - it's the same four physical locations either way.
- `supabase/migrations/0003_seed_marketing_foundation.sql` — seeds only
  what's explicitly given in the brief: the four store addresses (matched
  onto whatever Odoo already synced, by partial name match - check this
  landed correctly), the NSA pre-opening store, the LTV multiplier
  (1.4433) and budget figures, and the taxonomy lists (attribution
  sources, content pillars, KOL/campaign statuses).
- Auth: Supabase Auth, email + password, sessions via HTTP-only cookie
  (`src/middleware.ts` refreshes the session and gates every route except
  `/login` and `/setup`). Roles (`admin`/`marketing`/`ops`/`viewer`) live
  on `profiles` and gate which hub tiles are visible.
- `/setup` — one-time page (gated by `SETUP_SECRET`) that creates the
  first admin account, since I can't reach your Supabase project from
  here to run a seed script directly. Refuses to run again once an admin
  exists.
- `/change-password` — forced on any account with
  `must_change_password = true`.
- `/hub` — config-driven tiles from `config/modules.json`, filtered by
  role, with live headline stats where the module has data (Operations
  shows synced line count + last sync status; Marketing shows "Coming
  soon" since nothing's built there yet).
- `/marketing` — placeholder page, reserved route.
- `supabase/migrations/0004_seed_financials_history.sql` — the real
  monthly P&L, Dec '24 through Jul '26, into `facts_daily`. Missing
  months/metrics in the source ("—" or blank) are skipped, not stored as
  0. The source's "WA Messages" column mixed `IG143`/`WA 56` style
  values, so it's split into `messages_ig_count` / `messages_wa_count`
  rather than merged - the channel prefix looked meaningful, not a typo.
- `supabase/migrations/0005_kols.sql` — a `kols` table (booking-log only,
  ahead of the full KOL CRM in build order step 7) seeded with the real
  booking log. `opportunity_cost_raw` is kept verbatim ("500k Voucher",
  "1.5jt") rather than parsed into a number - converting Indonesian
  shorthand and deciding how in-kind product value compares to cash spend
  is a real metric definition, flagged rather than guessed. Every row's
  `scheduled_month` assumes 2026 (the source file had no year column;
  inferred from the filename) - flag any row that's actually a different
  year.

**Known open items:**
- The four real stores in Supabase get their address/slug attached by
  matching on `name ilike '%canggu%'` etc. against whatever Odoo actually
  named those `pos.config` records - I don't know the exact names from
  here. Check `select id, name, slug from stores;` after running the seed
  migration; if a store didn't match, update it manually.
- Whether to parse `opportunity_cost_raw` into a numeric
  `opportunity_cost_idr` (and how to treat vouchers/in-kind product vs.
  cash) - needed before KOL cost can roll up into Financials automatically.
- A handful of KOL rows look like month-level notes or open slots rather
  than individual bookings (e.g. a row named "Feb" with no handle) -
  imported as-is rather than dropped; worth a pass once you're looking at
  the data.

**Status:** all 10 build-order steps from the original brief are done -
Overview, Paid Media, Financials, Campaign Tracker, Tasks, Creative
Planner, KOL CRM, Organic Social, Insights, and Settings. Real gaps that
remain are flagged in-app wherever they matter, not hidden: Google Drive
access (Creative Plan deck, KOL tier definitions, Unit Economics tab),
Shopify, GA4, Search Console, and per-store Google Business Profile data
all need real credentials/exports that haven't been provided yet.

## How to update this each month

1. **Odoo sales** sync automatically (daily cron) - no action needed
   unless `/operations` shows a failed sync, in which case click **Sync
   now** there.
2. **Meta Ads**: export the ads report from Ads Manager as a CSV, go to
   **Marketing → Data Import**, upload it. Safe to re-upload the same or
   an overlapping period - it updates rather than duplicates.
3. **Financials**: once the monthly numbers are final, add them as a new
   row - for now that means a SQL insert into `facts_daily` (ask me and
   I'll generate it from whatever numbers you give me, same as the
   historical seed). A proper manual-entry form is a reasonable next
   addition once this monthly rhythm is established.
4. **KOL bookings, campaigns, creative posts, tasks**: add/update these
   directly in the app as things happen through the month - no batch
   step needed, they're live the moment they're entered.
5. **Assumptions and taxonomy** (LTV multiplier, budget figures, status
   lists): edit directly on **Financials** (assumptions) or
   **Marketing → Settings** (stores, taxonomy) - no code or SQL needed.
