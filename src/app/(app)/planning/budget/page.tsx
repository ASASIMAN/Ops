import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canAccessModule } from "@/components/shell/nav-config";
import { Card, EmptyState } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { idr, idrCompact, num } from "@/lib/biz/format";
import { coreItem } from "@/lib/budget/items";
import {
  LIVE_STATUSES,
  can,
  getPlannerUser,
  loadBudgetPlanner,
  type ItemPlan,
  type PushView,
} from "@/lib/budget/data";
import {
  commentPushAction,
  confirmPushAction,
  decidePushAction,
  saveBudgetSettingsAction,
  withdrawPushAction,
} from "./actions";
import { COLORS, CoverChart } from "./cover-chart";
import { ProposeForm } from "./propose-form";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Marketing budget" };

const MONTH_SHORT = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  timeZone: "UTC",
});
const MONTH_LONG = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Makassar",
});
const DAY_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Makassar",
});
const asDate = (month: string) => new Date(`${month}T00:00:00Z`);
const monthLong = (month: string) => MONTH_LONG.format(asDate(month));
const unitsText = (v: number) =>
  `${num(Math.round(v))} unit${Math.round(v) === 1 ? "" : "s"}`;
const perMonth = (v: number) => (v < 10 ? v.toFixed(1) : num(Math.round(v)));

const DONE: Record<string, string> = {
  proposed: "Push proposed. Ops can now confirm the stock.",
  confirmed: "Stock confirmed. The push is waiting for the CEO.",
  approved: "Push approved.",
  rejected: "Push rejected.",
  withdrawn: "Push withdrawn.",
  commented: "Note added.",
  settings: "Settings saved.",
};
const ERRORS: Record<string, string> = {
  not_allowed: "Your role can't do that step.",
  item: "Pick one of the core items.",
  month: "Pick a month in the next 12 months.",
  amount: "Enter the extra spend in rupiah.",
  units:
    "Units per Instagram sale should be between 0 and 20 (or empty for normal).",
  changed: "Someone else changed that push first - here's where it stands now.",
  reason: "Say why when rejecting, so marketing knows what to change.",
  empty: "Write a note first.",
  settings: "One of the settings is out of range.",
};
const STATUS: Record<PushView["status"], { label: string; cls: string }> = {
  proposed: { label: "Awaiting ops", cls: "as-badge as-badge-warn" },
  confirmed: { label: "Awaiting CEO", cls: "as-badge as-badge-warn" },
  approved: { label: "Approved", cls: "as-badge as-badge-good" },
  rejected: { label: "Rejected", cls: "as-badge as-badge-bad" },
  withdrawn: { label: "Withdrawn", cls: "as-badge" },
};
const ACTION_TEXT: Record<string, string> = {
  proposed: "proposed",
  edited: "edited",
  confirmed: "confirmed the stock",
  approved: "approved",
  rejected: "rejected",
  withdrawn: "withdrew",
  commented: "noted",
};

function roleLine(user: { role: string; canApprove: boolean }): string {
  const parts = [];
  if (user.role === "admin")
    parts.push("propose pushes, confirm stock and change settings");
  else if (user.role === "marketing") parts.push("propose pushes");
  else if (user.role === "ops") parts.push("confirm stock");
  if (user.canApprove) parts.push("approve or reject");
  return parts.length
    ? `You can ${parts.join(", and ")}.`
    : "You can read the plan and add notes.";
}

