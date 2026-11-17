import { addDays, addMonths, startOfMonth, type Period } from "./period";
import type { DailyPoint } from "./sales";

/**
 * Turns the daily sales rows for a period into evenly spaced chart buckets
 * (days, Monday-start weeks, or months - whatever the period calls for).
 *
 * A bucket with no rows at all stays `null` and is drawn as a gap: with
 * several shops trading, an empty day is far more likely to be a stretch the
 * Odoo sync hasn't covered than a day of zero sales, and a gap is the honest
 * way to draw either. Buckets after `today` are always null.
 */

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_TITLE = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
const MONTH_TITLE = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

function mondayOf(date: string): string {
  return addDays(date, -((utc(date).getUTCDay() + 6) % 7));
}

export interface Bucket {
  /** First day of the bucket. */
  start: string;
  label: string;
  title: string;
}

export function bucketsFor(range: { from: string; to: string }, bucket: Period["bucket"]): Bucket[] {
  const out: Bucket[] = [];
  if (bucket === "day") {
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
      out.push({ start: d, label: DAY_LABEL.format(utc(d)), title: DAY_TITLE.format(utc(d)) });
    }
  } else if (bucket === "week") {
    for (let d = mondayOf(range.from); d <= range.to; d = addDays(d, 7)) {
      const first = d < range.from ? range.from : d;
      const last = addDays(d, 6) > range.to ? range.to : addDays(d, 6);
      out.push({
        start: d,
        label: DAY_LABEL.format(utc(first)),
        title: `${DAY_LABEL.format(utc(first))} - ${DAY_TITLE.format(utc(last)).replace(/^\w+ /, "")}`,
      });
    }
  } else {
    for (let d = startOfMonth(range.from); d <= range.to; d = addMonths(d, 1)) {
      out.push({ start: d, label: MONTH_LABEL.format(utc(d)), title: MONTH_TITLE.format(utc(d)) });
    }
  }
  return out;
}

function bucketStart(day: string, bucket: Period["bucket"]): string {
  return bucket === "day" ? day : bucket === "week" ? mondayOf(day) : startOfMonth(day);
}

export function seriesFor(
  buckets: Bucket[],
  bucket: Period["bucket"],
  points: DailyPoint[],
  metric: "revenue" | "units" | "orders",
  today: string,
): (number | null)[] {
  const sums = new Map<string, number>();
  for (const p of points) {
    const key = bucketStart(p.day, bucket);
    sums.set(key, (sums.get(key) ?? 0) + p[metric]);
  }
  return buckets.map((b) => (b.start > today ? null : (sums.get(b.start) ?? null)));
}
