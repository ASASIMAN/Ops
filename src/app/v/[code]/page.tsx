import { PortalFrame } from "@/components/portal/frame";
import { portalPaths } from "@/lib/membership/portal";
import {
  getActiveVenues, getIdrPerPoint, getMemberByCode, getStaffUser, shortName,
} from "@/lib/membership/data";
import { normalizeMemberCode } from "@/lib/membership/code";
import { fetchOdooPoints, formatPoints } from "@/lib/membership/directory";
import { createAdminClient } from "@/lib/supabase/admin";
import { earnPointsAction, redeemPointsAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "ASASI Member", robots: { index: false } };

const RESULTS: Record<string, [string, boolean]> = {
  invalid: ["Enter a valid number.", false],
  toosmall: ["Amount is too small to earn a point.", false],
  insufficient: ["Member doesn't have that many points.", false],
  suspended: ["This membership is suspended - no points can be added.", false],
  failed: ["Something went wrong - nothing was saved.", false],
  odoo: ["This member's points are added by the Odoo till - add them to the sale there instead.", false],
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
  const [member, staff, paths] = await Promise.all([getMemberByCode(code), getStaffUser(), portalPaths()]);

  const valid = member?.status === "active";

  const venues = valid && !staff ? await getActiveVenues() : [];
  const idrPerPoint = staff ? await getIdrPerPoint() : 0;
  const linkedToOdoo = Boolean(member?.odoo_partner_id);
  const odoo = staff && member?.odoo_partner_id ? await fetchOdooPoints(createAdminClient(), member.odoo_partner_id) : null;

  const input = "as-input h-12 text-base";
  const button = "as-btn h-12";
  // Shown so a partner can tell a live check from a screenshot of an old one.
  const checkedAt = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Makassar",
  }).format(new Date());

  return (
    <PortalFrame homeHref={paths.home}>
      <div className={`px-6 py-8 text-center ${valid ? "bg-brand text-white" : "border border-line-strong bg-surface"}`}>
        <p className="text-5xl font-light" aria-hidden>
          {valid ? "✓" : "✕"}
        </p>
        <p className="mt-3 text-lg uppercase tracking-[0.16em]">
          {!member ? "Member not found" : valid ? "Valid ASASI member" : "Membership suspended"}
        </p>
        {member && (
          <p className={`mt-2 ${valid ? "text-white/75" : "text-muted"}`}>
            {shortName(member.full_name)} · <span className="font-mono">{member.code}</span>
          </p>
        )}
        <p className={`mt-4 text-[0.6875rem] uppercase tracking-[0.16em] ${valid ? "text-white/60" : "text-muted"}`}>
          Checked {checkedAt} (Bali)
        </p>
      </div>

      {!staff && valid && venues.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted">Member discount</h2>
          <ul className="divide-y divide-line border-y border-line">
            {venues.map((v) => (
              <li key={v.id} className="py-3 text-sm">
                {v.name} <span className="text-muted">- {v.discount_text}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {staff && member && (
        <div className="mt-6 space-y-6">
          {(result === "earn" || result === "redeem") && (
            <p className="border border-line-strong border-l-2 border-l-[#426030] bg-surface px-4 py-3 text-sm">
              {result === "earn" ? `Added ${points} points.` : `Redeemed ${points} points.`}
            </p>
          )}
          {result && RESULTS[result] && (
            <p className="border border-line-strong border-l-2 border-l-[#893131] bg-surface px-4 py-3 text-sm">{RESULTS[result][0]}</p>
          )}

          <div className="border border-line bg-surface p-5">
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted">Points balance</p>
            <p className="mt-1 text-4xl font-light tabular-nums">
              {formatPoints((odoo?.points ?? 0) + member.points_balance)}
            </p>
            {linkedToOdoo && (
              <p className="mt-1 text-sm text-muted">
                {odoo ? `${formatPoints(odoo.points)} in Odoo (${odoo.programs.join(", ") || "loyalty"})` : "No Odoo loyalty card yet"}
                {member.points_balance > 0 && ` + ${formatPoints(member.points_balance)} added in the app`}
              </p>
            )}
          </div>

          {valid && linkedToOdoo && (
            <p className="border border-line bg-surface px-4 py-3 text-sm">
              Linked to this customer in Odoo: points are added automatically when they&apos;re added to the sale at
              the till, and redeemed there as a reward.
            </p>
          )}

          {valid && (
            <>
              {!linkedToOdoo && (
              <form action={earnPointsAction} className="flex flex-col gap-3">
                <input type="hidden" name="code" value={member.code} />
                <h2 className="text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted">Add points for a purchase</h2>
                <input name="amountIdr" type="number" min={1} step={1} required inputMode="numeric"
                  placeholder="Sale total (IDR)" className={input} />
                <input name="location" placeholder="Store (optional)" className={input} />
                <p className="text-xs text-muted">
                  1 point per IDR {idrPerPoint.toLocaleString()} spent.
                </p>
                <button className={button}>Add points</button>
              </form>
              )}

              {(!linkedToOdoo || member.points_balance > 0) && (
              <form action={redeemPointsAction} className="flex flex-col gap-3">
                <input type="hidden" name="code" value={member.code} />
                <h2 className="text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted">{linkedToOdoo ? "Redeem points added in the app" : "Redeem points"}</h2>
                <input name="points" type="number" min={1} step={1} required inputMode="numeric"
                  placeholder="Points to redeem" className={input} />
                <input name="note" placeholder="What for? (optional)" className={input} />
                <button className={button}>Redeem</button>
              </form>
              )}
            </>
          )}
        </div>
      )}
    </PortalFrame>
  );
}
