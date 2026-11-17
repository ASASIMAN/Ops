"use server";

import { redirect } from "next/navigation";
import { runOdooSync, runOdooSyncRange } from "@/lib/odoo/sync";
import { fetchEarliestOrderDate } from "@/lib/odoo/sales";

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

// A full-history load is split into windows this long, one server action
// call each, so every call stays well inside the page's 60s limit however
// many months of sales exist.
const HISTORY_CHUNK_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type HistoryPlan =
  | { ok: true; chunks: { from: string; to: string }[]; firstDate: string }
  | { ok: false; error: string };

/**
 * Finds the first POS order in Odoo and lays out the date windows needed to
 * load everything from then until now. Nothing is written here.
 */
export async function planHistorySyncAction(): Promise<HistoryPlan> {
  try {
    const earliest = await fetchEarliestOrderDate();
    if (!earliest) return { ok: false, error: "Odoo has no POS orders yet." };

    const now = new Date();
    const start = new Date(
      Date.UTC(
        earliest.getUTCFullYear(),
        earliest.getUTCMonth(),
        earliest.getUTCDate(),
      ),
    );
    const chunks: { from: string; to: string }[] = [];
    for (let t = start.getTime(); t < now.getTime(); t += HISTORY_CHUNK_DAYS * DAY_MS) {
      chunks.push({
        from: new Date(t).toISOString(),
        to: new Date(Math.min(t + HISTORY_CHUNK_DAYS * DAY_MS, now.getTime())).toISOString(),
      });
    }
    return { ok: true, chunks, firstDate: start.toISOString().slice(0, 10) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/** Syncs one window from a history plan. The first one also refreshes the catalogue. */
export async function syncHistoryChunkAction(
  from: string,
  to: string,
  refreshCatalog: boolean,
): Promise<{ ok: true; ordersSynced: number } | { ok: false; error: string }> {
  const dateFrom = new Date(from);
  const dateTo = new Date(to);
  if (
    !Number.isFinite(dateFrom.getTime()) ||
    !Number.isFinite(dateTo.getTime()) ||
    dateTo <= dateFrom ||
    dateTo.getTime() - dateFrom.getTime() > 31 * DAY_MS
  ) {
    return { ok: false, error: "Invalid date window." };
  }
  try {
    const result = await runOdooSyncRange(dateFrom, dateTo, { refreshCatalog });
    return { ok: true, ordersSynced: result.ordersSynced };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
