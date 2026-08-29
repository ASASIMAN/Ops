import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import modules from "@config/modules.json";

export const dynamic = "force-dynamic";

interface ModuleConfig {
  id: string;
  title: string;
  description: string;
  route: string;
  roles: string[];
  status: "live" | "coming_soon";
}

async function getOperationsStats() {
  const supabase = createAdminClient();
  const [{ count: lineCount }, { data: lastSync }] = await Promise.all([
    supabase.from("order_lines").select("*", { count: "exact", head: true }),
    supabase
      .from("sync_runs")
      .select("status, started_at")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return [
    `${(lineCount ?? 0).toLocaleString()} synced sale lines`,
    lastSync
      ? `Last sync: ${lastSync.status} (${new Date(lastSync.started_at).toLocaleDateString()})`
      : "Never synced",
  ];
}

async function getMarketingStats() {
  const supabase = createAdminClient();
  const [{ data: latestSpend }, { count: adCount }] = await Promise.all([
    supabase
      .from("facts_daily")
      .select("value")
      .eq("source", "financials_sheet")
      .eq("metric", "total_spend_idr")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("ads").select("*", { count: "exact", head: true }),
  ]);

  const currency = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });

  return [
    latestSpend
      ? `${currency.format(Number(latestSpend.value))} spend, latest month`
      : "No spend data yet",
    `${adCount ?? 0} ads tracked`,
  ];
}

export default async function HubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };

  const role = profile?.role ?? "viewer";

  const visibleModules = (modules as ModuleConfig[]).filter((m) =>
    m.roles.includes(role),
  );

  const stats: Record<string, string[]> = {};
  if (visibleModules.some((m) => m.id === "operations")) {
    stats.operations = await getOperationsStats();
  }
  if (visibleModules.some((m) => m.id === "marketing")) {
    stats.marketing = await getMarketingStats();
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-20">
      <h1 className="text-2xl font-semibold tracking-tight">ASASI</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Pick a workspace.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {visibleModules.map((mod) => (
          <Link
            key={mod.id}
            href={mod.route}
            className="rounded-lg border border-zinc-200 p-6 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">{mod.title}</h2>
              {mod.status === "coming_soon" && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                  Coming soon
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {mod.description}
            </p>
            {stats[mod.id] && (
              <ul className="mt-4 space-y-0.5 text-xs text-zinc-500">
                {stats[mod.id].map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
