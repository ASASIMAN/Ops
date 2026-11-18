import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateMemberCode, MEMBER_COOKIE } from "./code";
import { getMemberByToken, type Member } from "./data";

/**
 * The members portal: members sign in with a one-time code emailed to
 * them, then see their card, QR and points. Served on its own host
 * (members.studioasasi.com - see middleware.ts) and at /portal on the main
 * app.
 *
 * Signed in = the same `asasi_member` cookie the QR sign-up already sets:
 * it holds the member's own access token (the secret behind their card
 * link), so a sign-up on a phone and a sign-in later are the same thing.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_CODES_PER_EMAIL = 3;
const MAX_CODES_PER_IP = 10;
const SESSION_DAYS = 365;
/** Which email a sign-in code was just sent to, between the two sign-in screens. */
export const PENDING_COOKIE = "asasi_member_pending";

/** members.studioasasi.com, or whatever MEMBERS_HOST is set to. */
export function isMembersHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(":")[0];
  const configured = process.env.MEMBERS_HOST?.toLowerCase().trim();
  return configured ? h === configured : h.startsWith("members.");
}

/** Links inside the portal: the members host serves it at the root, the main app under /portal. */
export async function portalPaths(): Promise<{ home: string; code: string }> {
  const h = await headers();
  const members = isMembersHost(h.get("x-forwarded-host") ?? h.get("host"));
  return members ? { home: "/", code: "/code" } : { home: "/portal", code: "/portal/code" };
}

export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200 ? email : null;
}

export async function getSignedInMember(): Promise<Member | null> {
  const token = (await cookies()).get(MEMBER_COOKIE)?.value;
  return token ? getMemberByToken(token) : null;
}

export async function signIn(accessToken: string) {
  const h = await headers();
  (await cookies()).set(MEMBER_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: (h.get("x-forwarded-proto") ?? "https") === "https",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
    path: "/",
  });
}

export async function getPendingEmail(): Promise<string | null> {
  return (await cookies()).get(PENDING_COOKIE)?.value ?? null;
}

export async function signOut() {
  (await cookies()).delete(MEMBER_COOKIE);
}

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** Keyed hash so a leaked table row can't be turned back into a working code. */
function hashCode(email: string, code: string): string {
  const key = process.env.MEMBER_CODE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) throw new Error("Neither MEMBER_CODE_SECRET nor SUPABASE_SERVICE_ROLE_KEY is set.");
  return createHmac("sha256", key).update(`${email}:${code}`).digest("hex");
}

type Identity =
  | { kind: "member"; member: Member }
  | { kind: "odoo"; partnerId: number; name: string; email: string; phone: string | null }
  | { kind: "ambiguous" }
  | null;

/**
 * Who an email belongs to: an app member first, otherwise an Odoo
 * customer holding a loyalty card (who gets an app card on first sign-in).
 * Two different Odoo loyalty customers sharing one email can't be told
 * apart from the email alone, so that's "ambiguous", never a guess.
 */
async function resolveIdentity(email: string): Promise<Identity> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_lookup", { p_email: email });
  if (error) return null;
  const rows = (data ?? []) as { member_id: string | null; odoo_partner_id: number | null; name: string | null; phone: string | null }[];

  const memberRow = rows.find((r) => r.member_id);
  if (memberRow) {
    const { data: member } = await admin.from("members").select("*").eq("id", memberRow.member_id).maybeSingle();
    if (member) return { kind: "member", member: member as Member };
  }
  const customers = rows.filter((r) => r.odoo_partner_id !== null);
  const ids = [...new Set(customers.map((c) => c.odoo_partner_id))];
  if (ids.length === 0) return null;
  if (ids.length > 1) return { kind: "ambiguous" };
  const c = customers[0];
  return { kind: "odoo", partnerId: c.odoo_partner_id!, name: c.name || "ASASI member", email, phone: c.phone };
}

async function sendCodeEmail(email: string, code: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MEMBERS_EMAIL_FROM || "ASASI <members@studioasasi.com>";
  if (!key) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[members portal] sign-in code for ${email}: ${code} (RESEND_API_KEY not set - not emailed)`);
      return true;
    }
    console.error("[members portal] RESEND_API_KEY is not set - sign-in codes can't be emailed.");
    return false;
  }
  const text = `Your ASASI sign-in code is ${code}\n\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email.`;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#1c1c1c;max-width:420px">
<p style="letter-spacing:.18em;font-size:12px;text-transform:uppercase;margin:0 0 24px">ASASI Membership</p>
<p style="margin:0 0 8px">Your sign-in code is</p>
<p style="font-size:32px;letter-spacing:.3em;margin:0 0 24px;color:#1c2b10">${code}</p>
<p style="font-size:13px;color:#6b6b6b;margin:0">It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p>
</div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: `${code} is your ASASI sign-in code`, text, html }),
      cache: "no-store",
    });
    if (!res.ok) console.error(`[members portal] email send failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
    return res.ok;
  } catch (error) {
    console.error("[members portal] email send failed:", error);
    return false;
  }
}

