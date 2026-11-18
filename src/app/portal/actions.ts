"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  PENDING_COOKIE,
  normalizeEmail,
  portalPaths as paths,
  requestCode,
  signIn,
  signOut,
  verifyCode,
} from "@/lib/membership/portal";

export async function requestCodeAction(formData: FormData) {
  const p = await paths();
  const raw = String(formData.get("email") || "");
  // Honeypot: real people never fill the hidden field.
  if (String(formData.get("website") || "")) redirect(p.home);

  let result;
  try {
    result = await requestCode(raw);
  } catch (error) {
    console.error("[members portal] code request failed:", error);
    redirect(`${p.home}?error=failed`);
  }
  if (result === "invalid") redirect(`${p.home}?error=email`);
  if (result === "limited") redirect(`${p.home}?error=limited`);
  if (result === "email_failed") redirect(`${p.home}?error=send`);

  // Remember which email the code went to for the next screen, without
  // putting the address in the URL (and so in browser history).
  const h = await headers();
  (await cookies()).set(PENDING_COOKIE, normalizeEmail(raw)!, {
    httpOnly: true,
    sameSite: "lax",
    secure: (h.get("x-forwarded-proto") ?? "https") === "https",
    maxAge: 15 * 60,
    path: "/",
  });
  redirect(p.code);
}

export async function verifyCodeAction(formData: FormData) {
  const p = await paths();
  const jar = await cookies();
  const email = jar.get(PENDING_COOKIE)?.value;
  if (!email) redirect(`${p.home}?error=expired`);

  let result;
  try {
    result = await verifyCode(email, String(formData.get("code") || ""));
  } catch (error) {
    console.error("[members portal] code check failed:", error);
    redirect(`${p.code}?error=failed`);
  }
  if (!result.ok) redirect(`${p.code}?error=${result.reason}`);

  jar.delete(PENDING_COOKIE);
  await signIn(result.accessToken);
  redirect(p.home);
}

export async function signOutAction() {
  const p = await paths();
  await signOut();
  redirect(p.home);
}
