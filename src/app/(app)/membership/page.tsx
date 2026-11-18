import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Card, EmptyState, NeedsMigration } from "@/components/ui/card";
import { FilterLinks } from "@/components/ui/filter-links";
import { Stat } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { idr, num } from "@/lib/biz/format";
import { getStaffUser } from "@/lib/membership/data";
import {
  LOYALTY_MIGRATION,
  fetchDirectory,
  fetchLastLoyaltySync,
  fetchSummary,
  formatPoints,
  type DirectorySort,
  type DirectoryView,
} from "@/lib/membership/directory";
import { appleWalletConfigured } from "@/lib/membership/wallet-apple";
import { googleWalletConfigured } from "@/lib/membership/wallet-google";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupMemberAction, setMemberStatusAction, syncLoyaltyAction } from "./actions";

export const dynamic = "force-dynamic";
// The "Sync from Odoo" action reads every loyalty card and customer.
export const maxDuration = 60;
export const metadata: Metadata = { title: "Members" };

const PAGE_SIZE = 50;
const VIEWS: { value: DirectoryView; label: string }[] = [
  { value: "linked", label: "Odoo + QR sign-up" },
  { value: "odoo_only", label: "From Odoo" },
  { value: "app_only", label: "QR sign-up only" },
];
const SORTS: { value: DirectorySort; label: string }[] = [
  { value: "points", label: "Most points" },
  { value: "spend", label: "Top spend" },
  { value: "recent", label: "Last visit" },
  { value: "name", label: "Name" },
];
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Makassar" });
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Makassar",
});

