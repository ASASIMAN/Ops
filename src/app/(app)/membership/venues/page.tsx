import type { Metadata } from "next";
import Image from "next/image";
import { Card, EmptyState } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { getStaffUser, type PartnerVenue } from "@/lib/membership/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createVenueAction, deleteVenueAction, updateVenueAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Partner venues" };

const LOGO_MIGRATION = "supabase/migrations/0044_partner_logos.sql";
const ERRORS: Record<string, string> = {
  name: "Give the partner a name.",
  logo: "That file isn't an image we can read. Use a PNG or JPG.",
};

function Logo({ venue }: { venue: PartnerVenue }) {
  return venue.logo ? (
    <Image
      src={venue.logo}
      alt={`${venue.name} logo`}
      width={56}
      height={56}
      unoptimized
      className="size-14 shrink-0 border border-line bg-white object-contain"
    />
  ) : (
    <span aria-hidden className="grid size-14 shrink-0 place-items-center border border-line bg-surface text-xs uppercase text-muted">
      No logo
    </span>
  );
}

export default async function VenuesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  if (!(await getStaffUser())) {
    return <EmptyState title="Not part of your role">Membership is open to admin, ops and marketing.</EmptyState>;
  }
  const { error, saved } = await searchParams;
  const { data } = await createAdminClient().from("partner_venues").select("*").order("sort_order").order("name");
  const venues = (data ?? []) as PartnerVenue[];
  // Before migration 0044 the rows have no logo column (and the offer is required).
  const logosReady = venues.length > 0 && "logo" in venues[0];

  return (
    <>
      <div className="as-page-head">
        <div>
          <h1 className="as-page-title">Partner venues</h1>
          <p className="as-page-desc">
            Listed on members.studioasasi.com with their logo and member offer, and shown to partner staff when they scan a
            member&apos;s QR. Untick &ldquo;Listed&rdquo; to hide one without deleting it.
          </p>
        </div>
      </div>

      {saved && <p className="as-notice as-notice-good mb-4">{saved === "added" ? "Partner added." : "Saved."}</p>}
      {error && <p className="as-notice as-notice-bad mb-4">{ERRORS[error] ?? `Couldn't save: ${error}`}</p>}
      {venues.length > 0 && !logosReady && (
        <p className="as-notice as-notice-bad mb-4">
          Run <code className="font-mono text-xs">{LOGO_MIGRATION}</code> in Supabase to add logos and make the offer optional.
        </p>
      )}

      <Card title="Add a partner">
        <form action={createVenueAction} className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <label className="as-field">
            Name
            <input name="name" required maxLength={80} className="as-input" />
          </label>
          <label className="as-field">
            Member offer (optional)
            <input name="discountText" maxLength={120} placeholder="e.g. 10% off the bill" className="as-input" />
          </label>
          <label className="as-field">
            Logo (PNG or JPG, square works best)
            <input name="logo" type="file" accept="image/*" className="as-input py-1.5" />
          </label>
          <label className="as-field">
            Order on the list
            <input name="sortOrder" type="number" defaultValue={0} className="as-input" />
          </label>
          <label className="as-field sm:col-span-2">
            Internal notes (optional, staff only)
            <input name="notes" maxLength={300} className="as-input" />
          </label>
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Adding…">Add partner</SubmitButton>
          </div>
        </form>
      </Card>

      <Card className="mt-6" title="Partners" note={`${venues.length} ${venues.length === 1 ? "partner" : "partners"}`}>
        {venues.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">No partners yet.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {venues.map((v) => (
              <li key={v.id} className="px-5 py-5">
                <form action={updateVenueAction} className="grid gap-4 sm:grid-cols-[auto_1fr_1fr]">
                  <input type="hidden" name="id" value={v.id} />
                  <Logo venue={v} />
                  <label className="as-field">
                    Name
                    <input name="name" defaultValue={v.name} required maxLength={80} className="as-input" />
                  </label>
                  <label className="as-field">
                    Member offer
                    <input name="discountText" defaultValue={v.discount_text ?? ""} maxLength={120} placeholder="None yet" className="as-input" />
                  </label>
                  <div className="hidden sm:block" />
                  <label className="as-field">
                    {v.logo ? "Replace logo" : "Add logo"}
                    <input name="logo" type="file" accept="image/*" className="as-input py-1.5" />
                  </label>
                  <label className="as-field">
                    Order on the list
                    <input name="sortOrder" type="number" defaultValue={v.sort_order} className="as-input" />
                  </label>
                  <div className="hidden sm:block" />
                  <label className="as-field sm:col-span-2">
                    Internal notes
                    <input name="notes" defaultValue={v.notes ?? ""} maxLength={300} className="as-input" />
                  </label>
                  <div className="hidden sm:block" />
                  <div className="flex flex-wrap items-center gap-5 sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="active" defaultChecked={v.active} /> Listed on the members site
                    </label>
                    {v.logo && (
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="removeLogo" /> Remove logo
                      </label>
                    )}
                    <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
                  </div>
                </form>
                <form action={deleteVenueAction} className="mt-3 sm:pl-[4.5rem]">
                  <input type="hidden" name="id" value={v.id} />
                  <SubmitButton className="as-link text-sm text-[#893131]" pendingLabel="Deleting…">
                    Delete {v.name}
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
