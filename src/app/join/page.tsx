import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AsasiLogo } from "@/components/brand/asasi-logo";
import { getMemberByToken } from "@/lib/membership/data";
import { MEMBER_COOKIE } from "@/lib/membership/code";
import { joinAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join ASASI Membership" };

const ERRORS: Record<string, string> = {
  name: "Please enter your name.",
  email: "Please enter a valid email address.",
  exists:
    "That email is already registered. Open the ASASI card you saved to your phone wallet - or ask any team member to resend your link.",
  failed: "Something went wrong. Please try again.",
};

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; src?: string }>;
}) {
  const { error, src } = await searchParams;

  // Already joined on this device - go straight to their card.
  const existing = (await cookies()).get(MEMBER_COOKIE)?.value;
  if (existing && !error && (await getMemberByToken(existing))) {
    redirect(`/member/${existing}`);
  }

  const input =
    "rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <AsasiLogo className="h-9 self-start" />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">
        Join ASASI Membership
      </h1>
      <ul className="mt-3 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
        <li>• Member discounts at our partner venues</li>
        <li>• Earn points every time you shop with us</li>
        <li>• Your card lives in your phone wallet - free to join</li>
      </ul>

      <form action={joinAction} className="mt-8 flex flex-col gap-4">
        <input type="hidden" name="source" value={src ?? "qr"} />
        <input
          type="text" name="website" tabIndex={-1} autoComplete="off"
          aria-hidden className="hidden"
        />
        <label className="flex flex-col gap-1 text-sm">
          Full name
          <input name="fullName" required maxLength={120} autoComplete="name" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input type="email" name="email" required autoComplete="email" inputMode="email" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          WhatsApp / phone <span className="text-zinc-400">(optional)</span>
          <input type="tel" name="phone" autoComplete="tel" inputMode="tel" className={input} />
        </label>
        <label className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" name="marketingOptIn" className="mt-1" />
          Send me news and member offers from ASASI.
        </label>
        {error && ERRORS[error] && (
          <p className="text-sm text-red-600">{ERRORS[error]}</p>
        )}
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-4 py-3 text-base font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          Get my membership card
        </button>
      </form>
    </div>
  );
}
