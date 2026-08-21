"use server";

import { redirect } from "next/navigation";
import { runOdooSync } from "@/lib/odoo/sync";

/**
 * Triggers a sync directly (no HTTP round-trip), so CRON_SECRET never has
 * to reach the browser. Errors are swallowed here since `runOdooSync`
 * already records them on the `sync_runs` row, which the dashboard reads
 * and displays.
 */
export async function syncNowAction(formData: FormData) {
  const days = Number(formData.get("days") ?? "7");
  const returnTo = String(formData.get("returnTo") || "/dashboard");

  try {
    await runOdooSync(days);
  } catch {
    // recorded in sync_runs; surfaced via the "Last sync" panel
  }

  redirect(returnTo);
}
