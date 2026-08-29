import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPostAction, updatePostStatusAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUSES = [
  "Concept",
  "Shoot scheduled",
  "Shot",
  "In edit",
  "Awaiting delivery",
  "Approved",
  "Scheduled",
  "Published",
] as const;

const FORMATS = ["Video", "Single Image", "Carousel"] as const;

interface Post {
  id: number;
  post_date: string | null;
  format: string | null;
  carousel_slide_count: number | null;
  pillar: string | null;
  remarks: string | null;
  production_status: string;
}

export default async function CreativePlannerPage() {
  const admin = createAdminClient();

  const [{ data: posts }, { data: pillarSetting }, { data: stores }] =
    await Promise.all([
      admin
        .from("content_calendar")
        .select("id, post_date, format, carousel_slide_count, pillar, remarks, production_status")
        .order("post_date", { ascending: true, nullsFirst: false }),
      admin.from("app_settings").select("value").eq("key", "content_pillars").maybeSingle(),
      admin
        .from("stores")
        .select("name, address")
        .eq("active", true)
        .not("address", "is", null)
        .order("name"),
    ]);

  const pillars = pillarSetting?.value
    ? Object.entries(pillarSetting.value as Record<string, string[]>).flatMap(
        ([group, items]) => items.map((item) => `${group}: ${item}`),
      )
    : [];

  const rows = (posts ?? []) as Post[];
  const byStatus = STATUSES.map((status) => ({
    status,
    items: rows.filter((p) => p.production_status === status),
  }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Creative Planner</h1>
        <Link
          href="/marketing/creative/activations"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          Activations →
        </Link>
      </div>

      {rows.length === 0 && (
        <p className="mt-2 text-sm text-zinc-500">
          No content plan entries yet - the source Creative Plan deck is
          still blocked on Google Drive access, so nothing&apos;s been
          seeded. Add posts below as they&apos;re planned.
        </p>
      )}

      <details className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
          New post
        </summary>
        <form
          action={createPostAction}
          className="grid grid-cols-2 gap-3 border-t border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-4"
        >
          <label className="flex flex-col gap-1 text-sm">
            Date
            <input
              type="date"
              name="postDate"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Format
            <select
              name="format"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            >
              <option value="">-</option>
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Carousel slides
            <input
              type="number"
              name="carouselSlideCount"
              min={1}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Pillar
            <select
              name="pillar"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            >
              <option value="">-</option>
              {pillars.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm sm:col-span-4">
            Copy
            <textarea
              name="copy"
              rows={3}
              className="rounded border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm">
            Remarks
            <input
              type="text"
              name="remarks"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Asset link
            <input
              type="url"
              name="assetLink"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Reference link
            <input
              type="url"
              name="referenceLink"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <div className="col-span-2 sm:col-span-4">
            <button
              type="submit"
              className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900"
            >
              Add post
            </button>
          </div>
        </form>
      </details>

      {stores && stores.length > 0 && (
        <details className="mt-3 rounded-lg border border-zinc-200 text-sm dark:border-zinc-800">
          <summary className="cursor-pointer px-4 py-2 font-medium">
            Store address footer (copy into a post&apos;s copy)
          </summary>
          <div className="border-t border-zinc-200 p-4 font-mono text-xs whitespace-pre-wrap dark:border-zinc-800">
            {stores.map((s) => `${s.name}\n${s.address}`).join("\n\n")}
          </div>
        </details>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-4 lg:grid-cols-8">
        {byStatus.map(({ status, items }) => (
          <div key={status}>
            <h2 className="text-xs font-medium uppercase text-zinc-500">
              {status} ({items.length})
            </h2>
            <div className="mt-2 space-y-2">
              {items.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                >
                  <div className="font-medium">
                    {p.post_date ?? "no date"}
                    {p.format && ` · ${p.format}`}
                  </div>
                  {p.pillar && <div className="text-xs text-zinc-500">{p.pillar}</div>}
                  {p.remarks && (
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {p.remarks}
                    </p>
                  )}
                  <form action={updatePostStatusAction} className="mt-2 flex gap-1">
                    <input type="hidden" name="id" value={p.id} />
                    <select
                      name="status"
                      defaultValue={p.production_status}
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
