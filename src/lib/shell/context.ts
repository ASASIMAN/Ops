import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface ShellContext {
  email: string | null;
  role: string;
}

/**
 * Who is signed in and what role they hold. Wrapped in React's `cache` so
 * the sidebar, the top bar and the page itself can all ask during one
 * request and only the first call reaches Supabase.
 */
export const getShellContext = cache(async (): Promise<ShellContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { email: null, role: "viewer" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  return { email: user.email ?? null, role: profile?.role ?? "viewer" };
});

/** Today's calendar date in Bali (WITA), as YYYY-MM-DD - the day boundary every sales rollup in this app uses. */
export function baliToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(now);
}