export default async function MembershipPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    view?: string;
    sort?: string;
    page?: string;
    synced?: string;
    cards?: string;
    linked?: string;
    orders?: string;
    syncError?: string;
  }>;
}) {
  const params = await searchParams;
  const staff = await getStaffUser();
  if (!staff) {
    return <EmptyState title="Not part of your role">Membership is open to admin, ops and marketing.</EmptyState>;
  }

  const q = (params.q ?? "").trim().slice(0, 80);
  const view = VIEWS.find((v) => v.value === params.view)?.value ?? "all";
  const sort = SORTS.find((s) => s.value === params.sort)?.value ?? "points";
  const page = Math.max(1, Number.parseInt(params.page ?? "", 10) || 1);

  const admin = createAdminClient();
  const [directory, summary, syncs] = await Promise.all([
    fetchDirectory(admin, { search: q, view, sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    fetchSummary(admin),
    fetchLastLoyaltySync(admin),
  ]);

  const keep = {
    q: q || undefined,
    view: view === "all" ? undefined : view,
    sort: sort === "points" ? undefined : sort,
  };
  const href = (overrides: Record<string, string | undefined>) => {
    const merged = { ...keep, ...overrides };
    const query = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => Boolean(e[1]))).toString();
    return query ? `/membership?${query}` : "/membership";
  };

  // When each member on this page last checked their points on the members portal (migration 0042).
  const memberIds = directory.ok ? directory.rows.map((r) => r.memberId).filter((id): id is string => Boolean(id)) : [];
  const seen = new Map<string, string>();
  const fromPortal = new Set<string>();
  if (memberIds.length) {
    const { data, error } = await admin.from("members").select("id, last_seen_at, signup_source").in("id", memberIds);
    if (!error)
      for (const m of data ?? []) {
        if (m.last_seen_at) seen.set(m.id, m.last_seen_at);
        if (m.signup_source === "portal") fromPortal.add(m.id);
      }
  }

  const s = summary.ok ? summary.data : null;
  const notSetUp = !directory.ok && directory.missing;
  const neverSynced = s !== null && s.odooCustomers === 0 && !syncs.lastSuccess;
  const total = directory.ok ? directory.total : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="as-page-head">
        <div>
          <h1 className="as-page-title">Members</h1>
          <p className="as-page-desc">
            Everyone in the Odoo loyalty programme, plus everyone who signed up with the in-store QR. Points are kept by
            the Odoo till and copied here
            {syncs.lastSuccess ? `, last synced ${DATE_TIME.format(new Date(syncs.lastSuccess.startedAt))} (Bali)` : ""}.
            Spend and visits count POS sales where the customer was added to the sale.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action={syncLoyaltyAction}>
            <SubmitButton pendingLabel="Syncing from Odoo…">Sync from Odoo</SubmitButton>
          </form>
          <Link href="/membership/scan" className="as-btn as-btn-quiet">
            Scan a card
          </Link>
        </div>
      </div>

      {params.synced && (
        <p className="as-notice as-notice-good mb-4">
          Synced {num(Number(params.cards) || 0)} loyalty card{Number(params.cards) === 1 ? "" : "s"} and{" "}
          {num(Number(params.synced) || 0)} customers from Odoo.
          {Number(params.linked) > 0 && ` Matched ${num(Number(params.linked))} app sign-up${Number(params.linked) === 1 ? "" : "s"} to their Odoo customer.`}
          {Number(params.orders) > 0 && ` Linked ${num(Number(params.orders))} past order${Number(params.orders) === 1 ? "" : "s"} to their customer.`}
        </p>
      )}
      {params.syncError && <p className="as-notice as-notice-bad mb-4">The Odoo sync failed: {params.syncError}</p>}
      {!params.syncError && syncs.last?.status === "error" && (
        <p className="as-notice as-notice-bad mb-4">
          The last loyalty sync ({DATE_TIME.format(new Date(syncs.last.startedAt))}) failed: {syncs.last.errorMessage}
        </p>
      )}

      {notSetUp ? (
        <div className="as-card">
          <NeedsMigration file={LOYALTY_MIGRATION} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat
              label="Loyalty members"
              tag="Odoo"
              value={s ? num(s.odooCustomers) : null}
              note={neverSynced ? "Not synced from Odoo yet" : "Customers holding a loyalty card"}
              href={href({ view: undefined, page: undefined })}
            />
            <Stat
              label="Points outstanding"
              tag="Odoo"
              value={s ? formatPoints(s.odooPoints) : null}
              note={s && s.appOnlyPoints > 0 ? `Plus ${formatPoints(s.appOnlyPoints)} added in the app` : "Unspent points across every card"}
            />
            <Stat
              label="QR sign-ups"
              value={s ? num(s.appMembers) : null}
              note={s ? `${num(s.linkedMembers)} matched to their Odoo customer` : undefined}
              href={href({ view: "app_only", page: undefined })}
            />
            <Stat
              label="Customers who bought"
              value={s ? num(s.customersWithOrders) : null}
              note="Distinct customers attached to at least one synced POS sale"
            />
          </div>

          <Card className="mt-6" title="Directory" note={`${num(total)} ${total === 1 ? "person" : "people"}${q ? ` matching “${q}”` : ""}`}>
            <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-4">
              <Form action="/membership" className="flex min-w-[16rem] flex-1 items-end gap-2">
                {keep.view && <input type="hidden" name="view" value={keep.view} />}
                {keep.sort && <input type="hidden" name="sort" value={keep.sort} />}
                <label className="as-field flex-1">
                  Search
                  <input name="q" defaultValue={q} placeholder="Name, email, phone or member code" className="as-input" />
                </label>
                <button type="submit" className="as-btn">
                  Search
                </button>
              </Form>
              <FilterLinks basePath="/membership" param="view" value={view === "all" ? undefined : view} options={VIEWS} allLabel="Everyone" keep={keep} label="Who" />
              <FilterLinks basePath="/membership" param="sort" value={sort} options={SORTS} keep={keep} label="Sort" />
            </div>

            {!directory.ok ? (
              <p className="as-notice as-notice-bad m-5">The directory couldn&apos;t be loaded: {directory.error}</p>
            ) : directory.rows.length === 0 ? (
              neverSynced && !q && view !== "app_only" ? (
                <EmptyState title="Nothing synced from Odoo yet">
                  Press &ldquo;Sync from Odoo&rdquo; to bring in every loyalty customer and their points. After that it runs
                  every morning with the sales sync.
                </EmptyState>
              ) : (
                <EmptyState title="No one matches">Try a different search or filter.</EmptyState>
              )
            ) : (
              <>
                <div className="as-table-wrap">
                  <table className="as-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th className="as-num">Points</th>
                        <th>Member card</th>
                        <th className="as-num">Spend</th>
                        <th className="as-num">Visits</th>
                        <th>Last visit</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {directory.rows.map((r) => {
                        const totalPoints = (r.odooPoints ?? 0) + (r.appPoints ?? 0);
                        return (
                          <tr key={`${r.odooPartnerId ?? "app"}-${r.memberId ?? "odoo"}`}>
                            <td>
                              {r.name}
                              {r.memberStatus === "suspended" && <span className="as-badge as-badge-bad ml-2">Suspended</span>}
                              <span className="block text-xs text-muted">
                                {[r.email, r.phone].filter(Boolean).join(" · ") || "No contact details in Odoo"}
                              </span>
                            </td>
                            <td className="as-num">
                              <span className="font-medium">{formatPoints(totalPoints)}</span>
                              <span className="block text-xs text-muted">
                                {r.odooPoints !== null && r.appPoints ? `${formatPoints(r.odooPoints)} Odoo + ${formatPoints(r.appPoints)} app` : r.odooPoints !== null ? (r.programs ?? "Odoo") : "Added in the app"}
                              </span>
                            </td>
                            <td>
                              {r.memberCode ? (
                                <Link href={`/v/${r.memberCode}`} className="font-mono">
                                  {r.memberCode}
                                </Link>
                              ) : (
                                <span>Signed up from Odoo</span>
                              )}
                              <span className="block text-xs text-muted">
                                {r.memberCode
                                  ? `${r.memberId && fromPortal.has(r.memberId) ? "Card made when they first checked points online" : "QR sign-up"}${r.joinedAppAt ? `, ${DATE.format(new Date(r.joinedAppAt))}` : ""}${r.odooPartnerId === null ? " · not found in Odoo" : ""}`
                                  : ""}
                                {r.memberId && seen.has(r.memberId) && (
                                  <span className="block">Last checked points online {DATE.format(new Date(seen.get(r.memberId)!))}</span>
                                )}
                              </span>
                            </td>
                            {/* No sale with this customer attached isn't the same as "never bought". */}
                            <td className="as-num">{r.orderCount > 0 ? idr(r.spend) : <span className="text-faint">-</span>}</td>
                            <td className="as-num">{r.orderCount > 0 ? num(r.orderCount) : <span className="text-faint">-</span>}</td>
                            <td>{r.lastOrderAt ? DATE.format(new Date(r.lastOrderAt)) : <span className="text-faint">-</span>}</td>
                            <td className="text-right">
                              {r.memberId && (
                                <form action={setMemberStatusAction}>
                                  <input type="hidden" name="id" value={r.memberId} />
                                  <input type="hidden" name="status" value={r.memberStatus === "active" ? "suspended" : "active"} />
                                  <SubmitButton className="as-link">{r.memberStatus === "active" ? "Suspend" : "Reactivate"}</SubmitButton>
                                </form>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
                  <span>
                    {num((page - 1) * PAGE_SIZE + 1)} - {num(Math.min(page * PAGE_SIZE, total))} of {num(total)}
                  </span>
                  <span className="flex gap-4">
                    {page > 1 ? (
                      <Link href={href({ page: page > 2 ? String(page - 1) : undefined })} className="as-link" scroll={false}>
                        ← Previous
                      </Link>
                    ) : (
                      <span className="as-link opacity-30">← Previous</span>
                    )}
                    {page < pages ? (
                      <Link href={href({ page: String(page + 1) })} className="as-link" scroll={false}>
                        Next →
                      </Link>
                    ) : (
                      <span className="as-link opacity-30">Next →</span>
                    )}
                  </span>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Open a member card" note="Type the code printed on a member's card or wallet pass">
          <form action={lookupMemberAction} className="flex flex-wrap items-end gap-2 px-5 py-4">
            <label className="as-field flex-1">
              Member code
              <input name="code" placeholder="e.g. K7Q2-M9XA" className="as-input font-mono" />
            </label>
            <SubmitButton>Open</SubmitButton>
          </form>
        </Card>
        <Card title="Wallet passes">
          <div className="as-card-pad text-[0.8125rem]">
            <p>Apple Wallet: {appleWalletConfigured() ? "on" : "not set up"}</p>
            <p>Google Wallet: {googleWalletConfigured() ? "on" : "not set up"}</p>
            <p className="mt-2 text-xs text-muted">Without them, members still get a web card with the same QR code.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
