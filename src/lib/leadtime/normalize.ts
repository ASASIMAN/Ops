/**
 * Parses free-text vendor lead-time estimates (mixed English/Indonesian,
 * single point or range) into a {minDays, maxDays} range. Pure and
 * side-effect-free - the importer (src/lib/adapters/lead-time-estimates.ts)
 * calls this per row and surfaces anything it can't parse instead of
 * guessing a number, per the brief's "flag, don't silently default" rule.
 *
 * Handles:
 *   "10 days"        -> 10-10
 *   "1 Month"         -> 30-30
 *   "1 Bulan"         -> 30-30 (Indonesian, case-insensitive)
 *   "2-3 Months"      -> 60-90
 *   "4-6 minggu"      -> 28-42 (weeks, Indonesian)
 *   "45 hari"         -> 45-45 (days, Indonesian)
 *   "1.5 bulan"       -> 45-45
 * A unit converts the whole range's numbers - "2-3 Months" is NOT parsed
 * as "2 days to 3 months"; a range must share one unit.
 */

export interface NormalizedLeadTime {
  ok: true;
  minDays: number;
  maxDays: number;
  unit: "day" | "week" | "month";
}

export interface UnparsedLeadTime {
  ok: false;
  raw: string;
}

export type NormalizeResult = NormalizedLeadTime | UnparsedLeadTime;

const UNIT_DAYS: Record<string, number> = {
  day: 1,
  days: 1,
  hari: 1,
  week: 7,
  weeks: 7,
  minggu: 7,
  month: 30,
  months: 30,
  bulan: 30,
};

function unitFor(token: string): "day" | "week" | "month" | null {
  const days = UNIT_DAYS[token];
  if (days === 1) return "day";
  if (days === 7) return "week";
  if (days === 30) return "month";
  return null;
}

// Accepts "-", an en/em dash, or "to"/"s/d" (Indonesian "sampai dengan")
// as the range separator between two numbers sharing one trailing unit.
const RANGE_RE =
  /^(\d+(?:\.\d+)?)\s*(?:-|–|—|to|s\/d|sampai)\s*(\d+(?:\.\d+)?)\s*(hari|days?|minggu|weeks?|bulan|months?)$/i;
const POINT_RE = /^(\d+(?:\.\d+)?)\s*(hari|days?|minggu|weeks?|bulan|months?)$/i;

export function normalizeLeadTimeText(input: string): NormalizeResult {
  // Strip a trailing parenthetical note ("2-3 Months (approx)") rather
  // than letting it break the match - the note itself isn't lost, the
  // caller (the importer) keeps the original string verbatim as `note`.
  const cleaned = input.trim().replace(/\s*\([^)]*\)\s*$/, "");

  const rangeMatch = cleaned.match(RANGE_RE);
  if (rangeMatch) {
    const [, loStr, hiStr, unitToken] = rangeMatch;
    const unit = unitFor(unitToken.toLowerCase());
    const unitDays = UNIT_DAYS[unitToken.toLowerCase()];
    if (unit && unitDays) {
      const lo = Math.round(parseFloat(loStr) * unitDays);
      const hi = Math.round(parseFloat(hiStr) * unitDays);
      return { ok: true, minDays: Math.min(lo, hi), maxDays: Math.max(lo, hi), unit };
    }
  }

  const pointMatch = cleaned.match(POINT_RE);
  if (pointMatch) {
    const [, numStr, unitToken] = pointMatch;
    const unit = unitFor(unitToken.toLowerCase());
    const unitDays = UNIT_DAYS[unitToken.toLowerCase()];
    if (unit && unitDays) {
      const days = Math.round(parseFloat(numStr) * unitDays);
      return { ok: true, minDays: days, maxDays: days, unit };
    }
  }

  return { ok: false, raw: input };
}
