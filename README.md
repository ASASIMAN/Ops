## ASASI Internal Ecosystem

Next.js (App Router) + TypeScript + Tailwind CSS + Supabase. One deployed
app, gated by login, with a hub that routes into separate workspaces:
**Operations** (live — the Odoo POS sales dashboard), **Forecasting**
(live — restock alerts, revenue/demand forecasts, top & low sellers, and
forecast accuracy, built on the Odoo sales sync), and **Marketing**
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
| `ODOO_COLOR_ATTRIBUTE_NAMES` | Optional, comma-separated. Which Odoo `product.attribute` names sync into `products.color` (case-insensitive). Defaults to `color,colour,colors,colours` - set this if your Odoo instance names that attribute something else (a different language, a house term), otherwise the Colour filter on `/operations` stays empty. |
| `ODOO_SIZE_ATTRIBUTE_NAMES` | Optional, comma-separated. Same idea for `products.size`. Defaults to `size,sizes`. |
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
src/app/forecast/       Forecasting: restock alerts, revenue/demand forecasts, top & low sellers
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
- **Colour, size and type aren't flat fields** — Odoo models every
  variant dimension identically, as `product.template.attribute.value`
  rows. `src/lib/odoo/sales.ts` resolves *all* of them and stores the
  full attribute-name → value map in `products.variant_attributes`, so
  nothing is lost whatever your instance names them. Colour and size are
  pulled into their own columns by name (case-insensitive `color` /
  `colour` / `size`); `products.variant_type` is whatever attribute is
  left over, which is how the third dimension gets captured without
  guessing whether it's called "Type", "Style" or "Fit". If a variant
  carries more than one leftover attribute they're joined with `" / "`
  rather than one being picked arbitrarily. If you'd rather see them as
  separate columns, say what the attributes are actually called and
  that's a small change.
- **SKU** is Odoo's `default_code` (the internal reference) on
  `product.product`, i.e. per variant, not per template.
- **Order Reference** is `pos.order.name`, stored as
  `orders.pos_reference`.
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
- `supabase/migrations/0022_variants_and_sales_rollups.sql` — adds
  `products.variant_type` + `products.variant_attributes`, and five
  Postgres rollup functions (`ops_sales_totals`, `ops_sales_daily`,
  `ops_sales_by_store`, `ops_top_products`, `ops_top_variants`). The
  rollups exist because the line table is capped at 1000 rows —
  aggregating the capped rows in JS would quietly describe only the
  first 1000 lines, so totals, charts and the top-20 aggregate in
  Postgres over the whole filtered range instead. Same security posture
  as the tables: execute revoked from `public`, granted to
  `service_role` only.
- `/operations` — a plain HTML GET form (filter state lives in the URL,
  no client JS anywhere on this page), then:
  - Filters: date range, **store checkboxes** (nothing ticked = all
    stores; `NSA` is excluded from the picker), colour, size, and type
    when variant types exist. There's no category filter.
  - Summary tiles: revenue, units, orders, line items — over the whole
    range, not just the visible rows.
  - **Sales over time** — revenue per trading day as bars on a real
    date axis. Days with no synced sales get no bar rather than a
    zero, because the sync only covers the days it's been run for and a
    gap isn't evidence of a zero-sales day.
  - **Sales by store** — revenue-share pie plus a labelled legend.
  - **Top 10 products sold** — by units, variants of a product counted
    together.
  - **Top 20 product variants sold** — one row per SKU.
  - **Sales lines** — date, order reference, store, SKU, product,
    category, colour, type, size, qty, subtotal. Capped at 1000 rows;
    everything above it aggregates the full range regardless.

  Dates and daily buckets on this page are Bali time (WITA, UTC+8), so a
  sale at 07:00 local belongs to that trading day rather than to the
  previous UTC day.

**What's not built yet (next phases):**
- Sell-through / stock-cover views (needs inventory levels, which aren't
  synced — only sales are)
- Forecasting formulas on top of the trend data
- Pagination past 1000 rows on the line-level table
- A scheduled historical backfill. A one-off full load exists: the
  **Sync all history** button on `/operations` finds the first POS order in
  Odoo and loads everything since in 14-day windows (one server action call
  each, so no single request nears the 60s limit). It is driven from the
  browser, so the page must stay open until it reports Done; re-running is
  safe (all writes are upserts).

