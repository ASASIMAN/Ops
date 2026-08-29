"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export async function createAdminAction(formData: FormData) {
  const setupKey = String(formData.get("setupKey") || "");
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");

  const fail = (message: string) =>
    redirect(`/setup?error=${encodeURIComponent(message)}`);

  if (!process.env.SETUP_SECRET || setupKey !== process.env.SETUP_SECRET) {
    fail("Wrong setup key.");
  }

  const admin = createAdminClient();

  const { count } = await admin
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("role", "admin");

  if ((count ?? 0) > 0) {
    fail("An admin account already exists - go to /login instead.");
  }

  if (password.length < 8) {
    fail("Password must be at least 8 characters.");
  }

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (createError || !created.user) {
    fail(createError?.message ?? "Could not create the user.");
    return;
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    email,
    role: "admin",
    must_change_password: false,
  });

  if (profileError) {
    fail(profileError.message);
  }

  redirect("/login");
}
