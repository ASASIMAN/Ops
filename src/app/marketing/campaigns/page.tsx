import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCampaignAction, updateCampaignStatusAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUSES = ["Brief", "In production", "Scheduled", "Live", "Ended", "Reviewed"] as const;

interface Campaign {
  id: number;
  name: string;
  objective: string | null;
  channels: string[];
  status: string;
  start_date: string | null;
  end_date: string | null;
  budget_idr: number | null;
}

export default async function CampaignsPage() {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("campaigns")
    .select("id, name, objective, channels, status, start_date, end_date, budget_idr")
    .order("created_at", { ascending: false });

  const campaigns = (rows ?? []) as Campaign[];
  const byStatus = STATUSES.map((status) => ({
    status,
    items: campaigns.filter((c) => c.status === status),
  }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Campaign Tracker</h1>

      <details className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
          New campaign
        </summary>
        <form
          action={createCampaignAction}
          className="grid grid-cols-2 gap-3 border-t border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4"
        >
          <label className="col-span-2 flex flex-col gap-1 text-sm">
            Name
            <input
              type="text"
              name="name"
              required
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm">
            Objective
            <input
              type="text"
              name="objective"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Start date
            <input
              type="date"
              name="startDate"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            End date
            <input
              type="date"
              name="endDate"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Budget (IDR)
            <input
              type="number"
              name="budgetIdr"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Channels (comma-separated)
            <input
              type="text"
              name="channels"
              placeholder="Meta, TikTok"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm sm:col-span-4">
            Linked Meta ad set name(s) (comma-separated, for auto-pulled spend/results)
            <input
              type="text"
              name="linkedAdSetNames"
              placeholder="Indo Warm, New Sales ad set cold Bali – WA Laskar"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <div className="col-span-2 sm:col-span-4">
            <button
              type="submit"
              className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900"
            >
              Create
            </button>
          </div>
        </form>
      </details>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {byStatus.map(({ status, items }) => (
          <div key={status}>
            <h2 className="text-xs font-medium uppercase text-zinc-500">
              {status} ({items.length})
            </h2>
            <div className="mt-2 space-y-2">
              {items.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                >
                  <Link href={`/marketing/campaigns/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  {c.channels.length > 0 && (
                    <p className="mt-1 text-xs text-zinc-500">{c.channels.join(", ")}</p>
                  )}
                  <form action={updateCampaignStatusAction} className="mt-2 flex gap-1">
                    <input type="hidden" name="id" value={c.id} />
                    <select
                      name="status"
                      defaultValue={c.status}
                      className="w-full rounded border border-zinc-300 px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-transparent"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded border border-zinc-300 px-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    >
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
