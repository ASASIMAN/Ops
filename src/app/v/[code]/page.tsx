import { AsasiLogo } from "@/components/brand/asasi-logo";
import {
  getActiveVenues, getIdrPerPoint, getMemberByCode, getStaffUser,
} from "@/lib/membership/data";
import { normalizeMemberCode } from "@/lib/membership/code";
import { earnPointsAction, redeemPointsAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "ASASI Member", robots: { index: false } };

const RESULTS: Record<string, [string, boolean]> = {
  invalid: ["Enter a valid number.", false],
  toosmall: ["Amount is too small to earn a point.", false],
  insufficient: ["Member doesn't have that many points.", false],
  suspended: ["This membership is suspended - no points can be added.", false],
  failed: ["Something went wrong - nothing was saved.", false],
};

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ result?: string; points?: string }>;
}) {
  const code = normalizeMemberCode((await params).code);
  const { result, points } = await searchParams;
  const [member, staff] = await Promise.all([getMemberByCode(code), getStaffUser()]);

  const first = member?.full_name.split(" ")[0];
  const lastInitial = member?.full_name.split(" ").slice(1).pop()?.[0];
  const valid = member?.status === "active";

  const venues = valid && !staff ? await getActiveVenues() : [];
  const idrPerPoint = staff ? await getIdrPerPoint() : 0;

  const input = "rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base dark:border-zinc-700 dark:bg-zinc-900";
  const button = "rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white dark:bg-zinc-50 dark:text-zinc-900";

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <AsasiLogo className="h-7" />

      <div className={`mt-6 rounded-2xl p-6 text-center ${valid ? "bg-emerald-50 dark:bg-emerald-950" : "bg-red-50 dark:bg-red-950"}`}>
        <p className="text-4xl">{valid ? "✓" : "✕"}</p>
        <p className="mt-2 text-xl font-semibold">
          {!member ? "Member not found" : valid ? "Valid ASASI member" : "Membership suspended"}
        </p>
        {member && (
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            {first}{lastInitial ? ` ${lastInitial}.` : ""} · <span className="font-mono">{member.code}</span>
          </p>
        )}
      </div>

      {!staff && valid && venues.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-zinc-500">Member discount</h2>
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {venues.map((v) => (
              <li key={v.id} className="py-2 text-sm">
                <span className="font-medium">{v.name}</span> - {v.discount_text}
              </li>
            ))}
          </ul>
        </>
      )}

      {staff && member && (
        <div className="mt-6 space-y-6">
          {(result === "earn" || result === "redeem") && (
            <p className="rounded-lg bg-emerald-100 p-3 text-sm text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">
              {result === "earn" ? `Added ${points} points.` : `Redeemed ${points} points.`}
            </p>
          )}
          {result && RESULTS[result] && (
            <p className="rounded-lg bg-red-100 p-3 text-sm text-red-900">{RESULTS[result][0]}</p>
          )}

          <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
            <p className="text-sm text-zinc-500">Points balance</p>
            <p className="text-4xl font-semibold tabular-nums">{member.points_balance.toLocaleString()}</p>
          </div>

          {valid && (
            <>
              <form action={earnPointsAction} className="flex flex-col gap-3">
                <input type="hidden" name="code" value={member.code} />
                <h2 className="font-medium">Add points for a purchase</h2>
                <input name="amountIdr" type="number" min={1} step={1} required inputMode="numeric"
                  placeholder="Sale total (IDR)" className={input} />
                <input name="location" placeholder="Store (optional)" className={input} />
                <p className="text-xs text-zinc-500">
                  1 point per IDR {idrPerPoint.toLocaleString()} spent.
                </p>
                <button className={button}>Add points</button>
              </form>

              <form action={redeemPointsAction} className="flex flex-col gap-3">
                <input type="hidden" name="code" value={member.code} />
                <h2 className="font-medium">Redeem points</h2>
                <input name="points" type="number" min={1} step={1} required inputMode="numeric"
                  placeholder="Points to redeem" className={input} />
                <input name="note" placeholder="What for? (optional)" className={input} />
                <button className={button}>Redeem</button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
