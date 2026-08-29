import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateStoreAction, updateAppSettingAction } from "./actions";

export const dynamic = "force-dynamic";

interface Store {
  id: number;
  name: string;
  address: string | null;
  slug: string | null;
  is_preopening: boolean;
  active: boolean;
}

interface AppSetting {
  key: string;
  value: unknown;
}

export default async function SettingsPage() {
  const admin = createAdminClient();
  const [{ data: stores }, { data: settings }] = await Promise.all([
    admin
      .from("stores")
      .select("id, name, address, slug, is_preopening, active")
      .order("name"),
    admin.from("app_settings").select("key, value").order("key"),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Stores and taxonomy, editable without code changes. Budget/LTV
        assumptions live on{" "}
        <Link href="/marketing/financials" className="underline">
          Financials
        </Link>{" "}
        instead, next to where they&apos;re used.
      </p>

      <h2 className="mt-6 text-lg font-medium">Stores</h2>
      <div className="mt-2 space-y-3">
        {(stores as Store[] | null)?.map((s) => (
          <form
            key={s.id}
            action={updateStoreAction}
            className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-4"
          >
            <input type="hidden" name="id" value={s.id} />
            <label className="flex flex-col gap-1">
              Name
              <input type="text" name="name" defaultValue={s.name} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
            </label>
            <label className="flex flex-col gap-1">
              Slug
              <input type="text" name="slug" defaultValue={s.slug ?? ""} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
            </label>
            <label className="col-span-2 flex flex-col gap-1">
              Address
              <input type="text" name="address" defaultValue={s.address ?? ""} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isPreopening" defaultChecked={s.is_preopening} />
              Pre-opening
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="active" defaultChecked={s.active} />
              Active
            </label>
            <div className="col-span-2 sm:col-span-4">
              <button type="submit" className="rounded border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
                Save
              </button>
            </div>
          </form>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-medium">Taxonomy</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Raw JSON - lists/objects used across Creative Planner, KOL CRM, and
        Campaign Tracker statuses.
      </p>
      <div className="mt-2 space-y-3">
        {(settings as AppSetting[] | null)?.map((s) => (
          <form
            key={s.key}
            action={updateAppSettingAction}
            className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800"
          >
            <input type="hidden" name="key" value={s.key} />
            <label className="flex flex-col gap-1">
              {s.key}
              <textarea
                name="value"
                defaultValue={JSON.stringify(s.value, null, 2)}
                rows={4}
                className="rounded border border-zinc-300 px-2 py-1.5 font-mono text-xs dark:border-zinc-700 dark:bg-transparent"
              />
            </label>
            <button
              type="submit"
              className="mt-2 rounded border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Save
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
