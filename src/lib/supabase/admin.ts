import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS - server-only, never import
 * this from a Client Component. Used by the Odoo sync job and by the
 * dashboard's server-side data fetching, since sales data has no anonymous
 * read policy on purpose (see supabase/migrations/0001_sales_schema.sql).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
