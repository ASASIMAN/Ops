"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export async function createCampaignAction(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) return;

  const channels = String(formData.get("channels") || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const linkedAdSetNames = String(formData.get("linkedAdSetNames") || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  const admin = createAdminClient();
  await admin.from("campaigns").insert({
    name,
    objective: String(formData.get("objective") || "").trim() || null,
    channels,
    start_date: String(formData.get("startDate") || "").trim() || null,
    end_date: String(formData.get("endDate") || "").trim() || null,
    budget_idr: formData.get("budgetIdr") ? Number(formData.get("budgetIdr")) : null,
    linked_ad_set_names: linkedAdSetNames,
  });

  revalidatePath("/marketing/campaigns");
  redirect("/marketing/campaigns");
}

export async function updateCampaignStatusAction(formData: FormData) {
  const id = Number(formData.get("id"));
  const status = String(formData.get("status") || "");
  if (!id || !status) return;

  const admin = createAdminClient();
  await admin.from("campaigns").update({ status }).eq("id", id);

  revalidatePath("/marketing/campaigns");
  revalidatePath(`/marketing/campaigns/${id}`);
}

export async function updatePostMortemAction(formData: FormData) {
  const id = Number(formData.get("id"));
  const postMortem = String(formData.get("postMortem") || "");
  if (!id) return;

  const admin = createAdminClient();
  await admin.from("campaigns").update({ post_mortem: postMortem }).eq("id", id);

  revalidatePath(`/marketing/campaigns/${id}`);
}
