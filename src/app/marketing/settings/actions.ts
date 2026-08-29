"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export async function updateStoreAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!id) return;

  const admin = createAdminClient();
  await admin
    .from("stores")
    .update({
      name: String(formData.get("name") || "").trim(),
      address: String(formData.get("address") || "").trim() || null,
      slug: String(formData.get("slug") || "").trim() || null,
      is_preopening: formData.get("isPreopening") === "on",
      active: formData.get("active") === "on",
    })
    .eq("id", id);

  revalidatePath("/marketing/settings");
}

export async function updateAppSettingAction(formData: FormData) {
  const key = String(formData.get("key") || "");
  const rawValue = String(formData.get("value") || "");
  if (!key) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    // Invalid JSON - leave the setting untouched rather than corrupt it.
    return;
  }

  const admin = createAdminClient();
  await admin
    .from("app_settings")
    .update({ value: parsed, updated_at: new Date().toISOString() })
    .eq("key", key);

  revalidatePath("/marketing/settings");
}
