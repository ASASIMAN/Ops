import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTierAction, updateTierAction } from "./actions";

export const dynamic = "force-dynamic";

interface Tier {
  id: number;
  tier_name: string;
  follower_threshold_min: number | null;
  deliverables: string | null;
  compensation: string | null;
  kitas_requirement: boolean | null;
}

export default async function TierRulesPage() {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("kol_tiers")
    .select("id, tier_name, follower_threshold_min, deliverables, compensation, kitas_requirement")
    .order("follower_threshold_min", { ascending: true, nullsFirst: true });

  const tiers = (rows ?? []) as Tier[];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/marketing/kols" className="text-sm text-zinc-500 hover:underline">
        ← KOL CRM
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Tier rules</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Not seeded - the source sheet&apos;s tier definitions tab hasn&apos;t
        been read yet (Drive access pending). Add real rules below as
        they&apos;re confirmed.
      </p>

      <details className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium">New tier</summary>
        <form
          action={createTierAction}
          className="grid grid-cols-2 gap-3 border-t border-zinc-200 p-4 dark:border-zinc-800"
        >
          <label className="flex flex-col gap-1 text-sm">
            Tier name
            <input type="text" name="tierName" required placeholder="KOL / Influencer / Ambassador / Model" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Min followers
            <input type="number" name="followerThresholdMin" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Deliverables
            <input type="text" name="deliverables" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Compensation
            <input type="text" name="compensation" className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="kitasRequirement" />
            Requires KITAS
          </label>
          <div className="col-span-2">
            <button type="submit" className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900">
              Add tier
            </button>
          </div>
        </form>
      </details>

      <div className="mt-6 space-y-3">
        {tiers.map((t) => (
          <form
            key={t.id}
            action={updateTierAction}
            className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800"
          >
            <input type="hidden" name="id" value={t.id} />
            <div className="col-span-2 font-medium">{t.tier_name}</div>
            <label className="flex flex-col gap-1">
              Min followers
              <input type="number" name="followerThresholdMin" defaultValue={t.follower_threshold_min ?? ""} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
            </label>
            <label className="flex flex-col gap-1">
              Deliverables
              <input type="text" name="deliverables" defaultValue={t.deliverables ?? ""} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
            </label>
            <label className="flex flex-col gap-1">
              Compensation
              <input type="text" name="compensation" defaultValue={t.compensation ?? ""} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="kitasRequirement" defaultChecked={t.kitas_requirement ?? false} />
              Requires KITAS
            </label>
            <div className="col-span-2">
              <button type="submit" className="rounded border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
                Save
              </button>
            </div>
          </form>
        ))}
        {!tiers.length && <p className="text-sm text-zinc-500">No tiers defined yet.</p>}
      </div>
    </div>
  );
}
