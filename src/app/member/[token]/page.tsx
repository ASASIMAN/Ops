import { notFound } from "next/navigation";
import { AsasiLogo } from "@/components/brand/asasi-logo";
import { getActiveVenues, getMemberByToken } from "@/lib/membership/data";
import { qrSvg } from "@/lib/membership/qr";
import { getBaseUrl, verifyUrl } from "@/lib/membership/urls";
import { appleWalletConfigured } from "@/lib/membership/wallet-apple";
import { googleWalletConfigured } from "@/lib/membership/wallet-google";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "My ASASI Membership", robots: { index: false } };

export default async function MemberCardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const member = await getMemberByToken(token);
  if (!member) notFound();

  const base = await getBaseUrl();
  const [qr, venues, { data: history }] = await Promise.all([
    qrSvg(verifyUrl(base, member.code), { margin: 0 }),
    getActiveVenues(),
    createAdminClient()
      .from("member_transactions")
      .select("id, kind, points, location, note, created_at")
      .eq("member_id", member.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const apple = appleWalletConfigured();
  const google = googleWalletConfigured();

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <div className="rounded-2xl bg-zinc-900 p-6 text-white shadow-xl">
        <div className="flex items-center justify-between">
          <AsasiLogo className="h-6 invert" />
          <span className="text-xs uppercase tracking-widest text-zinc-400">Member</span>
        </div>
        <p className="mt-6 text-xl font-semibold">{member.full_name}</p>
        <p className="font-mono text-sm tracking-widest text-zinc-400">{member.code}</p>
        <div
          className="mx-auto mt-6 w-48 rounded-xl bg-white p-3 [&_svg]:h-full [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: qr }}
          role="img"
          aria-label={`Membership QR code ${member.code}`}
        />
        <p className="mt-3 text-center text-xs text-zinc-400">
          Show this at ASASI stores and partner venues
        </p>
        {member.status === "suspended" && (
          <p className="mt-3 rounded bg-red-500/20 p-2 text-center text-sm text-red-200">
            This membership is currently suspended.
          </p>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <p className="text-sm text-zinc-500">Points balance</p>
        <p className="text-4xl font-semibold tabular-nums">
          {member.points_balance.toLocaleString()}
        </p>
      </div>

      {(apple || google) && (
        <div className="mt-4 flex flex-col gap-3">
          {apple && (
            <a href={`/member/${token}/apple`} className="rounded-xl bg-black px-4 py-3 text-center font-medium text-white ring-1 ring-zinc-700">
               Add to Apple Wallet
            </a>
          )}
          {google && (
            <a href={`/member/${token}/google`} className="rounded-xl bg-black px-4 py-3 text-center font-medium text-white ring-1 ring-zinc-700">
              Add to Google Wallet
            </a>
          )}
        </div>
      )}
      <p className="mt-3 text-center text-xs text-zinc-500">
        Tip: bookmark this page or add it to your home screen - it&apos;s your card.
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Partner perks
      </h2>
      {venues.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">Partner venues coming soon.</p>
      ) : (
        <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {venues.map((v) => (
            <li key={v.id} className="py-3">
              <p className="font-medium">{v.name}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{v.discount_text}</p>
            </li>
          ))}
        </ul>
      )}

      {history && history.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Recent activity
          </h2>
          <ul className="mt-2 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {history.map((t) => (
              <li key={t.id} className="flex justify-between py-2">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {new Date(t.created_at).toLocaleDateString()} · {t.location || t.note || t.kind}
                </span>
                <span className="tabular-nums">{t.points > 0 ? "+" : ""}{t.points}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
