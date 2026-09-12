// Bali is WITA (UTC+8), not WIB (UTC+7, Jakarta) - confirmed with the
// user this app should show local Bali time, not Jakarta time.
export const BALI_TZ = "Asia/Makassar";

const baliDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BALI_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const baliDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BALI_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const baliMonthFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BALI_TZ,
  month: "long",
  year: "numeric",
});

export function formatBaliDate(dateStr: string): string {
  return baliDateFormatter.format(new Date(dateStr + "T00:00:00Z"));
}

export function formatBaliDateTime(isoTimestamp: string): string {
  return `${baliDateTimeFormatter.format(new Date(isoTimestamp))} WITA`;
}

/**
 * "Rp 2.4M" / "Rp 245k" style - the human-scale format the creative team
 * asked for, distinct from the full-precision "Rp303,893" formatter used
 * elsewhere in the app for exact financial figures.
 */
export function formatRupiahCompact(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const millions = Math.round((abs / 1_000_000) * 10) / 10;
    const text = Number.isInteger(millions) ? `${millions}` : millions.toFixed(1);
    return `${sign}Rp ${text}M`;
  }
  if (abs >= 1_000) {
    return `${sign}Rp ${Math.round(abs / 1_000)}k`;
  }
  return `${sign}Rp ${Math.round(abs)}`;
}
