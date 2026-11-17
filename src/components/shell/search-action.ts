"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getShellContext } from "@/lib/shell/context";
import { canAccessModule } from "./nav-config";

export interface SearchHit {
  group: string;
  label: string;
  detail?: string;
  href: string;
}

/**
 * Record search behind the top-bar search box: products, members,
 * campaigns, KOLs, ads and tasks, limited to the sections the signed-in
 * user's role can open. (Matching the app's own pages by name happens in the
 * browser - see command-palette.tsx.)
 */
export async function globalSearchAction(rawQuery: string): Promise<SearchHit[]> {
  const { email, role } = await getShellContext();
  if (!email) return [];

  // The term is spliced into PostgREST `or=(...)` filters, where commas,
  // brackets and quotes are syntax - drop them rather than try to escape.
  const term = String(rawQuery ?? "")
    .replace(/[%*,()"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (term.length < 2) return [];
  const like = `%${term}%`;

  const admin = createAdminClient();
  const hits: SearchHit[] = [];
  const jobs: PromiseLike<void>[] = [];

  if (canAccessModule(role, "operations")) {
    jobs.push(
      admin
        .from("products")
        .select("name, sku")
        .or(`name.ilike.${like},sku.ilike.${like}`)
        .limit(60)
        .then(({ data }) => {
          const seen = new Set<string>();
          for (const p of data ?? []) {
            if (seen.has(p.name) || seen.size >= 6) continue;
            seen.add(p.name);
            hits.push({
              group: "Products",
              label: p.name,
              href: `/sales/products?product=${encodeURIComponent(p.name)}`,
            });
          }
        }),
    );
  }

  if (canAccessModule(role, "membership")) {
    jobs.push(
      admin
        .from("members")
        .select("code, full_name, email")
        .or(`full_name.ilike.${like},email.ilike.${like},code.ilike.${like}`)
        .limit(6)
        .then(({ data }) => {
          for (const m of data ?? []) {
            hits.push({
              group: "Members",
              label: m.full_name,
              detail: m.code,
              href: `/membership?q=${encodeURIComponent(m.code)}`,
            });
          }
        }),
    );
  }

  if (canAccessModule(role, "marketing")) {
    jobs.push(
      admin
        .from("campaigns")
        .select("id, name, status")
        .ilike("name", like)
        .limit(6)
        .then(({ data }) => {
          for (const c of data ?? []) {
            hits.push({
              group: "Campaigns",
              label: c.name,
              detail: c.status,
              href: `/marketing/campaigns/${c.id}`,
            });
          }
        }),
      admin
        .from("kols")
        .select("id, name, social_handle, status")
        .or(`name.ilike.${like},social_handle.ilike.${like}`)
        .limit(6)
        .then(({ data }) => {
          for (const k of data ?? []) {
            hits.push({
              group: "KOLs",
              label: k.name || k.social_handle || "Unnamed",
              detail: k.status,
              href: "/marketing/kols",
            });
          }
        }),
      admin
        .from("ads")
        .select("id, ad_name, ad_set_name")
        .ilike("ad_name", like)
        .limit(6)
        .then(({ data }) => {
          for (const a of data ?? []) {
            hits.push({
              group: "Ads",
              label: a.ad_name,
              detail: a.ad_set_name,
              href: "/marketing/paid-media",
            });
          }
        }),
      admin
        .from("tasks")
        .select("id, title, status")
        .ilike("title", like)
        .limit(6)
        .then(({ data }) => {
          for (const t of data ?? []) {
            hits.push({
              group: "Tasks",
              label: t.title,
              detail: t.status.replace("_", " "),
              href: "/marketing/tasks",
            });
          }
        }),
    );
  }

  await Promise.all(jobs);
  const order = ["Products", "Members", "Campaigns", "KOLs", "Ads", "Tasks"];
  return hits.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}
