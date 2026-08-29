"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_CHECKLIST = [
  "E-flyer",
  "E-invitation",
  "PR package to 10 KOLs",
];

export async function createActivationAction(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) return;

  const checklist = DEFAULT_CHECKLIST.map((label) => ({ label, done: false }));

  const admin = createAdminClient();
  await admin.from("activations").insert({
    name,
    type: String(formData.get("type") || "").trim() || null,
    period_start: String(formData.get("periodStart") || "").trim() || null,
    period_end: String(formData.get("periodEnd") || "").trim() || null,
    prize: String(formData.get("prize") || "").trim() || null,
    entry_mechanic: String(formData.get("entryMechanic") || "").trim() || null,
    checklist,
  });

  revalidatePath("/marketing/creative/activations");
  redirect("/marketing/creative/activations");
}

export async function toggleChecklistItemAction(formData: FormData) {
  const id = Number(formData.get("id"));
  const index = Number(formData.get("index"));
  if (!id || Number.isNaN(index)) return;

  const admin = createAdminClient();
  const { data: activation } = await admin
    .from("activations")
    .select("checklist")
    .eq("id", id)
    .maybeSingle();

  if (!activation) return;

  const checklist = (activation.checklist as { label: string; done: boolean }[]).map(
    (item, i) => (i === index ? { ...item, done: !item.done } : item),
  );

  await admin.from("activations").update({ checklist }).eq("id", id);
  revalidatePath("/marketing/creative/activations");
}
