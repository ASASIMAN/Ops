"use server";

import { redirect } from "next/navigation";
import { lookupMember, portalPaths as paths, signIn, signOut } from "@/lib/membership/portal";

export async function lookupAction(formData: FormData) {
  const p = await paths();
  // Honeypot: real people never fill the hidden field.
  if (String(formData.get("website") || "")) redirect(p.home);

  let result;
  try {
    result = await lookupMember(String(formData.get("email") || ""));
  } catch (error) {
    console.error("[members portal] lookup failed:", error);
    redirect(`${p.home}?error=failed`);
  }
  if (!result.ok) redirect(`${p.home}?error=${result.reason}`);

  await signIn(result.accessToken);
  redirect(p.home);
}

export async function signOutAction() {
  const p = await paths();
  await signOut();
  redirect(p.home);
}
