/**
 * The reporting period every dashboard / sales screen works in, and the
 * period it is compared against.
 *
 * All dates are Bali calendar dates (WITA, UTC+8, no daylight saving), the
 * same day boundary the Odoo sales rollups use.
 *
 * The comparison is always "the same stretch, one period earlier", and the
 * screens print its exact dates so there is never a question of what a
 * percentage is measured against:
 *   today          -> yesterday
 *   this week      -> the same weekdays last week
 *   this month     -> the same day-numbers last month
 *   last month     -> the month before it
 *   this quarter   -> the same stretch of the previous quarter
 *   this year      -> the same stretch of last year
 *   custom range   -> the equally long range immediately before it
 */

export type PeriodKey = "today" | "week" | "month" | "last_month" | "quarter" | "year" | "custom";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "custom", label: "Custom" },
];

export interface Period {
  key: PeriodKey;
  label: string;
  /** First and last day, inclusive, YYYY-MM-DD. */
  from: string;
  to: string;
  /** Timestamps for queries; `toTs` is exclusive. */
  fromTs: string;
  toTs: string;
  days: number;
  rangeLabel: string;
  prev: {
    from: string;
    to: string;
    fromTs: string;
    toTs: string;
    /** e.g. "vs 1 - 17 Oct 2026" */
    label: string;
  };
  /** How finely a trend over this period should be drawn. */
  bucket: "day" | "week" | "month";
}

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(date: string, n: number): string {
  return fromUtc(new Date(toUtc(date).getTime() + n * DAY_MS));
}
/** Same day-of-month `n` months away, clamped to the target month's length (31 Mar - 1 month = 28/29 Feb). */
export function addMonths(date: string, n: number): string {
  const d = toUtc(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromUtc(target);
}
export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS) + 1;
}
/** Midnight Bali time at the start of `date`, as an ISO timestamp. */
export function baliStartTs(date: string): string {
  return `${date}T00:00:00+08:00`;
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** "17 Nov 2026", "1 - 17 Nov 2026", "28 Oct - 3 Nov 2026", "Oct 2026" (a whole calendar month). */
export function formatRange(from: string, to: string): string {
  if (from === to) return DAY_MONTH_YEAR.format(toUtc(from));
  const wholeMonth = from === startOfMonth(from) && addDays(to, 1) === startOfMonth(addDays(to, 1)) && from.slice(0, 7) === to.slice(0, 7);
  if (wholeMonth) return MONTH_YEAR.format(toUtc(from));
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${toUtc(from).getUTCDate()} - ${DAY_MONTH_YEAR.format(toUtc(to))}`;
  }
  if (from.slice(0, 4) === to.slice(0, 4)) {
    return `${DAY_MONTH.format(toUtc(from))} - ${DAY_MONTH_YEAR.format(toUtc(to))}`;
  }
  return `${DAY_MONTH_YEAR.format(toUtc(from))} - ${DAY_MONTH_YEAR.format(toUtc(to))}`;
}

function build(key: PeriodKey, from: string, to: string, prevFrom: string, prevTo: string): Period {
  const days = daysBetween(from, to);
  return {
    key,
    label: PERIOD_OPTIONS.find((o) => o.key === key)!.label,
    from,
    to,
    fromTs: baliStartTs(from),
    toTs: baliStartTs(addDays(to, 1)),
    days,
    rangeLabel: formatRange(from, to),
    prev: {
      from: prevFrom,
      to: prevTo,
      fromTs: baliStartTs(prevFrom),
      toTs: baliStartTs(addDays(prevTo, 1)),
      label: `vs ${formatRange(prevFrom, prevTo)}`,
    },
    bucket: days <= 62 ? "day" : days <= 200 ? "week" : "month",
  };
}

export function resolvePeriod(
  params: { period?: string; from?: string; to?: string },
  today: string,
): Period {
  const key = (PERIOD_OPTIONS.find((o) => o.key === params.period)?.key ?? "month") as PeriodKey;

  switch (key) {
    case "today":
      return build(key, today, today, addDays(today, -1), addDays(today, -1));
    case "week": {
      // ISO week: Monday first.
      const weekday = (toUtc(today).getUTCDay() + 6) % 7;
      const from = addDays(today, -weekday);
      return build(key, from, today, addDays(from, -7), addDays(today, -7));
    }
    case "last_month": {
      const thisMonth = startOfMonth(today);
      const from = addMonths(thisMonth, -1);
      const to = addDays(thisMonth, -1);
      const prevFrom = addMonths(from, -1);
      return build(key, from, to, prevFrom, addDays(from, -1));
    }
    case "quarter": {
      const d = toUtc(today);
      const from = fromUtc(new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)));
      return build(key, from, today, addMonths(from, -3), addMonths(today, -3));
    }
    case "year": {
      const from = `${today.slice(0, 4)}-01-01`;
      return build(key, from, today, addMonths(from, -12), addMonths(today, -12));
    }
    case "custom": {
      const validFrom = params.from && ISO_DATE.test(params.from) && !Number.isNaN(toUtc(params.from).getTime());
      const validTo = params.to && ISO_DATE.test(params.to) && !Number.isNaN(toUtc(params.to).getTime());
      if (validFrom && validTo && params.from! <= params.to!) {
        const from = params.from!;
        const to = params.to!;
        const days = daysBetween(from, to);
        return build(key, from, to, addDays(from, -days), addDays(from, -1));
      }
      // An incomplete custom range falls through to "this month" dates but
      // stays on the Custom tab so the date fields are showing.
      const from = startOfMonth(today);
      return build(key, from, today, addMonths(from, -1), addMonths(today, -1));
    }
    case "month":
    default: {
      const from = startOfMonth(today);
      return build("month", from, today, addMonths(from, -1), addMonths(today, -1));
    }
  }
}

/** The first-of-month dates of every calendar month a period touches. */
export function monthsTouched(period: Pick<Period, "from" | "to">): string[] {
  const out: string[] = [];
  for (let m = startOfMonth(period.from); m <= period.to; m = addMonths(m, 1)) out.push(m);
  return out;
}
