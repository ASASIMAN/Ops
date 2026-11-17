"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getShellContext } from "@/lib/shell/context";

const TARGET_EDITORS = ["admin", "ops"];
const MONTH = /^\d{4}-\d{2}-01$/;

/**
 * Saves one month's sales targets, one field per shop. A blank field clears
 * that shop's target for the month (no target is a valid state - nothing is
 * defaulted). Only admin and ops can set targets.
 */
export async function saveStoreTargetsAction(formData: FormData) {
  const { email, role } = await getShellContext();
  const month = String(formData.get("month") || "");
  const back = String(formData.get("returnTo") || "/sales/stores");
  const returnTo = back.startsWith("/sales/stores") ? back : "/sales/stores";
  const join = returnTo.includes("?") ? "&" : "?";

  if (!email || !TARGET_EDITORS.includes(role)) {
    redirect(`${returnTo}${join}error=${encodeURIComponent("Only admin or ops can set targets.")}`);
  }
  if (!MONTH.test(month)) {
    redirect(`${returnTo}${join}error=${encodeURIComponent("That month isn't valid.")}`);
  }

  const admin = createAdminClient();
  const upserts: { store_key: string; month: string; target_idr: number; updated_at: string }[] = [];
  const clears: string[] = [];
  for (const [name, raw] of formData.entries()) {
    if (!name.startsWith("target:")) continue;
    const storeKey = name.slice("target:".length);
    if (!/^[a-z0-9-]{1,40}$/.test(storeKey)) continue;
    // Accept "450.000.000", "450,000,000" or "450000000".
    const digits = String(raw).replace(/[^\d]/g, "");
    if (digits === "") clears.push(storeKey);
    else upserts.push({ store_key: storeKey, month, target_idr: Number(digits), updated_at: new Date().toISOString() });
  }

  if (upserts.length) {
    const { error } = await admin.from("store_targets").upsert(upserts, { onConflict: "store_key,month" });
    if (error) redirect(`${returnTo}${join}error=${encodeURIComponent(`Couldn't save targets: ${error.message}`)}`);
  }
  if (clears.length) {
    const { error } = await admin.from("store_targets").delete().eq("month", month).in("store_key", clears);
    if (error) redirect(`${returnTo}${join}error=${encodeURIComponent(`Couldn't clear targets: ${error.message}`)}`);
  }

  revalidatePath("/sales/stores");
  redirect(`${returnTo}${join}saved=1`);
}
