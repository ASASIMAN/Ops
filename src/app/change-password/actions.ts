"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function changePasswordAction(formData: FormData) {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");

  if (password.length < 8) {
    redirect("/change-password?error=" + encodeURIComponent("Password must be at least 8 characters."));
  }
  if (password !== confirm) {
    redirect("/change-password?error=" + encodeURIComponent("Passwords don't match."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect("/change-password?error=" + encodeURIComponent(error.message));
  }

  // Regular users can only read their own profile row (RLS), not update it -
  // clearing the flag goes through the admin client instead.
  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.id);

  redirect("/hub");
}
