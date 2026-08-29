import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createKolAction, updateKolStatusAction } from "./actions";

export const dynamic = "force-dynamic";

const CATEGORIES = ["KOL", "Influencer", "Ambassador", "Model"];

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

interface Kol {
  id: number;
  name: string | null;
  social_handle: string | null;
  category: string;
  status: string;
  scheduled_month: string | null;
  opportunity_cost_idr: number | null;
  opportunity_cost_raw: string | null;
}

export default async function KolsPage() {
  const admin = createAdminClient();

  const [{ data: statusSetting }, { data: rows }, { data: budgetSetting }] =
    await Promise.all([
      admin.from("app_settings").select("value").eq("key", "kol_statuses").maybeSingle(),
      admin
        .from("kols")
        .select(
          "id, name, social_handle, category, status, scheduled_month, opportunity_cost_idr, opportunity_cost_raw",
        )
        .order("scheduled_month", { ascending: false, nullsFirst: false }),
      admin.from("assumptions").select("value").eq("key", "monthly_kol_budget_idr").maybeSingle(),
    ]);

  const statuses = (statusSetting?.value as string[] | undefined) ?? [];
  const kols = (rows ?? []) as Kol[];
  const monthlyBudget = budgetSetting?.value;

  const byStatus = statuses.map((status) => ({
    status,
    items: kols.filter((k) => k.status === status),
  }));

  const spendByMonth = new Map<string, { total: number; missingCount: number }>();
  for (const k of kols) {
    const month = k.scheduled_month?.slice(0, 7);
    if (!month) continue;
    const entry = spendByMonth.get(month) ?? { total: 0, missingCount: 0 };
    if (k.opportunity_cost_idr !== null) {
      entry.total += Number(k.opportunity_cost_idr);
    } else if (k.opportunity_cost_raw) {
      entry.missingCount += 1;
    }
    spendByMonth.set(month, entry);
  }
  const months = Array.from(spendByMonth.keys()).sort().reverse();

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">KOL CRM</h1>
        <Link
          href="/marketing/kols/tiers"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          Tier rules →
        </Link>
      </div>

      {months.length > 0 && (
        <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-medium">Monthly KOL budget</h2>
          <div className="mt-2 space-y-1 text-sm">
            {months.map((m) => {
              const { total, missingCount } = spendByMonth.get(m)!;
              const percent = monthlyBudget ? Math.round((total / monthlyBudget) * 100) : null;
              return (
                <div key={m} className="flex flex-wrap items-center gap-2">
                  <span className="w-20 text-zinc-500">{m}</span>
                  <span>{currencyFormatter.format(total)}</span>
                  {percent !== null && (
                    <span className="text-zinc-500">
                      ({percent}% of {currencyFormatter.format(monthlyBudget)})
                    </span>
                  )}
                  {missingCount > 0 && (
                    <span className="text-amber-600">
                      {missingCount} entr{missingCount === 1 ? "y" : "ies"} without a
                      numeric cost, not counted
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <details className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium">New KOL</summary>
        <form
          action={createKolAction}
          className="grid grid-cols-2 gap-3 border-t border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4"
        >
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input type="text" name="name" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Handle
            <input type="text" name="socialHandle" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Category
            <select name="category" required defaultValue="KOL" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Status
            <select name="status" required defaultValue={statuses[0]} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent">
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Gender
            <input type="text" name="gender" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Location
            <input type="text" name="location" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Followers
            <input type="number" name="followerCount" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Engagement rate (%)
            <input type="number" step="any" name="engagementRate" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            PIC
            <input type="text" name="pic" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Approved by
            <input type="text" name="approvedBy" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Booking date
            <input type="date" name="bookingDate" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Month label
            <input type="text" name="monthLabel" placeholder="e.g. September" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm">
            Deal terms
            <input type="text" name="dealTerms" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm">
            Deliverables
            <input type="text" name="deliverables" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Opportunity cost (IDR, numeric)
            <input type="number" name="opportunityCostIdr" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Opportunity cost (notes)
            <input type="text" name="opportunityCostRaw" placeholder="e.g. 500k Voucher" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm">
            Content link
            <input type="url" name="contentLink" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <div className="col-span-2 sm:col-span-4">
            <button type="submit" className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900">
              Add KOL
            </button>
          </div>
        </form>
      </details>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {byStatus.map(({ status, items }) => (
          <div key={status}>
            <h2 className="text-xs font-medium uppercase text-zinc-500">
              {status} ({items.length})
            </h2>
            <div className="mt-2 space-y-2">
              {items.map((k) => (
                <div key={k.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                  <div className="font-medium">{k.name || k.social_handle || "Unnamed"}</div>
                  <div className="text-xs text-zinc-500">
                    {k.category}
                    {k.scheduled_month && ` · ${k.scheduled_month.slice(0, 7)}`}
                  </div>
                  {(k.opportunity_cost_idr || k.opportunity_cost_raw) && (
                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {k.opportunity_cost_idr
                        ? currencyFormatter.format(k.opportunity_cost_idr)
                        : k.opportunity_cost_raw}
                    </div>
                  )}
                  <form action={updateKolStatusAction} className="mt-2 flex gap-1">
                    <input type="hidden" name="id" value={k.id} />
                    <select name="status" defaultValue={k.status} className="w-full rounded border border-zinc-300 px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-transparent">
                      {statuses.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button type="submit" className="rounded border border-zinc-300 px-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
                      Save
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
