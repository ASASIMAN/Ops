## Ops

Internal operations app. Next.js (App Router) + TypeScript + Tailwind CSS + Supabase.

### Local development

```bash
npm install
cp .env.example .env.local   # fill in the two Supabase values below
npm run dev
```

### Environment variables

Set these in `.env.local` for local dev, and in the Vercel project settings for
deployed environments.

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API → `service_role` key. **Server-only, never expose to the browser.** Used by the sales dashboard and the Odoo sync job, since sales data has no public read policy. |
| `ODOO_URL` | Your Odoo instance URL, e.g. `https://yourcompany.odoo.com` |
| `ODOO_DB` | Your Odoo database name |
| `ODOO_USERNAME` | A user with read access to POS/product data — ideally a dedicated read-only user |
| `ODOO_API_KEY` | Generate under that user's profile → Account Security → New API Key |
| `CRON_SECRET` | Any random string. Authorizes calls to `/api/sync/odoo` — Vercel sends this automatically on its own scheduled cron requests once the var is set. |

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

The homepage (`src/app/page.tsx`) shows a live Supabase connection status
card so you can confirm the wiring works end to end once the env vars are
set.

### Project structure

```
src/app/            routes (App Router)
src/app/dashboard/  Sales Dashboard (Odoo POS data)
src/app/api/sync/   Odoo -> Supabase sync job
src/components/     shared UI components
src/lib/supabase/   Supabase client helpers (browser, server, admin/service-role)
src/lib/odoo/       Odoo external API client
supabase/migrations Hand-run SQL migrations (see below)
```

This started as a blank starting point and now also hosts the Sales
Dashboard described below — add further pages/tools as requests come in
from the team.

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
- `/dashboard` — filters (date range, store multi-select, category,
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

### Running the SQL migration

Supabase migrations here are plain `.sql` files, run manually for now (no
CLI/CI wiring yet): open the Supabase dashboard → SQL Editor → paste the
contents of `supabase/migrations/0001_sales_schema.sql` → run.

### Triggering a sync manually

Easiest: click **"Sync now"** on the `/dashboard` page itself - it runs the
sync directly (a Server Action, not an HTTP call), so `CRON_SECRET` never
has to leave the server, and the page shows the result (success + order
count, or the specific error) right above the filters.

Or, from the command line:

```bash
curl -X POST "https://<your-deployment>/api/sync/odoo?days=7" \
  -H "Authorization: Bearer <CRON_SECRET>"
```
