import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTaskAction, updateTaskStatusAction } from "./actions";

export const dynamic = "force-dynamic";

type View = "all" | "mine" | "week" | "overdue" | "byOwner";

interface Task {
  id: number;
  title: string;
  description: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  link_type: string | null;
  link_label: string | null;
}

function daysFromNow(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const PRIORITY_COLOR: Record<string, string> = {
  high: "text-red-600",
  medium: "text-amber-600",
  low: "text-zinc-500",
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: viewParam } = await searchParams;
  const view = (viewParam as View) || "all";

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();

  const admin = createAdminClient();

  let query = admin
    .from("tasks")
    .select(
      "id, title, description, owner_user_id, owner_name, due_date, priority, status, link_type, link_label",
    )
    .neq("status", "done")
    .order("due_date", { ascending: true, nullsFirst: false });

  if (view === "mine" && user) {
    query = query.eq("owner_user_id", user.id);
  } else if (view === "week") {
    query = query.gte("due_date", daysFromNow(0)).lte("due_date", daysFromNow(7));
  } else if (view === "overdue") {
    query = query.lt("due_date", daysFromNow(0));
  }

  const { data: rows } = await query;
  const tasks = (rows ?? []) as Task[];

  const grouped =
    view === "byOwner"
      ? tasks.reduce<Record<string, Task[]>>((acc, t) => {
          const key = t.owner_name || "Unassigned";
          (acc[key] ||= []).push(t);
          return acc;
        }, {})
      : null;

  const views: { key: View; label: string }[] = [
    { key: "all", label: "All open" },
    { key: "mine", label: "My tasks" },
    { key: "week", label: "This week" },
    { key: "overdue", label: "Overdue" },
    { key: "byOwner", label: "By owner" },
  ];

  function TaskRow({ t }: { t: Task }) {
    return (
      <li className="flex items-start justify-between gap-3 border-t border-zinc-100 py-3 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t.title}</span>
            <span className={`text-xs ${PRIORITY_COLOR[t.priority] ?? ""}`}>
              {t.priority}
            </span>
          </div>
          {t.description && (
            <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
              {t.description}
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500">
            {t.owner_name && <span>{t.owner_name}</span>}
            {t.due_date && <span>due {t.due_date}</span>}
            {t.link_label && <span>{t.link_label}</span>}
          </div>
        </div>
        <form action={updateTaskStatusAction} className="flex shrink-0 gap-1">
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="returnTo" value={`/marketing/tasks?view=${view}`} />
          {t.status !== "in_progress" && (
            <button
              type="submit"
              name="status"
              value="in_progress"
              className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              In progress
            </button>
          )}
          <button
            type="submit"
            name="status"
            value="done"
            className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Done
          </button>
        </form>
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>

      <div className="mt-4 flex flex-wrap gap-2">
        {views.map((v) => (
          <Link
            key={v.key}
            href={`/marketing/tasks?view=${v.key}`}
            className={`rounded-full border px-3 py-1 text-xs ${
              view === v.key
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </div>

      <form
        action={createTaskAction}
        className="mt-6 grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4"
      >
        <input type="hidden" name="returnTo" value={`/marketing/tasks?view=${view}`} />
        <label className="col-span-2 flex flex-col gap-1 text-sm sm:col-span-2">
          Title
          <input
            type="text"
            name="title"
            required
            className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Due date
          <input
            type="date"
            name="dueDate"
            className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Priority
          <select
            name="priority"
            defaultValue="medium"
            className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm sm:col-span-3">
          Owner (if not you)
          <input
            type="text"
            name="ownerName"
            placeholder="Name"
            className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="assignToMe" />
          Assign to me
        </label>
        <div className="col-span-2 sm:col-span-4">
          <button
            type="submit"
            className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900"
          >
            Add task
          </button>
        </div>
      </form>

      <div className="mt-6">
        {grouped ? (
          Object.entries(grouped).map(([owner, ownerTasks]) => (
            <div key={owner} className="mt-4">
              <h2 className="text-sm font-medium text-zinc-500">{owner}</h2>
              <ul>
                {ownerTasks.map((t) => (
                  <TaskRow key={t.id} t={t} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <ul>
            {tasks.map((t) => (
              <TaskRow key={t.id} t={t} />
            ))}
            {!tasks.length && (
              <li className="py-6 text-center text-sm text-zinc-500">
                Nothing here.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