### Running the SQL migrations

Supabase migrations here are plain `.sql` files, run manually for now (no
CLI/CI wiring yet): open the Supabase dashboard → SQL Editor → paste each
file's contents in order → run.

**After running one that adds or changes a function's parameters**
(anything that does `create or replace function` with a different
signature, or `drop function` + `create function`) - PostgREST caches
function signatures, and that cache doesn't always refresh immediately.
If the app then says something like `Could not find the function
public.foo(...) in the schema cache` even though the migration ran
successfully, run `NOTIFY pgrst, 'reload schema';` in the SQL editor (or
Project Settings → API → Reload schema cache) to force it.

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

**Since then:**
- `/marketing` (Overview) is now a genuine one-page summary: a
  side-by-side "Needs attention" / "Looking good" panel driven by
  `src/lib/insights.ts`, including a creative-pipeline alert (nothing in
  production, or nothing scheduled on/after today) - the same rules also
  render in full on `/marketing/insights`.
- `supabase/migrations/0012_backfill_creative_from_organic_posts.sql`
  backfills the Creative Planner with the real July '26 Instagram
  posts/reels already in `organic_posts` (from the Metricool report),
  marked `Published` with their real dates. Each card also carries its
  real Metricool performance (impressions/interactions/etc.) via
  `metricool_performance`, shown on the card - the "pull performance back
  after publish" behavior from the brief. Not backfilled: content pillar
  (not tagged in the source export) and asset/reference links (no real
  URLs were captured) - left null rather than invented.
- **GA4 + Search Console are live.** Turned out the Workspace org blocks
  service account key creation (`iam.disableServiceAccountKeyCreation`),
  so both use OAuth instead - one Google Cloud OAuth client, a separate
  refresh token per API (each authorized with its own scope via the
  OAuth Playground, since the org policy ruled out service accounts
  entirely). `src/lib/google/oauth.ts` handles token refresh/caching,
  `ga4.ts`/`search-console.ts` are the adapters, `sync.ts` upserts into
  `facts_daily` (`source = 'ga4'` / `'search_console'`), and
  `/api/sync/google` runs it daily via cron (`vercel.json`) - same shape
  as the Odoo sync. Real numbers now show on `/marketing/organic-social`
  and the Data Import hub has a manual "Sync now".
- **Google Business Profile is blocked on Google, not on us.** OAuth is
  set up the same way (refresh token obtained, ready to use), but
  Google's own self-serve API access request was declined for the
  listing submitted - their automated eligibility check, not a config
  issue here. No GBP adapter exists yet since there's nothing to call
  until that's resolved (retry with a different location, or dig into
  why it was declined). Real GBP data stays limited to the one
  business-wide number from the Metricool report in the meantime.
- **`/marketing/creative-brief`** replaces Meta account-health noise
  (error codes, ranking warnings, CPA outliers) as the headline Meta ads
  view. No Meta Marketing API - it reads whatever's been dropped for a
  given month (`meta-ads.csv`, `review.md`, `notes.md`, `ad-links.csv`)
  via an in-app upload form on that page (`creative_brief_months` table;
  ad-level numbers reuse the existing `ads`/`ad_performance_snapshots`
  tables and CSV parser). Three blocks: Content Observations (numbered,
  each with a Strong/Directional/Anecdote confidence chip - default
  Anecdote when there's no number behind it), Best Performing Ads
  (ranked from `ad-links.csv` when present, otherwise the team's own
  picks from `notes.md`, honestly labeled "nominated by the team"), and
  What to test next (pulled from `review.md`'s creative-test/open-
  questions sections). Operational stuff - rankings, CPA, spend, MoM -
  lives in a collapsed "Account health" disclosure at the bottom, not
  the headline. `src/lib/insights.ts` had its per-ad CPA-outlier and
  below-average-ranking alerts removed entirely (they'd become a long,
  spammy bullet list) - that logic now lives only in this page's Account
  health section. September 2026 is seeded for real: August's Ads
  Manager export (`0015_seed_august_ads.sql`) plus the given observations
  (`0016_seed_september_creative_brief.sql`) - no `review.md` was
  provided for September, so "What to test next" correctly shows empty
  rather than a fabricated brief. Bali local time (WITA, UTC+8) and a
  compact `Rp 2.4M`/`Rp 245k` formatter are used throughout this page
  only - the rest of the app keeps full-precision Rupiah and UTC dates.

## PO Planning Chart (/forecast)

The forecasting module's main screen: a filter row (product type-ahead,
colour/size/store, an optional "+ Compare" second product, Past/Next
range), one chart, and a collapsed-by-default PO planner panel below it.
"Style" = an Odoo product template - colour/size variants of one style
share a forecast and get allocated back out, never forecast
independently.

