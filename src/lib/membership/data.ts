import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** "Jane Doe" -> "Jane D.": what member-facing and partner pages show. */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return lastInitial ? `${parts[0]} ${lastInitial}.` : parts[0];
}

export interface Member {
  id: string;
  code: string;
  access_token: string;
  full_name: string;
  email: string;
  phone: string | null;
  marketing_opt_in: boolean;
  status: "active" | "suspended";
  /** Points added in the app by staff. A member linked to Odoo also has their Odoo loyalty balance - see fetchOdooPoints. */
  points_balance: number;
  lifetime_points: number;
  /** Their Odoo customer, once matched (migration 0041); undefined before that migration is run. */
  odoo_partner_id?: number | null;
  created_at: string;
}

export interface PartnerVenue {
  id: number;
  name: string;
  /** What members get, e.g. "10% off the bill" - empty until agreed. */
  discount_text: string | null;
  /** Small square logo as a data: URL (migration 0044). */
  logo: string | null;
  notes: string | null;
  active: boolean;
  sort_order: number;
}

export const STAFF_ROLES = ["admin", "ops", "marketing"];

export async function getMemberByToken(token: string): Promise<Member | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data } = await createAdminClient()
    .from("members").select("*").eq("access_token", token).maybeSingle();
  return data as Member | null;
}

export async function getMemberByCode(code: string): Promise<Member | null> {
  const { data } = await createAdminClient()
    .from("members").select("*").eq("code", code).maybeSingle();
  return data as Member | null;
}

export async function getActiveVenues(): Promise<PartnerVenue[]> {
  const { data } = await createAdminClient()
    .from("partner_venues").select("*").eq("active", true)
    .order("sort_order").order("name");
  return (data ?? []) as PartnerVenue[];
}

export async function getIdrPerPoint(): Promise<number> {
  const { data } = await createAdminClient()
    .from("assumptions").select("value").eq("key", "membership_idr_per_point").maybeSingle();
  return Number(data?.value) > 0 ? Number(data!.value) : 10000;
}

/** What members call their points. */
export const POINTS_NAME = "Greyhound points";

/** assumptions key: the rupiah value of 1 Greyhound point, set on the Members page. */
export const POINT_VALUE_KEY = "membership_point_value_idr";

/** What 1 Greyhound point is worth in rupiah - null until staff set it (never guessed). */
export async function getPointValueIdr(): Promise<number | null> {
  const { data } = await createAdminClient().from("assumptions").select("value").eq("key", POINT_VALUE_KEY).maybeSingle();
  const value = Number(data?.value);
  return value > 0 ? value : null;
}

/** The signed-in staff user, if they hold a role allowed to run the till tools. */
export async function getStaffUser(): Promise<{ id: string; email: string; role: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  const role = profile?.role ?? "";
  if (!STAFF_ROLES.includes(role)) return null;
  return { id: user.id, email: user.email ?? "", role };
}
