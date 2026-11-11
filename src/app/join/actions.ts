"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateMemberCode, MEMBER_COOKIE } from "@/lib/membership/code";

export async function joinAction(formData: FormData) {
  // Honeypot: real people never fill the hidden field.
  if (String(formData.get("website") || "")) redirect("/join");

  const fullName = String(formData.get("fullName") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const phone = String(formData.get("phone") || "").trim() || null;
  const optIn = formData.get("marketingOptIn") === "on";
  const source = String(formData.get("source") || "").trim().slice(0, 40) || null;

  if (!fullName || fullName.length > 120) redirect("/join?error=name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    redirect("/join?error=email");
  }

  const admin = createAdminClient();
  let token: string | null = null;

  for (let attempt = 0; attempt < 5 && !token; attempt++) {
    const { data, error } = await admin
      .from("members")
      .insert({
        code: generateMemberCode(),
        full_name: fullName,
        email,
        phone,
        marketing_opt_in: optIn,
        signup_source: source,
      })
      .select("access_token")
      .single();

    if (data) {
      token = data.access_token;
    } else if (error?.message.includes("members_email_lower_idx")) {
      redirect("/join?error=exists");
    } else if (!error?.message.includes("members_code_key")) {
      console.error("join failed", error);
      redirect("/join?error=failed");
    }
  }
  if (!token) redirect("/join?error=failed");

  const jar = await cookies();
  const h = await headers();
  jar.set(MEMBER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: h.get("x-forwarded-proto") === "https",
    maxAge: 60 * 60 * 24 * 365 * 2,
    path: "/",
  });

  redirect(`/member/${token}`);
}