**Filters**: `Product` is a free-text input with an HTML `<datalist>` of
every style name, so it type-aheads with no client-side JS. Typing a
name that doesn't match any style is flagged and the previous selection
is kept rather than silently guessing the closest one. `+ Compare` adds
a second style as a second line on the chart (its own colour from the
app's categorical palette) - it does not get its own planner panel,
which stays scoped to the primary product. `Colour`/`Size` only list
values that exist for the *primary* product's own variants, and are
canonical values (see `attribute_aliases` below) so "Bone" and "Off
White" show as one dropdown entry if aliased. `Store` defaults to "All
stores" (office + every store combined). Every filter round-trips
through the URL query string.

**Chart**: solid line = actual net units sold per month (sales minus
returns - `order_lines.qty` already carries a negative sign on refund
lines at the same grain, so summing it is already net), one marker per
month. The current month is never plotted as a completed month: it
shows as two points, month-to-date (filled dot) and a run-rate
projection to a full month (hollow dot). Dashed line + band = forecast
low/expected/high for the "Next" dropdown's months (1/3/6, defaulting to
the smallest option ≥ `ceil((late lead time + coverage days) / 30)`),
from the same `forecast()` engine as `/forecast/overview` - always fit
on the *full style*, then scaled down by the colour/size trailing-mix
share (colour: 3 months, size: 6) when a colour/size filter is active,
never re-fit on the smaller filtered slice directly. A vertical "Today"
line and a "Prediction" label mark the forecast region. A small square
below the axis flags a month with any recorded stockout day (count in
the tooltip); "Adjust history for stockouts" scales an affected month up
by `days / (days - stockout days)`, only for months migration 0029's
stock history actually covers. A low-volume badge appears when the
current selection averages under `lowVolumeThreshold` (default 10)
units/month - the forecast is real but rougher on that little data. An
empty state replaces the chart entirely when the selection has no sales
history at all.

**Manual uplift factors** (`forecast_uplift_factors`) are business-
entered, date-ranged, nothing inferred from sales - date ranges rather
than a recurring "month of year" because Lebaran moves ~11 days earlier
every Gregorian year (lunar calendar), so a fixed calendar month would
silently drift wrong; each occurrence gets its own real start/end date.

