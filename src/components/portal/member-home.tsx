import { InstallHint } from "@/app/member/[token]/install-hint";
import { PartnerList } from "@/components/portal/partner-list";
import { idr } from "@/lib/biz/format";
import { POINTS_NAME, getActiveVenues, getPointValueIdr, shortName, type Member } from "@/lib/membership/data";
import { fetchOdooPoints, formatPoints } from "@/lib/membership/directory";
import { qrSvg } from "@/lib/membership/qr";
import { getBaseUrl, verifyUrl } from "@/lib/membership/urls";
import { appleWalletConfigured } from "@/lib/membership/wallet-apple";
import { googleWalletConfigured } from "@/lib/membership/wallet-google";
import { refreshPartnerLoyalty } from "@/lib/odoo/sync";
import { createAdminClient } from "@/lib/supabase/admin";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Makassar" });
const TIME = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Makassar" });

function freshness(syncedAt: string | null): string {
  if (!syncedAt) return "";
  const minutes = (Date.now() - new Date(syncedAt).getTime()) / 60000;
  return minutes < 10 ? "Up to date" : `As of ${TIME.format(new Date(syncedAt))}`;
}

/**
 * A member's own page: their card and QR (what partner venues scan), their
 * Greyhound points and what they're worth in rupiah - refreshed live from the Odoo till when they're an Odoo loyalty
 * customer - and the partner perks. Anyone who knows a member's email can
 * open this, so it shows first name and last initial only, and no
 * purchase history.
 */
export async function MemberHome({ member, signOut }: { member: Member; signOut?: React.ReactNode }) {
  const admin = createAdminClient();
  const partnerId = member.odoo_partner_id ?? null;

  const [base, venues, pointValue, syncedAt] = await Promise.all([
    getBaseUrl(),
    getActiveVenues(),
    getPointValueIdr(),
    partnerId ? refreshPartnerLoyalty(partnerId).catch(() => null) : Promise.resolve(null),
  ]);
  const [qr, odoo, { data: activity }] = await Promise.all([
    qrSvg(verifyUrl(base, member.code), { margin: 0 }),
    partnerId ? fetchOdooPoints(admin, partnerId) : Promise.resolve(null),
    // Points our team added or redeemed by hand in the app (till points live in Odoo).
    admin
      .from("member_transactions")
      .select("id, kind, points, location, note, created_at")
      .eq("member_id", member.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const points = (odoo?.points ?? 0) + member.points_balance;
  const firstName = member.full_name.split(" ")[0];
  const shownName = shortName(member.full_name);
  const active = member.status === "active";

  return (
    <div className="flex flex-col gap-6">
      <p className="text-center text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted">
        Welcome back, {firstName}
      </p>

      {!active && (
        <p className="border border-line-strong border-l-2 border-l-[#893131] bg-surface px-4 py-3 text-sm">
          This membership is currently suspended. Please speak to us in store.
        </p>
      )}

      <section className="bg-brand px-6 pb-7 pt-6 text-white" aria-label="Member card">
        <div className="flex items-baseline justify-between text-[0.6875rem] uppercase tracking-[0.18em] text-white/60">
          <span>ASASI Member</span>
          <span className="font-mono tracking-[0.12em] text-white/80">{member.code}</span>
        </div>
        <p className="mt-5 text-lg tracking-[0.04em]">{shownName}</p>
        <div
          className="mx-auto mt-6 aspect-square w-56 max-w-full bg-white p-3 [&_svg]:h-full [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: qr }}
          role="img"
          aria-label={`Membership QR code ${member.code}`}
        />
        <p className="mt-4 text-center text-[0.8125rem] text-white/75">
          Show this to our partner venues - they scan it to confirm you&apos;re a member.
        </p>
      </section>

      <section className="border border-line bg-surface px-6 py-5 text-center">
        <p className="text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted">Your {POINTS_NAME}</p>
        <p className="mt-2 text-5xl font-light tabular-nums">{formatPoints(points)}</p>
        {pointValue && points > 0 && (
          <p className="mt-2 text-[0.9375rem]">
            Worth <span className="tabular-nums">{idr(points * pointValue)}</span>
          </p>
        )}
        <p className="mt-2 text-xs text-muted">
          {partnerId
            ? [
                odoo ? freshness(syncedAt) : "No points on your account yet",
                member.points_balance > 0 && odoo ? `includes ${formatPoints(member.points_balance)} added by our team` : "",
              ]
                .filter(Boolean)
                .join(" · ")
            : `Give the email on your card at the till when you shop, so your purchases earn ${POINTS_NAME}.`}
        </p>
      </section>

      {(appleWalletConfigured() || googleWalletConfigured()) && (
        <div className="flex flex-col gap-2">
          {appleWalletConfigured() && (
            <a href={`/member/${member.access_token}/apple`} className="as-btn h-11">
              Add to Apple Wallet
            </a>
          )}
          {googleWalletConfigured() && (
            <a href={`/member/${member.access_token}/google`} className="as-btn h-11">
              Add to Google Wallet
            </a>
          )}
        </div>
      )}

      <InstallHint />

      {venues.length > 0 ? (
        <PartnerList venues={venues} title="Partner perks" intro="Show your card at our partners." />
      ) : (
        <section>
          <h2 className="mb-3 text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted">Partner perks</h2>
          <p className="text-sm text-muted">Partner venues are coming soon.</p>
        </section>
      )}

      {activity && activity.length > 0 && (
        <section>
          <h2 className="mb-3 text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted">Added by our team</h2>
          <ul className="divide-y divide-line border-y border-line text-sm">
            {activity.map((t) => (
              <li key={t.id} className="flex justify-between gap-4 py-2.5">
                <span className="text-muted">
                  {DATE.format(new Date(t.created_at))} · {t.location || t.note || (t.kind === "redeem" ? "Redeemed" : "Points added")}
                </span>
                <span className="tabular-nums">
                  {t.points > 0 ? "+" : ""}
                  {t.points}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {signOut && <div className="text-center">{signOut}</div>}
    </div>
  );
}
