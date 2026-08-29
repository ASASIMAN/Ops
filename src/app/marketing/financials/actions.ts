"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export async function updateAssumptionAction(formData: FormData) {
  const key = String(formData.get("key") || "");
  const value = Number(formData.get("value"));

  if (!key || !Number.isFinite(value)) return;

  const supabase = createAdminClient();
  await supabase
    .from("assumptions")
    .update({ value, updated_at: new Date().toISOString() })
    .eq("key", key);

  revalidatePath("/marketing/financials");
}
