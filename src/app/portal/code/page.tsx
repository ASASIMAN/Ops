import { redirect } from "next/navigation";
import { PortalFrame, PortalHeading } from "@/components/portal/frame";
import { SubmitButton } from "@/components/ui/submit-button";
import { getPendingEmail, getSignedInMember, portalPaths } from "@/lib/membership/portal";
import { verifyCodeAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Enter your code" };

const ERRORS: Record<string, string> = {
  invalid: "That code isn't right. Check the email and try again.",
  expired: "That code has expired. Go back and ask for a new one.",
  attempts: "Too many wrong tries. Go back and ask for a new code.",
  ambiguous:
    "More than one customer record at ASASI uses this email, so we can't tell which is yours. Please ask us in store and we'll sort it out.",
  not_member: "We couldn't find a membership for this email. Join free, or ask us in store.",
  failed: "Something went wrong. Please try again.",
};

export default async function CodePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [{ error }, email, member, paths] = await Promise.all([
    searchParams,
    getPendingEmail(),
    getSignedInMember(),
    portalPaths(),
  ]);
  if (member) redirect(paths.home);
  if (!email) redirect(`${paths.home}?error=expired`);

  return (
    <PortalFrame homeHref={paths.home}>
      <PortalHeading eyebrow="Check your email" title="Enter your code">
        If <span className="text-ink">{email}</span> belongs to an ASASI member, we&apos;ve sent a 6-digit code to it. It
        works for 10 minutes.
      </PortalHeading>
      <form action={verifyCodeAction} className="flex flex-col gap-4">
        <label className="as-field">
          Code
          <input
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            autoFocus
            className="as-input h-14 text-center font-mono text-2xl tracking-[0.4em]"
          />
        </label>
        {error && ERRORS[error] && <p className="text-sm text-[#893131]">{ERRORS[error]}</p>}
        <SubmitButton className="as-btn h-12" pendingLabel="Checking…">
          Sign in
        </SubmitButton>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        No email?{" "}
        <a href={paths.home} className="text-ink underline underline-offset-4">
          Try again
        </a>{" "}
        or check your spam folder.
        {error === "not_member" && (
          <>
            {" "}
            <a href="/join?src=web" className="text-ink underline underline-offset-4">
              Join free
            </a>
          </>
        )}
      </p>
    </PortalFrame>
  );
}
