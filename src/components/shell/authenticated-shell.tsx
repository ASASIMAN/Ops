import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/shell/sign-out-button";

/**
 * Shared chrome for every page behind auth (hub, operations, marketing).
 * Auth and the forced-password-change redirect are handled in middleware,
 * not here - this component only renders, it doesn't gate.
 */
export async function AuthenticatedShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    role = profile?.role ?? null;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link
            href="/hub"
            className="text-sm font-semibold tracking-tight hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            ASASI
          </Link>
          <div className="flex items-center gap-4 text-sm text-zinc-500">
            {user && (
              <span>
                {user.email}
                {role && <span className="ml-1 text-zinc-400">({role})</span>}
              </span>
            )}
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