export type RequestResult = "sent" | "invalid" | "limited" | "email_failed";

/**
 * Sends a sign-in code if the email belongs to a member. The answer is the
 * same either way ("sent"), so the portal can't be used to find out who is
 * a member; only a member actually receives an email.
 */
export async function requestCode(rawEmail: string): Promise<RequestResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return "invalid";
  const admin = createAdminClient();
  const ip = await clientIp();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const [byEmail, byIp] = await Promise.all([
    admin.from("member_login_codes").select("*", { count: "exact", head: true }).eq("email", email).gte("created_at", since),
    ip
      ? admin.from("member_login_codes").select("*", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since)
      : Promise.resolve({ count: 0, error: null }),
  ]);
  if (byEmail.error) throw new Error(`Run supabase/migrations/0042_member_portal.sql: ${byEmail.error.message}`);
  if ((byEmail.count ?? 0) >= MAX_CODES_PER_EMAIL || (byIp.count ?? 0) >= MAX_CODES_PER_IP) return "limited";

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await admin.from("member_login_codes").insert({
    email,
    code_hash: hashCode(email, code),
    ip,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`Couldn't save the sign-in code: ${error.message}`);

  const identity = await resolveIdentity(email);
  if (identity && identity.kind !== "ambiguous") {
    if (!(await sendCodeEmail(email, code))) return "email_failed";
  }
  return "sent";
}

export type VerifyResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "invalid" | "expired" | "attempts" | "ambiguous" | "not_member" };

export async function verifyCode(rawEmail: string, rawCode: string): Promise<VerifyResult> {
  const email = normalizeEmail(rawEmail);
  const code = rawCode.replace(/\D/g, "");
  if (!email || code.length !== 6) return { ok: false, reason: "invalid" };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("member_login_codes")
    .select("id, code_hash, attempts, expires_at")
    .eq("email", email)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "attempts" };

  // Spend the try first (atomically), then compare.
  const { data: allowed, error: takeError } = await admin.rpc("portal_take_attempt", { p_id: row.id, p_max: MAX_ATTEMPTS });
  if (takeError) throw new Error(`Run supabase/migrations/0042_member_portal.sql: ${takeError.message}`);
  if (!allowed) return { ok: false, reason: "attempts" };

  const expected = Buffer.from(row.code_hash, "hex");
  const given = Buffer.from(hashCode(email, code), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: row.attempts + 1 >= MAX_ATTEMPTS ? "attempts" : "invalid" };
  }
  // A code signs in once: if a parallel request already used it, this one doesn't.
  const { data: claimed } = await admin
    .from("member_login_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id");
  if (!claimed?.length) return { ok: false, reason: "expired" };

  const identity = await resolveIdentity(email);
  if (!identity) return { ok: false, reason: "not_member" };
  if (identity.kind === "ambiguous") return { ok: false, reason: "ambiguous" };

  let member: Member | null = identity.kind === "member" ? identity.member : null;
  if (identity.kind === "odoo") {
    // First sign-in of an Odoo loyalty customer: give them an app card.
    for (let attempt = 0; attempt < 5 && !member; attempt++) {
      const { data, error } = await admin
        .from("members")
        .insert({
          code: generateMemberCode(),
          full_name: identity.name,
          email: identity.email,
          phone: identity.phone,
          signup_source: "portal",
          odoo_partner_id: identity.partnerId,
        })
        .select("*")
        .single();
      if (data) member = data as Member;
      else if (error && !error.message.includes("members_code_key")) {
        // Created a moment ago by a parallel sign-in - use that one.
        const { data: existing } = await admin.from("members").select("*").eq("odoo_partner_id", identity.partnerId).maybeSingle();
        if (existing) member = existing as Member;
        else throw new Error(`Couldn't create the member card: ${error.message}`);
      }
    }
    if (!member) return { ok: false, reason: "not_member" };
  } else if (member && !member.odoo_partner_id) {
    // A QR sign-up whose Odoo customer may exist by now: try to match them.
    await admin.rpc("link_members_to_odoo");
  }

  await admin.from("members").update({ last_seen_at: new Date().toISOString() }).eq("id", member!.id);
  return { ok: true, accessToken: member!.access_token };
}
