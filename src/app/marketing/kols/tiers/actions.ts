"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export async function createTierAction(formData: FormData) {
  const tierName = String(formData.get("tierName") || "").trim();
  if (!tierName) return;

  const admin = createAdminClient();
  await admin.from("kol_tiers").insert({
    tier_name: tierName,
    follower_threshold_min: formData.get("followerThresholdMin")
      ? Number(formData.get("followerThresholdMin"))
      : null,
    deliverables: String(formData.get("deliverables") || "").trim() || null,
    compensation: String(formData.get("compensation") || "").trim() || null,
    kitas_requirement: formData.get("kitasRequirement") === "on",
  });

  revalidatePath("/marketing/kols/tiers");
  redirect("/marketing/kols/tiers");
}

export async function updateTierAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!id) return;

  const admin = createAdminClient();
  await admin
    .from("kol_tiers")
    .update({
      follower_threshold_min: formData.get("followerThresholdMin")
        ? Number(formData.get("followerThresholdMin"))
        : null,
      deliverables: String(formData.get("deliverables") || "").trim() || null,
      compensation: String(formData.get("compensation") || "").trim() || null,
      kitas_requirement: formData.get("kitasRequirement") === "on",
    })
    .eq("id", id);

  revalidatePath("/marketing/kols/tiers");
}
