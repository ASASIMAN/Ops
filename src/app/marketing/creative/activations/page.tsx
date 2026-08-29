import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createActivationAction, toggleChecklistItemAction } from "./actions";

export const dynamic = "force-dynamic";

interface ChecklistItem {
  label: string;
  done: boolean;
}

interface Activation {
  id: number;
  name: string;
  type: string | null;
  period_start: string | null;
  period_end: string | null;
  prize: string | null;
  entry_mechanic: string | null;
  checklist: ChecklistItem[];
}

export default async function ActivationsPage() {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("activations")
    .select("id, name, type, period_start, period_end, prize, entry_mechanic, checklist")
    .order("created_at", { ascending: false });

  const activations = (rows ?? []) as Activation[];

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/marketing/creative" className="text-sm text-zinc-500 hover:underline">
        ← Creative Planner
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Activations</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Collabs, giveaways, store openings - each gets its own checklist.
      </p>

      <details className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
          New activation
        </summary>
        <form
          action={createActivationAction}
          className="grid grid-cols-2 gap-3 border-t border-zinc-200 p-4 dark:border-zinc-800"
        >
          <label className="col-span-2 flex flex-col gap-1 text-sm">
            Name
            <input
              type="text"
              name="name"
              required
              placeholder="e.g. ASASI × SOMA"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Type
            <input
              type="text"
              name="type"
              placeholder="Collab / Giveaway / Store Opening"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Prize
            <input
              type="text"
              name="prize"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Period start
            <input
              type="date"
              name="periodStart"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Period end
            <input
              type="date"
              name="periodEnd"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm">
            Entry mechanic
            <input
              type="text"
              name="entryMechanic"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <div className="col-span-2">
            <button
              type="submit"
              className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900"
            >
              Create
            </button>
          </div>
        </form>
      </details>

      <div className="mt-6 space-y-4">
        {activations.map((a) => (
          <div key={a.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-medium">{a.name}</h2>
            <p className="text-sm text-zinc-500">
              {a.type}
              {(a.period_start || a.period_end) &&
                ` · ${a.period_start ?? "?"} → ${a.period_end ?? "?"}`}
            </p>
            {a.prize && <p className="mt-1 text-sm">Prize: {a.prize}</p>}
            {a.entry_mechanic && (
              <p className="mt-1 text-sm">Entry: {a.entry_mechanic}</p>
            )}
            <ul className="mt-3 space-y-1">
              {a.checklist.map((item, i) => (
                <li key={item.label}>
                  <form action={toggleChecklistItemAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="index" value={i} />
                    <button
                      type="submit"
                      className={`text-sm ${item.done ? "text-zinc-400 line-through" : ""}`}
                    >
                      {item.done ? "☑" : "☐"} {item.label}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!activations.length && (
          <p className="text-sm text-zinc-500">No activations yet.</p>
        )}
      </div>
    </div>
  );
}
