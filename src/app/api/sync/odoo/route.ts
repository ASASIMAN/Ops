import { NextRequest, NextResponse } from "next/server";
import { runLoyaltySync, runOdooSync, runStockSync } from "@/lib/odoo/sync";

export const maxDuration = 60;

/**
 * Pulls recent sales data from Odoo and upserts it into Supabase.
 *
 * Protected by CRON_SECRET rather than user auth, since this is meant to be
 * called by Vercel's cron scheduler (or manually while testing), not a
 * browser. Vercel automatically sends `Authorization: Bearer $CRON_SECRET`
 * as a GET request on requests it makes to cron paths - set the CRON_SECRET
 * env var and vercel.json's cron entry picks it up with no extra wiring.
 * For a manual call (e.g. curl), send that same header yourself; POST works
 * too, for triggering from something other than Vercel's scheduler.
 * Pass ?days=N to control how far back to sync orders (default 2, to
 * comfortably overlap the previous run). A full historical backfill should
 * be run in smaller date windows to stay under the function time limit -
 * see README "Backfilling history".
 *
 * The dashboard's "Sync now" button calls `runOdooSync` directly (a Server
 * Action, not HTTP) rather than hitting this route, so CRON_SECRET never
 * needs to reach the browser.
 */
async function handleSync(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Number(request.nextUrl.searchParams.get("days") ?? "2");

  // Sales and stock on hand are synced side by side (independent Odoo
  // reads), so the daily cron keeps both current; one failing doesn't stop
  // the other. Each records its own row in sync_runs. Loyalty runs after
  // sales, so the orders it links to customers include today's.
  const [sales, stock] = await Promise.allSettled([runOdooSync(days), runStockSync()]);
  const [loyalty] = await Promise.allSettled([runLoyaltySync()]);
  const errorOf = (r: PromiseSettledResult<unknown>) =>
    r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : "Unknown error") : null;

  if (sales.status === "rejected") {
    return NextResponse.json(
      { ok: false, error: errorOf(sales), stockError: errorOf(stock), loyaltyError: errorOf(loyalty) },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    ordersSynced: sales.value.ordersSynced,
    stockRowsSynced: stock.status === "fulfilled" ? stock.value.quantsSynced : null,
    stockError: errorOf(stock),
    loyalty: loyalty.status === "fulfilled" ? loyalty.value : null,
    loyaltyError: errorOf(loyalty),
  });
}

export const GET = handleSync;
export const POST = handleSync;
