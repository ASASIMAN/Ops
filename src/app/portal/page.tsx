import { PortalFrame, PortalHeading } from "@/components/portal/frame";
import { MemberHome } from "@/components/portal/member-home";
import { SubmitButton } from "@/components/ui/submit-button";
import { getSignedInMember, portalPaths } from "@/lib/membership/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestCodeAction, signOutAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  email: "Please enter a valid email address.",
  limited: "Too many codes requested. Please wait 15 minutes and try again.",
  send: "We couldn't send the email just now. Please try again in a moment.",
  failed: "Something went wrong. Please try again.",
  expired: "That sign-in took too long. Enter your email again for a new code.",
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
              <SubmitButton className="as-link">Sign out</SubmitButton>
            </form>
          }
        />
      </PortalFrame>
    );
  }

  return (
    <PortalFrame homeHref={paths.home}>
      <PortalHeading eyebrow="ASASI Membership" title="Sign in">
        Enter the email you gave us in store or when you joined. We&apos;ll email you a 6-digit code - no password needed.
      </PortalHeading>
      <form action={requestCodeAction} className="flex flex-col gap-4">
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
        <SubmitButton className="as-btn h-12" pendingLabel="Sending code…">
          Email me a code
        </SubmitButton>
      </form>
      <div className="mt-10 border-t border-line pt-6 text-center text-sm text-muted">
        Not a member yet?{" "}
        <a href="/join?src=web" className="text-ink underline underline-offset-4">
          Join free
        </a>
      </div>
    </PortalFrame>
  );
}