**Colour/size name reconciliation** (`attribute_aliases`, migration
0031): Odoo's own `products.color`/`size` and the PO sheet's
`colorway`/`size` don't always spell the same attribute the same way
(the business's own example: "Bone" vs. "Off White"). Every place that
groups or joins by colour/size - the dropdowns, the trailing-mix
allocation, the PO grid's CMT-price lookup - canonicalizes through this
table first (`src/lib/forecast/aliases.ts`), never by string-matching. A
value with no row here is its own canonical form; it starts empty and
needs real aliases added once the business confirms which spellings are
the same thing.

**PO planner panel** (collapsed by default, `<details>` - no JS):
always the primary product, full network (office + every store),
independent of the chart's store filter. Current stock, open PO qty not
yet received (from the imported PO history), the resolved lead time
(late end), and editable coverage months/service level. `stock_on_arrival
= max(0, current stock + open PO landing before arrival - forecast
until arrival)`; `target = forecast over coverage + safety stock`
(safety stock from the forecast's own error distribution via the same
z-score function the restock alerts use - not a fixed %);
`suggested PO qty = max(0, target - stock on arrival)`. Every line of
that calculation is shown, not just the result. "Already late" flags
when projected stock would go negative before a PO placed today could
possibly arrive.

**Mini stock chart** (inside the planner): the projected trajectory only
(current stock minus the forecast's demand rate, plus open POs stepping
up at their resolved ETA - a thin band between the pessimistic/late-ETA
and optimistic/early-ETA trajectories), a red safety-stock line, and an
"Order by \<date\>" marker (`(date stock reaches the safety-stock level)
- (late lead time)`). "What if I order X" adds the entered quantity as
one more hypothetical PO (landing at today + lead time min..max) and
redraws this same chart with it included, rather than only printing a
number.

**Suggested PO grid**: colour × size, in the PO sheet's own layout
(style, colour, size, qty, CMT price), every qty/price cell editable
before exporting. CMT price is pulled from the most recent
`purchase_order_lines.unit_price_idr` seen for that exact colour+size
(canonicalized through `attribute_aliases`), when one exists. **Export
to CSV** (not .xlsx - see below) posts the form's current values
(including any edits) to `/api/forecast/export-po`, so the export always
matches what's on screen, not a server-recomputed value that could
silently differ from an edited cell.

**Flagged assumptions**:
- Two different Odoo templates sharing the exact same name (a real Odoo
  data issue - a deleted-and-recreated product, a true duplicate, etc.)
  would otherwise be indistinguishable in a plain-text `<datalist>`, and
  picking either one would always resolve to whichever sorts first,
  silently making the other unreachable. `fetchStyleOptions`
  (`src/lib/forecast/style.ts`) appends the template id to every entry
  sharing a colliding name instead of guessing they're the same style -
  the page flags it when the current selection is one of these. Worth
  checking in Odoo whether it's a genuine duplicate.
- `attribute_aliases` starts empty - no colour/size names are being
  merged until the business confirms real aliases ("Bone"/"Off White"
  or others) and someone adds them.
- Colour share (trailing 3 months) and size share (trailing 6 months)
  are combined multiplicatively to allocate a style forecast down to a
  colour/size selection - assumes they're independent, not a measured
  joint distribution. No trailing sales for the selected colour/size
  shows the forecast as 0 with an explicit note, not a silent guess.
- The forecast engine's residual std-dev is monthly; the planner's and
  the mini stock chart's safety-stock math needs a daily figure, so it's
  divided by `sqrt(30)` (variance scales linearly with time) - daily
  demand noise isn't actually measured, only monthly.
- The stock trajectory draws down at a flat daily rate (no within-month
  seasonality) and only steps up for POs already in `purchase_orders`
  plus the hypothetical "what if" quantity.
- A chart style (Odoo template) and the lead-time system's product
  (migration 0027, quoted per style on the PO sheet) are still two
  separate identities - `lead_time_name_mappings.odoo_template_id` is
  where a human links them; until linked, the planner can't compute
  open-PO-qty or a real lead time and says so (falls back to the global
  default range) rather than showing 0.
- No seasonality learning until ≥24 months of data exists.
- Grid edits and "what if" quantities aren't persisted anywhere beyond
  the CSV they're exported in - there's no draft-PO storage yet.
- Dropped from the previous version of this page, since this round's
  brief didn't ask for them again: store tabs (now a dropdown),
  overlaying more than 2 series at once, the side-by-side stock chart
  with per-series status badges, event/campaign (★) markers, and the
  same-month-last-year overlay. `stock_level_history` (migration 0029)
  is still read here (this page's own stockout-day detection,
  `fetchStockoutDays`). `fetchForecastEvents`/`forecast_events` are not
  called from anywhere right now - dead code kept rather than deleted,
  in case the ★ markers come back in a later round.

## Forecasting overview (/forecast/overview)

Five sections, all built on the same synced Odoo sales data as the Sales
Dashboard, plus a new stock sync:

1. **Restock timing & quantity** - a vendor-level alert (combined
   office + all-stores stock vs. demand over vendor lead time), an
   independent per-store transfer alert, a suggested split of an
   incoming order across stores (proportional to each store's
   forecasted demand, not even), and a combined red/yellow/green risk
   view per SKU.
2. **Revenue forecast** - monthly, company-wide and per-store, as a
   low/expected/high band, plus a category breakdown.
3. **Monthly demand forecast** - units per SKU, rollable to
   category/company, filterable by store, with the underlying trend
   shown alongside the number.
4. **Top & low sellers** - ranking with trend direction, cross-referenced
   with stock (stockout risk on top sellers; dead-stock candidates on
   low/zero sellers still holding office stock).
5. **Forecast vs. actual** - a rolling one-month-ahead backtest (each
   point predicts using only the months before it), overall and per-SKU
   MAPE, and how that accuracy trends as more months accumulate.

**Forecast engine** (`src/lib/forecast/engine.ts`) is the one thing every
section above reads from - restock (§1) forecasts over a daily bucket,
revenue/demand (§2/§3) over a monthly bucket, but it's the same
`forecast()` function either way, so the two can't drift onto different
views of "what will we sell." Default method is Holt's linear
exponential smoothing (level + trend, no seasonality); a plain moving
average is the fallback for series too short for Holt. Swapping the
method is a config change (`ForecastOptions.method`), not a rewrite -
nothing in `src/app/forecast` or `src/lib/forecast/data.ts` needs to
change to add a new method.

**Data model additions** (`supabase/migrations/0023_forecast_inventory.sql`):
- `stock_locations` - the office (staging warehouse) and each store's
  Odoo stock location, since the office is a `stock.location`, not a
  `pos.config`, and can't live in `stores`.
- `stock_levels` - current on-hand qty per SKU per location, from Odoo
  `stock.quant`. Overwritten in place each sync, not a history table.
- `vendor_reorder_settings` - per-SKU (or one global default) lead time
  and target service level.
- `ops_period_demand()` - one flexible Postgres function (day/week/month
  bucket, optional store/product filters) that every rollup above reads
  through, same reasoning as `ops_sales_daily` etc. in migration 0022.

**Stock sync**: `runStockSync()` in `src/lib/odoo/sync.ts`, triggered by
the "Sync stock now" button on `/forecast` (a stock.quant snapshot has no
useful date range, so unlike the sales sync there's no `days` parameter -
it always syncs the current position). Shares the `sync_runs` table with
the sales sync, distinguished by a new `sync_type` column.

### Lead times (/forecast/lead-times)

A separate, more precise lead-time system than `vendor_reorder_settings`
above - per-product (not per-SKU; vendor lead times are quoted per
style, colour/size variants share one row), with a full ETA priority
chain and real purchase-order history to measure against. New schema in
`supabase/migrations/0027_lead_times.sql` and `0028_seed_purchase_orders.sql`
(seeds the 16 real POs / 317 lines supplied in `po_lines_clean.csv`):

- `lead_time_products` - the canonical product identity this subsystem
  keys off (NOT Odoo's product_id).
- `lead_time_name_mappings` - the **only** place a raw name (from a PO
  sheet or Odoo) becomes a `lead_time_products` row. Nothing here ever
  splits a name on `" - "` to guess colour vs. variant - that separator
  means different things in different names ("Linen Pants - Black" vs.
  "Origin Shirt - Long Sleeve"), so every raw name is mapped explicitly.
  An importer creates a new 1:1 mapping (never a merge) for a name it
  hasn't seen, flagged `auto_created` for a human to confirm.
- `lead_times` - the editable table the brief asked for: product,
  vendor (nullable), min/max days, source (`vendor estimate` /
  `measured` / `manual`), note, plus `raw_text` for audit against the
  normalized number.
- `lead_time_settings` - one editable row: the late-end buffer applied
  to single-point estimates, the global default range, the minimum PO
  count before "measured" activates, and the two assumptions the brief
  asked to be visible/editable rather than baked in - clock start
  (currently only "PO date" is implemented) and whether an estimate
  covers the first delivery/batch only or the whole PO.
- `purchase_orders` / `purchase_order_lines` - real PO history, for
  measuring actual lead time once delivery dates exist.
  `purchase_orders.manual_eta_date` is the highest-priority override.

**Text normalization** (`src/lib/leadtime/normalize.ts`): parses mixed
English/Indonesian lead-time text - "10 days" = 10, "1 Month"/"1 Bulan" =
30, "2-3 Months" = 60-90, "4-6 minggu" = 28-42, etc. Unparseable text is
reported back to whoever imports it, never guessed.

**ETA priority** (`src/lib/leadtime/resolve.ts`), most specific first:
manual ETA on the PO → measured lead time (once a product has ≥
`measured_min_po_count` POs with real delivery dates - currently **0**
for every product, since the supplied PO export has no delivery dates
yet) → this product's row in `lead_times` → the global default range.
A single-point `lead_times` estimate gets the configurable late-end
buffer (default +25%) applied to its high end for alerting; a range
estimate or a measured range doesn't need one.

**Importing vendor estimates**: `/forecast/lead-times` has a CSV upload
(`src/lib/adapters/lead-time-estimates.ts` + `src/lib/leadtime/ingest.ts`).
**Not .xlsx** - the only npm package that parses `.xlsx` (`xlsx`/SheetJS)
carries two unpatched high-severity CVEs (prototype pollution, ReDoS)
with no fix available, so it wasn't added as a dependency; export
`Product_estimation_Vendor.xlsx` to CSV first, same as the existing Meta
Ads importer already requires.

**Not yet wired into restock alerts** (`/forecast/overview`'s §1): the restock
calc still reads `vendor_reorder_settings`/`FALLBACK_LEAD_TIME_DAYS`
(below), not this new system. Doing so needs Odoo product names/template
ids mapped into `lead_time_name_mappings` (the `odoo_template_id` column
exists for exactly this) - not done yet because no Odoo product-name
data has been imported here to map from. Once that mapping exists, swap
`src/app/forecast/page.tsx`'s restock section to call
`resolveProductLeadTime`/`resolveEtaForPo` instead.

**Flagged assumptions / open items** - none of these are silently
defaulted; each is called out where it's used in code and in the UI:
- **The actual vendor estimates haven't been imported** -
  `Product_estimation_Vendor.xlsx` wasn't attached when this was built;
  `lead_times` is empty until it's exported to CSV and uploaded via
  `/forecast/lead-times`.
- **Zero measured lead times yet** - the supplied PO export has no
  `b1_date`/`b2_date`/`b3_date` values at all, so "measured" never
  activates today. The machinery is ready; it starts working the moment
  real delivery dates exist.
- **"Shadow - Long Sleeve" vs. "Shadow Shirt"** (PO 135 vs. POs
  146/148/150, both Black-only) may be the same garment renamed over
  time - left as two separate products, flagged in
  `lead_time_name_mappings`, pending a human confirming whether to merge.
- **Vendor lead time per SKU** (the older, coarser mechanism, still what
  restock alerts actually use) isn't loaded yet -
  `vendor_reorder_settings.lead_time_days` is null until then, and
  the restock calc falls back to a placeholder
  (`FALLBACK_LEAD_TIME_DAYS = 14` days, `src/lib/forecast/restock.ts`),
  visibly flagged with `*` on every affected row.
- **Office → store transfer lead time** has no data source at all yet
  (it's internal logistics, not a vendor lead time) -
  `FALLBACK_TRANSFER_LEAD_TIME_DAYS = 2` days is a guess, same file,
  same flagging.
- **No cost data** (unit cost, holding cost) - by design for this phase;
  safety stock uses a target-service-level model (z-score x demand
  std-dev x sqrt(lead time)), not EOQ/cost-based reorder math.
- **No seasonality modeling** - current sales history (a few thousand
  order lines total) is far short of the multiple full years a seasonal
  method would need to fit reliably. Holt's trend line is shown, but
  it's a trend, not a seasonal decomposition - revisit once ≥24 months
  of history exist.
- **Stock quantity is gross on-hand** (`stock.quant.quantity`), not
  netted against reservations - there's no reservation data synced to
  net against yet.
- **MAPE in §5 is noisy by design** on this little data (one-step-ahead
  backtest, in-sample residual bands) - treat forecast bands and
  accuracy numbers as indicative, not precise intervals.

## How to update this each month

1. **Odoo sales** sync automatically (daily cron) - no action needed
   unless `/operations` shows a failed sync, in which case click **Sync
   now** there.
1a. **Odoo stock** doesn't have a cron yet - click **Sync stock now** on
   `/forecast` to refresh on-hand quantities before relying on the
   restock alerts.
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
