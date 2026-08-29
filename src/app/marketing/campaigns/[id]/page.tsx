import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { updatePostMortemAction } from "../actions";
import { createTaskAction, updateTaskStatusAction } from "../../tasks/actions";

export const dynamic = "force-dynamic";

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!campaign) notFound();

  let adResults: { spend: number; purchases: number; adCount: number } | null = null;
  if (campaign.linked_ad_set_names?.length) {
    const { data: matchedAds } = await admin
      .from("ads")
      .select("id, ad_name")
      .in("ad_set_name", campaign.linked_ad_set_names);

    if (matchedAds?.length) {
      const { data: snapshots } = await admin
        .from("ad_performance_snapshots")
        .select("amount_spent_idr, purchases")
        .in("ad_id", matchedAds.map((a) => a.id));

      const spend = (snapshots ?? []).reduce((s, r) => s + Number(r.amount_spent_idr), 0);
      const purchases = (snapshots ?? []).reduce((s, r) => s + Number(r.purchases ?? 0), 0);
      adResults = { spend, purchases, adCount: matchedAds.length };
    } else {
      adResults = { spend: 0, purchases: 0, adCount: 0 };
    }
  }

  const { data: taskRows } = await admin
    .from("tasks")
    .select("id, title, description, owner_name, due_date, priority, status")
    .eq("link_type", "campaign")
    .eq("link_id", campaign.id)
    .order("due_date", { ascending: true, nullsFirst: false });

  const returnTo = `/marketing/campaigns/${campaign.id}`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/marketing/campaigns" className="text-sm text-zinc-500 hover:underline">
        ← Campaign Tracker
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{campaign.name}</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {campaign.status}
        {campaign.objective && ` · ${campaign.objective}`}
        {campaign.channels?.length > 0 && ` · ${campaign.channels.join(", ")}`}
      </p>
      {(campaign.start_date || campaign.end_date) && (
        <p className="mt-1 text-sm text-zinc-500">
          {campaign.start_date ?? "?"} → {campaign.end_date ?? "?"}
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">Budget</div>
          <div className="mt-1 text-lg font-semibold">
            {campaign.budget_idr ? currencyFormatter.format(campaign.budget_idr) : "-"}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">Spend (linked ads)</div>
          <div className="mt-1 text-lg font-semibold">
            {adResults ? currencyFormatter.format(adResults.spend) : "-"}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">Purchases</div>
          <div className="mt-1 text-lg font-semibold">{adResults?.purchases ?? "-"}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">CPA</div>
          <div className="mt-1 text-lg font-semibold">
            {adResults && adResults.purchases > 0
              ? currencyFormatter.format(adResults.spend / adResults.purchases)
              : "-"}
          </div>
        </div>
      </div>
      {!campaign.linked_ad_set_names?.length && (
        <p className="mt-2 text-xs text-zinc-500">
          No linked Meta ad set names yet - spend/purchases won&apos;t
          auto-pull until this campaign is linked to one on the campaign
          list.
        </p>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        Revenue and ROAS aren&apos;t shown - they&apos;d need an assumed
        order value per purchase, which isn&apos;t available yet (same gap
        as Financials).
      </p>

      <div className="mt-8">
        <h2 className="text-lg font-medium">Post-mortem</h2>
        <form action={updatePostMortemAction} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="id" value={campaign.id} />
          <textarea
            name="postMortem"
            defaultValue={campaign.post_mortem ?? ""}
            rows={4}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-transparent"
          />
          <button
            type="submit"
            className="self-start rounded border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Save
          </button>
        </form>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-medium">Tasks</h2>
        <form action={createTaskAction} className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="linkType" value="campaign" />
          <input type="hidden" name="linkId" value={campaign.id} />
          <input type="hidden" name="linkLabel" value={`Campaign: ${campaign.name}`} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input
            type="text"
            name="title"
            placeholder="New task"
            required
            className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-transparent"
          />
          <input
            type="date"
            name="dueDate"
            className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-transparent"
          />
          <button
            type="submit"
            className="rounded bg-zinc-900 px-3 py-1 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900"
          >
            Add
          </button>
        </form>
        <ul className="mt-3">
          {(taskRows ?? []).map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 border-t border-zinc-100 py-2 text-sm dark:border-zinc-800"
            >
              <span className={t.status === "done" ? "text-zinc-400 line-through" : ""}>
                {t.title} {t.due_date && `(due ${t.due_date})`}
              </span>
              {t.status !== "done" && (
                <form action={updateTaskStatusAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button
                    type="submit"
                    name="status"
                    value="done"
                    className="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    Done
                  </button>
                </form>
              )}
            </li>
          ))}
          {!taskRows?.length && (
            <li className="py-2 text-sm text-zinc-500">No tasks yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
