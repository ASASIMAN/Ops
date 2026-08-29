"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function createTaskAction(formData: FormData) {
  const title = String(formData.get("title") || "").trim();
  if (!title) return;

  const assignToMe = formData.get("assignToMe") === "on";
  let ownerUserId: string | null = null;
  let ownerName = String(formData.get("ownerName") || "").trim() || null;

  if (assignToMe) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      ownerUserId = user.id;
      ownerName = user.email ?? ownerName;
    }
  }

  const admin = createAdminClient();
  await admin.from("tasks").insert({
    title,
    description: String(formData.get("description") || "").trim() || null,
    owner_user_id: ownerUserId,
    owner_name: ownerName,
    due_date: String(formData.get("dueDate") || "").trim() || null,
    priority: String(formData.get("priority") || "medium"),
    link_type: String(formData.get("linkType") || "").trim() || null,
    link_id: formData.get("linkId") ? Number(formData.get("linkId")) : null,
    link_label: String(formData.get("linkLabel") || "").trim() || null,
  });

  const returnTo = String(formData.get("returnTo") || "/marketing/tasks");
  revalidatePath(returnTo);
  redirect(returnTo);
}

export async function updateTaskStatusAction(formData: FormData) {
  const id = Number(formData.get("id"));
  const status = String(formData.get("status") || "");
  const returnTo = String(formData.get("returnTo") || "/marketing/tasks");
  if (!id || !status) return;

  const admin = createAdminClient();
  await admin.from("tasks").update({ status }).eq("id", id);

  revalidatePath(returnTo);
  redirect(returnTo);
}
