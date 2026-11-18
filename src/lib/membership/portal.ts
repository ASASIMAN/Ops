import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateMemberCode, MEMBER_COOKIE } from "./code";
import { getMemberByToken, type Member } from "./data";

/**
 * The members portal: a member types their email and sees their card, QR
 * and points. No password or emailed code - points can't be spent online,
 * so there's nothing to protect beyond the balance itself. Served on its
 * own host (members.studioasasi.com - see middleware.ts) and at /portal on
 * the main app.
 *
 * Once found, the member is remembered on that phone with the same
 * `asasi_member` cookie the in-store QR sign-up sets (it holds the member's
 * card link token), so next time their card opens straight away.
 */

const WINDOW_MS = 15 * 60 * 1000;
/** Email lookups per network address per 15 minutes - plenty for a family, too few to read through a list. */
const MAX_LOOKUPS_PER_IP = 30;
const REMEMBER_DAYS = 365;

/** members.studioasasi.com, or whatever MEMBERS_HOST is set to. */
export function isMembersHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(":")[0];
  const configured = process.env.MEMBERS_HOST?.toLowerCase().trim();
  return configured ? h === configured : h.startsWith("members.");
}

/** Links inside the portal: the members host serves it at the root, the main app under /portal. */
export async function portalPaths(): Promise<{ home: string }> {
  const h = await headers();
  return { home: isMembersHost(h.get("x-forwarded-host") ?? h.get("host")) ? "/" : "/portal" };
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
    maxAge: 60 * 60 * 24 * REMEMBER_DAYS,
    path: "/",
  });
}

export async function signOut() {
  (await cookies()).delete(MEMBER_COOKIE);
}

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

type Identity =
  | { kind: "member"; member: Member }
  | { kind: "odoo"; partnerId: number; name: string; email: string; phone: string | null }
  | { kind: "ambiguous" }
  | null;

/**
 * Who an email belongs to: an app member first, otherwise an Odoo
 * customer holding a loyalty card (who gets an app card on first lookup).
 * Two different Odoo loyalty customers sharing one email can't be told
 * apart from the email alone, so that's "ambiguous", never a guess.
 */
async function resolveIdentity(email: string): Promise<Identity> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_lookup", { p_email: email });
  if (error) throw new Error(`Run supabase/migrations/0042_member_portal.sql: ${error.message}`);
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

export type LookupResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "invalid" | "limited" | "not_found" | "ambiguous" };

/**
 * Finds the member an email belongs to. An Odoo loyalty customer who never
 * scanned the in-store QR gets an app card (member number + QR) the first
 * time they look themselves up.
 */
export async function lookupMember(rawEmail: string): Promise<LookupResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, reason: "invalid" };
  const admin = createAdminClient();
  const ip = await clientIp();

  if (ip) {
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count, error } = await admin
      .from("member_lookups")
      .select("*", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", since);
    if (error) throw new Error(`Run supabase/migrations/0043_member_email_lookup.sql: ${error.message}`);
    if ((count ?? 0) >= MAX_LOOKUPS_PER_IP) return { ok: false, reason: "limited" };
  }

  const identity = await resolveIdentity(email);
  await admin.from("member_lookups").insert({ ip, found: Boolean(identity && identity.kind !== "ambiguous") });
  // Keep the table small: now and then, clear out lookups older than 30 days.
  if (Math.random() < 0.02) {
    await admin.from("member_lookups").delete().lt("created_at", new Date(Date.now() - 30 * 86400000).toISOString());
  }

  if (!identity) return { ok: false, reason: "not_found" };
  if (identity.kind === "ambiguous") return { ok: false, reason: "ambiguous" };

  let member: Member | null = identity.kind === "member" ? identity.member : null;
  if (identity.kind === "odoo") {
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
        // Created a moment ago by a parallel lookup - use that one.
        const { data: existing } = await admin.from("members").select("*").eq("odoo_partner_id", identity.partnerId).maybeSingle();
        if (existing) member = existing as Member;
        else throw new Error(`Couldn't create the member card: ${error.message}`);
      }
    }
    if (!member) return { ok: false, reason: "not_found" };
  } else if (member && !member.odoo_partner_id) {
    // An in-store QR sign-up whose Odoo customer may exist by now: try to match them.
    await admin.rpc("link_members_to_odoo");
  }

  return { ok: true, accessToken: member!.access_token };
}
