"use server";

import { redirect } from "next/navigation";
import { runStockSync } from "@/lib/odoo/sync";

/**
 * Triggers a stock-only sync directly (Server Action, no HTTP round-trip) -
 * same shape as /operations' syncNowAction for sales. Errors are recorded
 * on `sync_runs` (sync_type = 'stock') rather than thrown here, same
 * reasoning as the sales version: the page's "last sync" panel is where
 * a failure should surface, not a thrown error on the redirect.
 */
export async function syncStockNowAction(formData: FormData) {
  const returnTo = String(formData.get("returnTo") || "/forecast");

  try {
    await runStockSync();
  } catch {
    // recorded in sync_runs; surfaced via the "Last sync" panel
  }

  redirect(returnTo);
}
