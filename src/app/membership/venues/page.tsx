import Link from "next/link";
import { getStaffUser } from "@/lib/membership/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createVenueAction, deleteVenueAction, updateVenueAction } from "../actions";

export const dynamic = "force-dynamic";

const input = "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-transparent";

export default async function VenuesPage() {
  if (!(await getStaffUser())) return <p className="p-8 text-sm text-zinc-500">No access.</p>;
  const { data: venues } = await createAdminClient()
    .from("partner_venues").select("*").order("sort_order").order("name");

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/membership" className="text-sm text-zinc-500 underline">← Membership</Link>
      <h1 className="mt-2 text-xl font-semibold">Partner venues</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Shown to members on their card and to venue staff when they scan a member.
      </p>

      <form action={createVenueAction} className="mt-6 grid gap-2 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2 dark:border-zinc-800">
        <input name="name" placeholder="Venue name" required className={input} />
        <input name="discountText" placeholder="Offer, e.g. 10% off the bill" required className={input} />
        <input name="notes" placeholder="Internal notes (optional)" className={input} />
        <input name="sortOrder" type="number" placeholder="Order" className={input} />
        <button className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white sm:col-span-2 dark:bg-zinc-50 dark:text-zinc-900">Add venue</button>
      </form>

      <div className="mt-6 space-y-3">
        {(venues ?? []).map((v) => (
          <div key={v.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <form action={updateVenueAction} className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="id" value={v.id} />
              <input name="name" defaultValue={v.name} required className={input} />
              <input name="discountText" defaultValue={v.discount_text} required className={input} />
              <input name="notes" defaultValue={v.notes ?? ""} placeholder="Notes" className={input} />
              <input name="sortOrder" type="number" defaultValue={v.sort_order} className={input} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={v.active} /> Active
              </label>
              <button className="justify-self-end rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700">Save</button>
            </form>
            <form action={deleteVenueAction} className="mt-1">
              <input type="hidden" name="id" value={v.id} />
              <button className="text-xs text-red-600 underline">Delete</button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