function ItemPanel({
  plan,
  months,
  season,
  pushes,
  agedDays,
}: {
  plan: ItemPlan;
  months: string[];
  season: number[];
  pushes: PushView[];
  agedDays: number;
}) {
  const live = pushes.filter(
    (p) => p.item_key === plan.item.key && LIVE_STATUSES.includes(p.status),
  );
  const spendApproved = months.map((m) =>
    live
      .filter((p) => p.month === m && p.status === "approved")
      .reduce((s, p) => s + p.amount_idr, 0),
  );
  const spendPending = months.map((m) =>
    live
      .filter((p) => p.month === m && p.status !== "approved")
      .reduce((s, p) => s + p.amount_idr, 0),
  );
  const hasPlan = live.some((p) => p.effect && p.effect.units > 0);
  const askIndex = plan.ask ? months.indexOf(plan.ask.askBy) : -1;
  const coverNow = plan.normal.units ? plan.stockNow / plan.normal.units : null;

  return (
    <Card
      title={plan.item.label}
      note={
        plan.styles.length
          ? `Includes ${plan.styles.join(", ")}`
          : `No Odoo styles match yet (${plan.item.rule.toLowerCase()})`
      }
    >
      <div className="px-5 pb-5">
        <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="as-eyebrow">Stock now</dt>
            <dd className="tabular-nums">{unitsText(plan.stockNow)}</dd>
          </div>
          <div>
            <dt className="as-eyebrow">Normal month</dt>
            <dd className="tabular-nums">
              {plan.normal.units === null
                ? "No data"
                : `${perMonth(plan.normal.units)} / month`}
            </dd>
          </div>
          <div>
            <dt className="as-eyebrow">Months of stock</dt>
            <dd className="tabular-nums">
              {coverNow === null ? "No data" : coverNow.toFixed(1)}{" "}
              <span className="text-muted">
                vs {plan.target.months.toFixed(1)} target
              </span>
            </dd>
          </div>
          <div>
            <dt className="as-eyebrow">Old (&gt;{agedDays} days)</dt>
            <dd className="tabular-nums">
              {plan.aged.known
                ? plan.aged.units > 0
                  ? unitsText(plan.aged.units)
                  : "None"
                : "No data yet"}
            </dd>
          </div>
        </dl>
        {plan.normal.units === null ? (
          <p className="text-sm text-muted">
            No complete month of sales for this item yet, so there&apos;s
            nothing to project.
          </p>
        ) : (
          <>
            <p className="as-eyebrow mb-1">Months of stock, then extra spend</p>
            <CoverChart
              id={plan.item.key}
              label={plan.item.label}
              monthLabels={months.map((m) => MONTH_SHORT.format(asDate(m)))}
              tipTitles={months.map(monthLong)}
              season={months.map((m) => season[Number(m.slice(5, 7)) - 1])}
              baselineCover={plan.baseline.map((p) => p.cover)}
              baselineStock={plan.baseline.map((p) => p.stockEnd)}
              planCover={hasPlan ? plan.withPushes.map((p) => p.cover) : null}
              planStock={
                hasPlan ? plan.withPushes.map((p) => p.stockEnd) : null
              }
              base={plan.baseline.map((p) => p.base)}
              extra={(hasPlan ? plan.withPushes : plan.baseline).map(
                (p) => p.extra,
              )}
              incoming={plan.baseline.map((p) => p.incoming)}
              target={plan.target.months}
              spendApproved={spendApproved}
              spendPending={spendPending}
              askIndex={askIndex >= 0 ? askIndex : null}
            />
          </>
        )}
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted">
            Show as a table
          </summary>
          <div className="as-table-wrap mt-2">
            <table className="as-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="as-num">Normal sales</th>
                  <th className="as-num">Arriving</th>
                  <th className="as-num">Stock at month end</th>
                  <th className="as-num">Months of stock</th>
                  <th className="as-num">Above target</th>
                  {hasPlan && <th className="as-num">With pushes</th>}
                </tr>
              </thead>
              <tbody>
                {plan.baseline.map((p, i) => (
                  <tr key={p.month}>
                    <td>{monthLong(p.month)}</td>
                    <td className="as-num">{num(Math.round(p.base))}</td>
                    <td className="as-num">
                      {p.incoming ? num(Math.round(p.incoming)) : "-"}
                    </td>
                    <td className="as-num">{num(Math.round(p.stockEnd))}</td>
                    <td className="as-num">
                      {p.cover === null ? "No data" : p.cover.toFixed(1)}
                    </td>
                    <td className="as-num">
                      {p.pile > 0.5 ? num(Math.round(p.pile)) : "-"}
                    </td>
                    {hasPlan && (
                      <td className="as-num">
                        {num(Math.round(plan.withPushes[i].stockEnd))}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </Card>
  );
}

export default async function BudgetPlannerPage({
  searchParams,
}: {
  searchParams: Promise<{
    done?: string;
    error?: string;
    item?: string;
    month?: string;
  }>;
}) {
  const user = await getPlannerUser();
  if (!user) redirect("/login?next=/planning/budget");
  if (!canAccessModule(user.role, "budget_planner")) {
    return (
      <EmptyState title="Not part of your role">
        The marketing budget planner is open to admin, marketing, ops and
        viewers.
      </EmptyState>
    );
  }
  const params = await searchParams;
  const plan = await loadBudgetPlanner();
  const { response, items, pushes, months, season, settings } = plan;
  const agedDays = settings.agedDays;
  const seasonMax = Math.max(...season);
  const seasonMin = Math.min(...season);
  const sortedPushes = [...pushes].sort(
    (a, b) => a.month.localeCompare(b.month) || a.id - b.id,
  );

  return (
    <>
      <div className="as-page-head">
        <div>
          <h1 className="as-page-title">Marketing budget</h1>
          <p className="as-page-desc">
            Extra marketing money to shift large or old stock of our core items,
            and when in the year to ask for it. Marketing proposes a push, ops
            confirms the stock is there, the CEO approves. {roleLine(user)}
          </p>
        </div>
        {plan.stockSyncedAt && (
          <p className="text-xs text-muted">
            Stock as of {DAY_TIME.format(new Date(plan.stockSyncedAt))} (Bali)
          </p>
        )}
      </div>

      {params.done && DONE[params.done] && (
        <p className="as-notice as-notice-good mb-4">{DONE[params.done]}</p>
      )}
      {params.error && (
        <p className="as-notice as-notice-bad mb-4">
          {ERRORS[params.error] ?? `Couldn't save: ${params.error}`}
        </p>
      )}
      {plan.setup.map((s) => (
        <p key={s} className="as-notice mb-4">
          {s}
        </p>
      ))}

      <Card
        title="When to ask for money"
        note={`Large pile = more than the target months of normal sales on hand. Old = in stock longer than ${agedDays} days.`}
      >
        <div className="as-table-wrap">
          <table className="as-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="as-num">Stock now</th>
                <th>Months of stock</th>
                <th className="as-num">Old stock</th>
                <th>Large pile (no extra marketing)</th>
                <th>Ask for budget</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const cover = it.normal.units
                  ? it.stockNow / it.normal.units
                  : null;
                return (
                  <tr key={it.item.key}>
                    <td>{it.item.label}</td>
                    <td className="as-num">{num(Math.round(it.stockNow))}</td>
                    <td className="min-w-[11rem]">
                      {cover === null
                        ? "No data"
                        : `${cover.toFixed(1)} vs ${it.target.months.toFixed(1)} target`}
                      <span className="block text-xs text-muted">
                        {it.normal.units === null
                          ? "no complete month of sales"
                          : `normal ${perMonth(it.normal.units)}/month`}{" "}
                        · target: {it.target.source}
                      </span>
                    </td>
                    <td className="as-num">
                      {it.aged.known
                        ? it.aged.units > 0
                          ? num(Math.round(it.aged.units))
                          : "None"
                        : "No data yet"}
                      {it.aged.known && it.aged.oldest && (
                        <span className="block text-xs text-muted">
                          oldest{" "}
                          {DAY.format(new Date(`${it.aged.oldest}T00:00:00Z`))}
                        </span>
                      )}
                    </td>
                    <td>
                      {it.normal.units === null
                        ? "No data"
                        : it.ask
                          ? `${unitsText(it.ask.peakUnits)} at the peak (${monthLong(it.ask.peakMonth)})`
                          : "None in the next 12 months"}
                    </td>
                    <td>
                      {it.ask ? (
                        <>
                          <strong>
                            {it.ask.now
                              ? "Now"
                              : `By ${monthLong(it.ask.askBy)}`}
                          </strong>
                          <span className="block text-xs text-muted">
                            {it.clearBudget !== null &&
                            Number.isFinite(it.clearBudget)
                              ? `≈ ${idr(it.clearBudget)} of Instagram ads to shift it at the normal mix`
                              : "Cost to shift it: no marketing data"}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">Not needed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        className="mt-6"
        title="Tourist season"
        note={`How busy each month is in Bali vs an average month (foreign arrivals, ${plan.seasonYears} full years). Used for normal sales until we have two years of our own.`}
      >
        <div className="grid grid-cols-6 gap-px px-5 pb-5 sm:grid-cols-12">
          {months.map((m) => {
            const f = season[Number(m.slice(5, 7)) - 1];
            const t =
              seasonMax > seasonMin
                ? (f - seasonMin) / (seasonMax - seasonMin)
                : 0.5;
            return (
              <div
                key={m}
                className="border border-line px-1 py-2 text-center"
                style={{ background: `rgba(63,107,42,${0.06 + t * 0.4})` }}
              >
                <p className="text-[0.6875rem] uppercase tracking-[0.12em]">
                  {MONTH_SHORT.format(asDate(m))}
                </p>
                <p className="mt-1 text-sm tabular-nums">×{f.toFixed(2)}</p>
              </div>
            );
          })}
        </div>
      </Card>

      <div
        className="mt-6 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted"
        aria-label="Chart key"
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 18,
              borderTop: `2px dashed ${COLORS.baseline}`,
            }}
          />{" "}
          No extra marketing
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 18,
              borderTop: `2px solid ${COLORS.plan}`,
            }}
          />{" "}
          With planned pushes
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 18,
              borderTop: `1.5px dashed ${COLORS.target}`,
            }}
          />{" "}
          Target months of stock
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 14,
              height: 10,
              background: COLORS.pile,
              opacity: 0.35,
            }}
          />{" "}
          Large pile
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: COLORS.plan,
            }}
          />{" "}
          Approved spend
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              border: `1px solid ${COLORS.plan}`,
              background: `repeating-linear-gradient(45deg, ${COLORS.plan} 0 2px, #fff 2px 4px)`,
            }}
          />{" "}
          Awaiting approval
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden style={{ color: COLORS.pile }}>
            ▼
          </span>{" "}
          Ask for budget by
        </span>
      </div>
      <div className="mt-3 grid gap-4 xl:grid-cols-2">
        {items.map((it) => (
          <ItemPanel
            key={it.item.key}
            plan={it}
            months={months}
            season={season}
            pushes={pushes}
            agedDays={agedDays}
          />
        ))}
      </div>

      <section id="pushes" className="mt-6 scroll-mt-20">
        <Card
          title="Pushes"
          note="Extra marketing spend on one item in one month. Marketing or admin proposes, ops confirms the stock, the CEO approves."
        >
          {can.propose(user) && (
            <ProposeForm
              items={items.map((i) => ({
                key: i.item.key,
                label: i.item.label,
                unitsPerSale: i.unitsPerSale,
                price: i.price,
                cost: i.cost,
              }))}
              months={months.map((m) => ({ value: m, label: monthLong(m) }))}
              costPerIgSale={response?.costPerIgSale ?? null}
              defaultItem={params.item}
              defaultMonth={params.month}
            />
          )}
          {sortedPushes.length === 0 ? (
            <p className="border-t border-line px-5 py-5 text-sm text-muted">
              No pushes yet.
            </p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {sortedPushes.map((p) => {
                const status = STATUS[p.status];
                const mine = p.proposed_by === user.email;
                return (
                  <li key={p.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div>
                        <p>
                          <strong>
                            {coreItem(p.item_key)?.label ?? p.item_key}
                          </strong>{" "}
                          · {monthLong(p.month)} ·{" "}
                          <span className="tabular-nums">
                            {idr(p.amount_idr)}
                          </span>
                        </p>
                        <p className="text-sm text-muted">
                          {p.effect
                            ? [
                                `≈ ${p.effect.units.toFixed(1)} extra units`,
                                p.effect.revenue !== null
                                  ? `≈ ${idr(p.effect.revenue)} sales`
                                  : null,
                                p.effect.profit !== null
                                  ? `${p.effect.profit >= 0 ? "profit" : "loss"} after spend ≈ ${idr(Math.abs(p.effect.profit))}`
                                  : "profit unknown (no cost price)",
                                p.units_per_ig_sale
                                  ? `assumes ${p.units_per_ig_sale} units per Instagram sale`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : "No estimate (marketing figures missing)"}
                        </p>
                        {p.result && (
                          <p className="text-sm">
                            Result: sold {num(Math.round(p.result.sold))} vs a
                            normal {num(Math.round(p.result.normal))} (
                            {p.result.sold - p.result.normal >= 0 ? "+" : ""}
                            {num(Math.round(p.result.sold - p.result.normal))})
                            {p.predicted_units !== null && (
                              <span className="text-muted">
                                {" "}
                                · predicted +
                                {Number(p.predicted_units).toFixed(1)}
                              </span>
                            )}
                          </p>
                        )}
                        {p.reason && (
                          <p className="mt-1 text-sm">“{p.reason}”</p>
                        )}
                      </div>
                      <span className={status.cls}>{status.label}</span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      {p.status === "proposed" && can.confirm(user) && (
                        <form
                          action={confirmPushAction}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="id" value={p.id} />
                          <label className="as-field">
                            Stock note (optional)
                            <input
                              name="note"
                              maxLength={500}
                              placeholder="e.g. 120 in the office, all sizes"
                              className="as-input w-64"
                            />
                          </label>
                          <SubmitButton pendingLabel="Confirming…">
                            Confirm stock
                          </SubmitButton>
                        </form>
                      )}
                      {p.status === "confirmed" && can.approve(user) && (
                        <form
                          action={decidePushAction}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="id" value={p.id} />
                          <label className="as-field">
                            Note (needed to reject)
                            <input
                              name="note"
                              maxLength={500}
                              className="as-input w-64"
                            />
                          </label>
                          <SubmitButton
                            name="decision"
                            value="approve"
                            pendingLabel="Saving…"
                          >
                            Approve
                          </SubmitButton>
                          <SubmitButton
                            name="decision"
                            value="reject"
                            className="as-btn as-btn-quiet"
                            pendingLabel="Saving…"
                          >
                            Reject
                          </SubmitButton>
                        </form>
                      )}
                      {(p.status === "proposed" || p.status === "confirmed") &&
                        (mine || user.role === "admin") && (
                          <form action={withdrawPushAction}>
                            <input type="hidden" name="id" value={p.id} />
                            <SubmitButton
                              className="as-link text-sm"
                              pendingLabel="Withdrawing…"
                            >
                              Withdraw
                            </SubmitButton>
                          </form>
                        )}
                    </div>

                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer text-muted">
                        History and notes ({p.events.length})
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {p.events.map((e) => (
                          <li key={e.id}>
                            <span className="text-muted">
                              {DAY_TIME.format(new Date(e.created_at))}
                            </span>{" "}
                            · {e.actor}
                            {e.actor_role ? ` (${e.actor_role})` : ""}{" "}
                            {ACTION_TEXT[e.action] ?? e.action}
                            {e.note ? `: “${e.note}”` : ""}
                          </li>
                        ))}
                      </ul>
                      <form
                        action={commentPushAction}
                        className="mt-2 flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="id" value={p.id} />
                        <label className="as-field">
                          Add a note
                          <input
                            name="note"
                            maxLength={1000}
                            required
                            className="as-input w-72"
                          />
                        </label>
                        <SubmitButton
                          className="as-btn as-btn-quiet"
                          pendingLabel="Adding…"
                        >
                          Add note
                        </SubmitButton>
                      </form>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      <Card
        className="mt-6"
        title="How the numbers are worked out"
        note="Every figure on this page, from the data already in the app."
      >
        <div className="space-y-3 px-5 pb-5 text-sm leading-relaxed">
          <p>
            <strong>Normal month</strong> - each item&apos;s usual sales with
            the tourist season taken out: the average of (units sold ÷ season
            factor) over the last 6 complete months. Next year&apos;s sales =
            normal month × that month&apos;s season factor × any events entered
            on the PO planner (e.g. Lebaran).
          </p>
          <p>
            <strong>Months of stock</strong> = stock ÷ normal month. Stock rolls
            forward each month: + open purchase orders arriving - expected sales
            - extra sales from pushes. <strong>Target</strong> = the supplier
            lead time from the Lead times page + 1 month (or what an admin sets
            below); anything above it is the <strong>large pile</strong>.
            <strong> Old stock</strong> = units that arrived more than{" "}
            {agedDays} days ago, from Odoo.
          </p>
          <p>
            <strong>Cost of an Instagram store sale</strong> = Meta ad spend ÷
            store customers who came from Instagram (the Visitors sheet&apos;s
            Instagram walk-ins - the same number the Financials sheet reports as
            in-store sales from ads):{" "}
            {response ? (
              <>
                {idr(response.spend)} ÷ {num(Math.round(response.igSales))}{" "}
                Instagram store sales over {response.months.length} months (
                {monthLong(response.months[0])} to{" "}
                {monthLong(response.months[response.months.length - 1])}) ={" "}
                <strong>{idr(response.costPerIgSale)}</strong> per sale.
              </>
            ) : (
              "no data yet."
            )}{" "}
            All Meta spend is counted, including ads aimed at online sales, so
            this errs on the expensive side.
          </p>
          <p>
            <strong>Extra units from a push</strong> = spend ÷ cost per
            Instagram sale × units of the item per sale. The normal units per
            sale is the item&apos;s share of store sales - its units ÷ every POS
            order, last 6 months:{" "}
            {items
              .map(
                (i) =>
                  `${i.item.label} ${i.unitsPerSale === null ? "no data" : i.unitsPerSale.toFixed(3)}`,
              )
              .join(", ")}
            . Ads that feature the item should do better - whoever proposes can
            say so, and the result is checked once the month is over.
          </p>
          <p>
            <strong>Profit</strong> = extra units × (average selling price -
            cost price) - spend. Price is the last 3 months&apos; average; cost
            is Odoo&apos;s cost price:{" "}
            {items
              .map(
                (i) =>
                  `${i.item.label} ${i.price === null ? "no price" : idrCompact(i.price)} / ${i.cost === null ? "no cost in Odoo" : idrCompact(i.cost)}`,
              )
              .join(", ")}
            . <strong>Ask by</strong> = the first month a pile appears, minus{" "}
            {settings.askLeadMonths} month
            {settings.askLeadMonths === 1 ? "" : "s"} to get the budget
            approved.
          </p>
          <p className="text-muted">
            Stock, costs and stock age refresh with the stock sync from Odoo
            (every morning, or{" "}
            <Link href="/forecast/overview" className="as-link">
              Sync stock now
            </Link>
            ).
          </p>
        </div>
      </Card>

      {can.settings(user) && (
        <section id="settings" className="mt-6 scroll-mt-20">
          <Card title="Settings" note="Admin only.">
            <form
              action={saveBudgetSettingsAction}
              className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3"
            >
              <label className="as-field">
                Old stock after (days)
                <input
                  name="agedDays"
                  type="number"
                  min={30}
                  max={1000}
                  defaultValue={settings.agedDays}
                  className="as-input"
                />
              </label>
              <label className="as-field">
                Ask for budget (months ahead)
                <input
                  name="askLead"
                  type="number"
                  min={0}
                  max={6}
                  step={1}
                  defaultValue={settings.askLeadMonths}
                  className="as-input"
                />
              </label>
              <div className="hidden lg:block" />
              {items.map((i) => (
                <label key={i.item.key} className="as-field">
                  {i.item.label}: target months of stock
                  <input
                    name={`target_${i.item.key}`}
                    type="number"
                    min={0.5}
                    max={24}
                    step={0.5}
                    defaultValue={settings.targetOverrides[i.item.key] ?? ""}
                    placeholder={`auto: ${i.target.months.toFixed(1)}`}
                    className="as-input"
                  />
                </label>
              ))}
              <fieldset className="sm:col-span-2 lg:col-span-3">
                <legend className="as-eyebrow mb-2">
                  Who approves (the CEO)
                </legend>
                {plan.people.length === 0 ? (
                  <p className="text-sm text-muted">
                    Run the budget planner migration first.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {plan.people.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          name="approver"
                          value={p.id}
                          defaultChecked={p.canApprove}
                        />{" "}
                        {p.email} <span className="text-muted">({p.role})</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <div>
                <SubmitButton pendingLabel="Saving…">
                  Save settings
                </SubmitButton>
              </div>
            </form>
          </Card>
        </section>
      )}
    </>
  );
}
