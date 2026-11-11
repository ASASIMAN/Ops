import Link from "next/link";
import { getStaffUser } from "@/lib/membership/data";
import { appleWalletConfigured } from "@/lib/membership/wallet-apple";
import { googleWalletConfigured } from "@/lib/membership/wallet-google";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupMemberAction, setMemberStatusAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const staff = await getStaffUser();
  if (!staff) {
    return <p className="p-8 text-sm text-zinc-500">You don&apos;t have access to Membership.</p>;
  }

  const admin = createAdminClient();
  let query = admin.from("members").select("*").order("created_at", { ascending: false }).limit(100);
  if (q) {
    const term = q.replace(/[%,()]/g, " ").trim();
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,code.ilike.%${term}%`);
  }
  const [{ data: members }, { count: total }, { data: pts }] = await Promise.all([
    query,
    admin.from("members").select("*", { count: "exact", head: true }),
    admin.from("members").select("points_balance"),
  ]);
  const outstanding = (pts ?? []).reduce((s, m) => s + m.points_balance, 0);

  const nav = "rounded border border-zinc-300 px-3 py-1.5 text-sm hover:border-zinc-500 dark:border-zinc-700";

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Membership</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/membership/scan" className={nav}>Scan a member</Link>
          <Link href="/membership/venues" className={nav}>Partner venues</Link>
          <Link href="/membership/tent-card" className={nav}>Print tent card</Link>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Members" value={(total ?? 0).toLocaleString()} />
        <Stat label="Points outstanding" value={outstanding.toLocaleString()} />
        <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <p className="text-zinc-500">Wallet passes</p>
          <p>Apple Wallet: {appleWalletConfigured() ? "✓ on" : "not set up"}</p>
          <p>Google Wallet: {googleWalletConfigured() ? "✓ on" : "not set up"}</p>
        </div>
      </div>

      <form action={lookupMemberAction} className="mt-6 flex gap-2">
        <input name="code" placeholder="Member code (e.g. K7Q2-M9XA)" className="w-64 rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-transparent" />
        <button className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900">Open member</button>
      </form>

      <form className="mt-6">
        <input name="q" defaultValue={q} placeholder="Search name, email or code" className="w-full max-w-sm rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-transparent" />
      </form>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="py-2 pr-4">Member</th><th className="pr-4">Code</th>
              <th className="pr-4">Contact</th><th className="pr-4 text-right">Points</th>
              <th className="pr-4">Joined</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) => (
              <tr key={m.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-4">
                  {m.full_name}
                  {m.status === "suspended" && <span className="ml-2 text-xs text-red-600">suspended</span>}
                </td>
                <td className="pr-4 font-mono"><Link href={`/v/${m.code}`} className="underline">{m.code}</Link></td>
                <td className="pr-4 text-zinc-500">{m.email}{m.phone ? ` · ${m.phone}` : ""}</td>
                <td className="pr-4 text-right tabular-nums">{m.points_balance.toLocaleString()}</td>
                <td className="pr-4 text-zinc-500">{new Date(m.created_at).toLocaleDateString()}</td>
                <td>
                  <form action={setMemberStatusAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="status" value={m.status === "active" ? "suspended" : "active"} />
                    <button className="text-xs text-zinc-500 underline">{m.status === "active" ? "Suspend" : "Reactivate"}</button>
                  </form>
                </td>
              </tr>
            ))}
            {(members ?? []).length === 0 && (
              <tr><td colSpan={6} className="py-6 text-zinc-500">No members yet - print the tent card and put it out.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
