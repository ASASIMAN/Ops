import { PortalFrame, PortalHeading } from "@/components/portal/frame";
import { MemberHome } from "@/components/portal/member-home";
import { SubmitButton } from "@/components/ui/submit-button";
import { PartnerList } from "@/components/portal/partner-list";
import { POINTS_NAME, getActiveVenues } from "@/lib/membership/data";
import { getSignedInMember, portalPaths } from "@/lib/membership/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupAction, signOutAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "Please enter a valid email address.",
  not_found: "We couldn't find a member with that email. Try the one you gave us in store.",
  ambiguous: "That email is on more than one account with us. Please ask us in store and we'll sort it out.",
  limited: "Too many tries from this network. Please wait 15 minutes and try again.",
  failed: "Something went wrong. Please try again.",
};

export default async function PortalPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [{ error }, member, paths] = await Promise.all([searchParams, getSignedInMember(), portalPaths()]);

  if (member) {
    await createAdminClient().from("members").update({ last_seen_at: new Date().toISOString() }).eq("id", member.id);
    return (
      <PortalFrame homeHref={paths.home}>
        <MemberHome
          member={member}
          signOut={
            <form action={signOutAction}>
              <SubmitButton className="as-link">Not you? Use a different email</SubmitButton>
            </form>
          }
        />
      </PortalFrame>
    );
  }

  const venues = await getActiveVenues();
  return (
    <PortalFrame homeHref={paths.home}>
      <PortalHeading eyebrow="ASASI Membership" title={POINTS_NAME}>
        Enter the email you gave us in store to see your {POINTS_NAME} and your member card.
      </PortalHeading>
      <form action={lookupAction} className="flex flex-col gap-4">
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
        <label className="as-field">
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            inputMode="email"
            autoFocus
            className="as-input h-12 text-base"
          />
        </label>
        {error && ERRORS[error] && <p className="text-sm text-[#893131]">{ERRORS[error]}</p>}
        <SubmitButton className="as-btn h-12" pendingLabel="Finding your card…">
          Show my card
        </SubmitButton>
      </form>
      {venues.length > 0 && (
        <div className="mt-10">
          <PartnerList venues={venues} title="Our partners" intro="Members show their card at these partners." />
        </div>
      )}
      <p className="mt-10 border-t border-line pt-6 text-center text-sm text-muted">
        Not a member yet? Join at any ASASI store - it&apos;s free.
      </p>
    </PortalFrame>
  );
}
