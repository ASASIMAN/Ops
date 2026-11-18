"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { extractMemberCode } from "@/lib/membership/code";
import sharp from "sharp";
import { POINT_VALUE_KEY, getStaffUser } from "@/lib/membership/data";
import { runLoyaltySync } from "@/lib/odoo/sync";
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

/**
 * A partner logo from the upload field, shrunk to fit 256x256 and stored
 * as a small WebP data: URL. null = no file chosen; "invalid" = not an image.
 */
async function readLogo(formData: FormData): Promise<string | null | "invalid"> {
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return null;
  if (!file.type.startsWith("image/")) return "invalid";
  try {
    const out = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(256, 256, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
    return `data:image/webp;base64,${out.toString("base64")}`;
  } catch {
    return "invalid";
  }
}

function venueFields(formData: FormData) {
  return {
    name: String(formData.get("name") || "").trim(),
    discount_text: String(formData.get("discountText") || "").trim() || null,
    notes: String(formData.get("notes") || "").trim() || null,
    sort_order: Number(formData.get("sortOrder")) || 0,
  };
}

export async function createVenueAction(formData: FormData) {
  await requireStaff();
  const fields = venueFields(formData);
  if (!fields.name) redirect("/membership/venues?error=name");
  const logo = await readLogo(formData);
  if (logo === "invalid") redirect("/membership/venues?error=logo");
  const { error } = await createAdminClient().from("partner_venues").insert({ ...fields, ...(logo ? { logo } : {}) });
  if (error) redirect(`/membership/venues?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/membership/venues");
  redirect("/membership/venues?saved=added");
}

export async function updateVenueAction(formData: FormData) {
  await requireStaff();
  const id = Number(formData.get("id"));
  if (!id) return;
  const fields = venueFields(formData);
  if (!fields.name) redirect("/membership/venues?error=name");
  const logo = await readLogo(formData);
  if (logo === "invalid") redirect("/membership/venues?error=logo");
  const { error } = await createAdminClient()
    .from("partner_venues")
    .update({
      ...fields,
      active: formData.get("active") === "on",
      ...(logo ? { logo } : formData.get("removeLogo") === "on" ? { logo: null } : {}),
    })
    .eq("id", id);
  if (error) redirect(`/membership/venues?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/membership/venues");
  redirect("/membership/venues?saved=updated");
}

/** "1 Greyhound point = Rp ..." - what the members site shows points are worth. Empty clears it. */
export async function setPointValueAction(formData: FormData) {
  await requireStaff();
  const raw = String(formData.get("pointValue") ?? "").trim();
  const admin = createAdminClient();
  if (raw === "") {
    await admin.from("assumptions").delete().eq("key", POINT_VALUE_KEY);
  } else {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) redirect("/membership?pointValue=invalid");
    const { data: existing } = await admin.from("assumptions").select("id").eq("key", POINT_VALUE_KEY).maybeSingle();
    const row = { value, label: "Membership: rupiah value of 1 Greyhound point", updated_at: new Date().toISOString() };
    const { error } = existing
      ? await admin.from("assumptions").update(row).eq("id", existing.id)
      : await admin.from("assumptions").insert({ key: POINT_VALUE_KEY, ...row });
    if (error) redirect(`/membership?pointValue=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/membership");
  redirect("/membership?pointValue=saved");
}

export async function deleteVenueAction(formData: FormData) {
  await requireStaff();
  const id = Number(formData.get("id"));
  if (id) await createAdminClient().from("partner_venues").delete().eq("id", id);
  revalidatePath("/membership/venues");
}

/**
 * "Sync from Odoo" on the Members page: refreshes every customer's points,
 * contact details and app link, and back-fills which customer each older
 * synced order belongs to (the daily cron skips that part - see
 * runLoyaltySync).
 */
export async function syncLoyaltyAction() {
  await requireStaff();
  let result: Awaited<ReturnType<typeof runLoyaltySync>>;
  try {
    result = await runLoyaltySync({ backfillOrders: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    redirect(`/membership?syncError=${encodeURIComponent(message.slice(0, 300))}`);
  }
  revalidatePath("/membership");
  redirect(
    `/membership?synced=${result.customers}&cards=${result.cards}&linked=${result.membersLinked}&orders=${result.ordersLinked}`,
  );
}
