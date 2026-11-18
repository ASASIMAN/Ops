import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PortalFrame, PortalHeading } from "@/components/portal/frame";
import { SubmitButton } from "@/components/ui/submit-button";
import { getMemberByToken } from "@/lib/membership/data";
import { MEMBER_COOKIE } from "@/lib/membership/code";
import { portalPaths } from "@/lib/membership/portal";
import { joinAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join ASASI Membership", robots: { index: false } };

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; src?: string }>;
}) {
  const [{ error, src }, paths] = await Promise.all([searchParams, portalPaths()]);

  // Already joined (or signed in) on this device - go straight to their card.
  const existing = (await cookies()).get(MEMBER_COOKIE)?.value;
  if (existing && !error && (await getMemberByToken(existing))) {
    redirect(paths.home);
  }

  const ERRORS: Record<string, React.ReactNode> = {
    name: "Please enter your name.",
    email: "Please enter a valid email address.",
    exists: (
      <>
        That email is already a member.{" "}
        <a href={paths.home} className="underline underline-offset-4">
          Enter it here
        </a>{" "}
        to see your card and points.
      </>
    ),
    failed: "Something went wrong. Please try again.",
  };

  return (
    <PortalFrame homeHref={paths.home}>
      <PortalHeading eyebrow="ASASI Membership" title="Join free">
        Member discounts at our partner venues, points every time you shop with us, and your card on your phone.
      </PortalHeading>

      <form action={joinAction} className="flex flex-col gap-4">
        <input type="hidden" name="source" value={src ?? "qr"} />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
        <label className="as-field">
          Full name
          <input name="fullName" required maxLength={120} autoComplete="name" className="as-input h-12 text-base" />
        </label>
        <label className="as-field">
          Email
          <input type="email" name="email" required autoComplete="email" inputMode="email" className="as-input h-12 text-base" />
        </label>
        <label className="as-field">
          WhatsApp / phone (optional)
          <input type="tel" name="phone" autoComplete="tel" inputMode="tel" className="as-input h-12 text-base" />
        </label>
        <label className="flex items-start gap-3 text-sm text-muted">
          <input type="checkbox" name="marketingOptIn" className="mt-1 accent-[#1c2b10]" />
          Send me news and member offers from ASASI.
        </label>
        {error && ERRORS[error] && <p className="text-sm text-[#893131]">{ERRORS[error]}</p>}
        <SubmitButton className="as-btn h-12" pendingLabel="Creating your card…">
          Get my membership card
        </SubmitButton>
      </form>

      <div className="mt-10 border-t border-line pt-6 text-center text-sm text-muted">
        Already a member, or shopped with us before?{" "}
        <a href={paths.home} className="text-ink underline underline-offset-4">
          Sign in
        </a>
      </div>
    </PortalFrame>
  );
}
