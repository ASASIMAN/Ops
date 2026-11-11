"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { extractMemberCode } from "@/lib/membership/code";
import { getStaffUser } from "@/lib/membership/data";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireStaff() {
  const staff = await getStaffUser();
  if (!staff) redirect("/login");
  return staff;
}

export async function lookupMemberAction(formData: FormData) {
  await requireStaff();
  const code = extractMemberCode(String(formData.get("code") || ""));
  if (code) redirect(`/v/${code}`);
}

export async function setMemberStatusAction(formData: FormData) {
  await requireStaff();
  const id = String(formData.get("id") || "");
  const status = formData.get("status") === "suspended" ? "suspended" : "active";
  await createAdminClient().from("members").update({ status }).eq("id", id);
  revalidatePath("/membership");
}

export async function createVenueAction(formData: FormData) {
  await requireStaff();
  const name = String(formData.get("name") || "").trim();
  const discount = String(formData.get("discountText") || "").trim();
  if (!name || !discount) return;
  await createAdminClient().from("partner_venues").insert({
    name,
    discount_text: discount,
    notes: String(formData.get("notes") || "").trim() || null,
    sort_order: Number(formData.get("sortOrder")) || 0,
  });
  revalidatePath("/membership/venues");
}

export async function updateVenueAction(formData: FormData) {
  await requireStaff();
  const id = Number(formData.get("id"));
  if (!id) return;
  await createAdminClient().from("partner_venues").update({
    name: String(formData.get("name") || "").trim(),
    discount_text: String(formData.get("discountText") || "").trim(),
    notes: String(formData.get("notes") || "").trim() || null,
    sort_order: Number(formData.get("sortOrder")) || 0,
    active: formData.get("active") === "on",
  }).eq("id", id);
  revalidatePath("/membership/venues");
}

export async function deleteVenueAction(formData: FormData) {
  await requireStaff();
  const id = Number(formData.get("id"));
  if (id) await createAdminClient().from("partner_venues").delete().eq("id", id);
  revalidatePath("/membership/venues");
}
