import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Members section's data: one row per person, merging Odoo loyalty
 * customers (points kept by the till) with the app's own QR sign-ups. See
 * migration 0041 (membership_directory / membership_summary).
 */

export const LOYALTY_MIGRATION = "supabase/migrations/0041_odoo_loyalty.sql";

export type DirectoryView = "all" | "linked" | "odoo_only" | "app_only";
export type DirectorySort = "points" | "spend" | "recent" | "name";

export interface DirectoryRow {
  odooPartnerId: number | null;
  memberId: string | null;
  memberCode: string | null;
  memberStatus: "active" | "suspended" | null;
  name: string;
  email: string | null;
  phone: string | null;
  /** null = not an Odoo loyalty customer. */
  odooPoints: number | null;
  /** null = not signed up in the app. */
  appPoints: number | null;
  programs: string | null;
  joinedAppAt: string | null;
  orderCount: number;
  spend: number;
  lastOrderAt: string | null;
}

export interface Summary {
  odooCustomers: number;
  odooPoints: number;
  appMembers: number;
  linkedMembers: number;
  appOnlyPoints: number;
  customersWithOrders: number;
}

type Failure = { ok: false; missing: boolean; error: string };

function failure(error: { code?: string; message: string }): Failure {
  return {
    ok: false,
    missing:
      error.code === "PGRST202" ||
      error.code === "42883" ||
      error.code === "42P01" ||
      /could not find the function|does not exist/i.test(error.message),
    error: error.message,
  };
}

export async function fetchDirectory(
  admin: SupabaseClient,
  opts: { search?: string; view: DirectoryView; sort: DirectorySort; limit: number; offset: number },
): Promise<{ ok: true; rows: DirectoryRow[]; total: number } | Failure> {
  const { data, error } = await admin.rpc("membership_directory", {
    p_search: opts.search?.trim() || null,
    p_view: opts.view,
    p_sort: opts.sort,
    p_limit: opts.limit,
    p_offset: opts.offset,
  });
  if (error) return failure(error);
  const raw = (data ?? []) as Record<string, unknown>[];
  return {
    ok: true,
    total: raw.length ? Number(raw[0].total_rows) : 0,
    rows: raw.map((r) => ({
      odooPartnerId: r.odoo_partner_id === null ? null : Number(r.odoo_partner_id),
      memberId: (r.member_id as string | null) ?? null,
      memberCode: (r.member_code as string | null) ?? null,
      memberStatus: (r.member_status as DirectoryRow["memberStatus"]) ?? null,
      name: String(r.name ?? ""),
      email: (r.email as string | null) ?? null,
      phone: (r.phone as string | null) ?? null,
      odooPoints: r.odoo_points === null ? null : Number(r.odoo_points),
      appPoints: r.app_points === null ? null : Number(r.app_points),
      programs: (r.programs as string | null) ?? null,
      joinedAppAt: (r.joined_app_at as string | null) ?? null,
      orderCount: Number(r.order_count ?? 0),
      spend: Number(r.spend ?? 0),
      lastOrderAt: (r.last_order_at as string | null) ?? null,
    })),
  };
}

export async function fetchSummary(admin: SupabaseClient): Promise<{ ok: true; data: Summary } | Failure> {
  const { data, error } = await admin.rpc("membership_summary");
  if (error) return failure(error);
  const r = ((data ?? []) as Record<string, unknown>[])[0] ?? {};
  return {
    ok: true,
    data: {
      odooCustomers: Number(r.odoo_customers ?? 0),
      odooPoints: Number(r.odoo_points ?? 0),
      appMembers: Number(r.app_members ?? 0),
      linkedMembers: Number(r.linked_members ?? 0),
      appOnlyPoints: Number(r.app_only_points ?? 0),
      customersWithOrders: Number(r.customers_with_orders ?? 0),
    },
  };
}

export interface LoyaltySyncStatus {
  status: string;
  startedAt: string;
  errorMessage: string | null;
}

export async function fetchLastLoyaltySync(admin: SupabaseClient): Promise<{
  last: LoyaltySyncStatus | null;
  lastSuccess: LoyaltySyncStatus | null;
}> {
  const { data } = await admin
    .from("sync_runs")
    .select("status, started_at, error_message")
    .eq("sync_type", "loyalty")
    .order("started_at", { ascending: false })
    .limit(20);
  const rows = (data ?? []).map((r) => ({ status: r.status, startedAt: r.started_at, errorMessage: r.error_message }));
  return { last: rows[0] ?? null, lastSuccess: rows.find((r) => r.status === "success") ?? null };
}

/** Odoo points for one linked member: the sum over their loyalty cards, or null if none. */
export async function fetchOdooPoints(
  admin: SupabaseClient,
  odooPartnerId: number,
): Promise<{ points: number; programs: string[] } | null> {
  const { data, error } = await admin
    .from("loyalty_cards")
    .select("points, loyalty_programs ( name )")
    .eq("odoo_partner_id", odooPartnerId);
  if (error || !data || !data.length) return null;
  const rows = data as unknown as { points: number; loyalty_programs: { name: string } | null }[];
  return {
    points: rows.reduce((sum, r) => sum + Number(r.points), 0),
    programs: [...new Set(rows.map((r) => r.loyalty_programs?.name).filter((n): n is string => Boolean(n)))],
  };
}

/** "1,250" or "12.5" - Odoo points can be fractional. */
export function formatPoints(points: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(points);
}
