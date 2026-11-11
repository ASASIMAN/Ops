import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface Member {
  id: string;
  code: string;
  access_token: string;
  full_name: string;
  email: string;
  phone: string | null;
  marketing_opt_in: boolean;
  status: "active" | "suspended";
  points_balance: number;
  lifetime_points: number;
  created_at: string;
}

export interface PartnerVenue {
  id: number;
  name: string;
  discount_text: string;
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
