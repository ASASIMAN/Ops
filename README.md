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
src/components/     shared UI components
src/lib/supabase/   Supabase client helpers
```

This is intentionally a blank starting point — add pages, components, and
Supabase tables as requests come in from the team.
