"use server";

import { redirect } from "next/navigation";
import { runOdooSync } from "@/lib/odoo/sync";

// The daily cron only pulls the last 2 days each run (see vercel.json) -
// if it ever misses running for longer than that (a deploy, Odoo
// downtime), the days in between never get picked up automatically and
// stay a permanent gap until someone backfills them manually. This is
// that manual backfill, so the range needs to reach further back than
// the cron's rolling window - 90 days is generous without risking the
// route's 60s limit at this order volume (see README "Backfilling
// history" for a full historical load, which needs date-chunked runs).
const MAX_SYNC_DAYS = 90;

/**
 * Triggers a sync directly (no HTTP round-trip), so CRON_SECRET never has
 * to reach the browser. Errors are swallowed here since `runOdooSync`
 * already records them on the `sync_runs` row, which the dashboard reads
 * and displays.
 */
export async function syncNowAction(formData: FormData) {
  const requestedDays = Number(formData.get("days") ?? "7");
  const days = Number.isFinite(requestedDays)
    ? Math.min(Math.max(Math.trunc(requestedDays), 1), MAX_SYNC_DAYS)
    : 7;
  const returnTo = String(formData.get("returnTo") || "/operations");

  try {
    await runOdooSync(days);
  } catch {
    // recorded in sync_runs; surfaced via the "Last sync" panel
  }

  redirect(returnTo);
}
