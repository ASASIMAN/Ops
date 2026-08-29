"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export async function createPostAction(formData: FormData) {
  const admin = createAdminClient();
  await admin.from("content_calendar").insert({
    post_date: String(formData.get("postDate") || "").trim() || null,
    format: String(formData.get("format") || "").trim() || null,
    carousel_slide_count: formData.get("carouselSlideCount")
      ? Number(formData.get("carouselSlideCount"))
      : null,
    pillar: String(formData.get("pillar") || "").trim() || null,
    copy: String(formData.get("copy") || "").trim() || null,
    remarks: String(formData.get("remarks") || "").trim() || null,
    asset_link: String(formData.get("assetLink") || "").trim() || null,
    reference_link: String(formData.get("referenceLink") || "").trim() || null,
  });

  revalidatePath("/marketing/creative");
  redirect("/marketing/creative");
}

export async function updatePostStatusAction(formData: FormData) {
  const id = Number(formData.get("id"));
  const status = String(formData.get("status") || "");
  if (!id || !status) return;

  const admin = createAdminClient();
  await admin
    .from("content_calendar")
    .update({ production_status: status })
    .eq("id", id);

  revalidatePath("/marketing/creative");
}
