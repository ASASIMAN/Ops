import { createClient } from "@/lib/supabase/server";

async function getSupabaseStatus() {
  const configured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!configured) {
    return { configured, connected: false };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.getSession();
    return { configured, connected: !error };
  } catch {
    return { configured, connected: false };
  }
}

export async function StatusCard() {
  const { configured, connected } = await getSupabaseStatus();

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-medium">Supabase</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {configured && connected && "Connected."}
        {configured &&
          !connected &&
          "Env vars are set, but the connection failed. Double-check the URL and anon key."}
        {!configured &&
          "Not configured yet. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."}
      </p>
    </div>
  );
}
