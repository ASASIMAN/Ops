"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export async function createKolAction(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const category = String(formData.get("category") || "").trim();
  const status = String(formData.get("status") || "").trim();
  if (!category || !status) return;

  const admin = createAdminClient();
  await admin.from("kols").insert({
    name: name || null,
    social_handle: String(formData.get("socialHandle") || "").trim() || null,
    category,
    status,
    month_label: String(formData.get("monthLabel") || "").trim() || "-",
    gender: String(formData.get("gender") || "").trim() || null,
    location: String(formData.get("location") || "").trim() || null,
    follower_count: formData.get("followerCount")
      ? Number(formData.get("followerCount"))
      : null,
    engagement_rate: formData.get("engagementRate")
      ? Number(formData.get("engagementRate"))
      : null,
    pic: String(formData.get("pic") || "").trim() || null,
    approved_by: String(formData.get("approvedBy") || "").trim() || null,
    deal_terms: String(formData.get("dealTerms") || "").trim() || null,
    deliverables: String(formData.get("deliverables") || "").trim() || null,
    booking_date: String(formData.get("bookingDate") || "").trim() || null,
    opportunity_cost_idr: formData.get("opportunityCostIdr")
      ? Number(formData.get("opportunityCostIdr"))
      : null,
    opportunity_cost_raw: String(formData.get("opportunityCostRaw") || "").trim() || null,
    content_link: String(formData.get("contentLink") || "").trim() || null,
  });

  revalidatePath("/marketing/kols");
  redirect("/marketing/kols");
}

export async function updateKolStatusAction(formData: FormData) {
  const id = Number(formData.get("id"));
  const status = String(formData.get("status") || "");
  if (!id || !status) return;

  const admin = createAdminClient();
  await admin.from("kols").update({ status }).eq("id", id);

  revalidatePath("/marketing/kols");
}
