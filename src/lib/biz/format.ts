/**
 * Number formatting for the dashboard / sales / inventory screens. Same
 * conventions the rest of the app already uses: rupiah with Indonesian
 * digit grouping ("Rp 1.131.064.000"), plain counts with commas ("1,295").
 */

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const COUNT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function idr(value: number): string {
  return IDR.format(Math.round(value)).replace(/ /g, " ");
}

/** Axis / chip scale: "Rp 1.13B", "Rp 245M", "Rp 2.4M", "Rp 245k". M = million, B = billion. */
export function idrCompact(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));
  if (abs >= 1e9) return `${sign}Rp ${trim(abs / 1e9, 2)}B`;
  if (abs >= 1e7) return `${sign}Rp ${trim(abs / 1e6, 0)}M`;
  if (abs >= 1e6) return `${sign}Rp ${trim(abs / 1e6, 1)}M`;
  if (abs >= 1e3) return `${sign}Rp ${trim(abs / 1e3, 0)}k`;
  return `${sign}Rp ${Math.round(abs)}`;
}

export function num(value: number): string {
  return COUNT.format(value);
}

export function pct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export interface Change {
  /** Percentage change, or null when there is nothing meaningful to compare with. */
  pct: number | null;
  direction: "up" | "down" | "flat" | null;
}

/**
 * Change against the comparison period. A missing or zero baseline gives
 * `pct: null` - "up infinity %" from an empty comparison window is noise,
 * and an empty window usually means the data doesn't reach back that far.
 */
export function change(current: number | null | undefined, previous: number | null | undefined): Change {
  if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) {
    return { pct: null, direction: null };
  }
  const value = ((current - previous) / Math.abs(previous)) * 100;
  return { pct: value, direction: Math.abs(value) < 0.05 ? "flat" : value > 0 ? "up" : "down" };
}

export function changeText(c: Change): string | null {
  if (c.pct === null) return null;
  const arrow = c.direction === "up" ? "▲" : c.direction === "down" ? "▼" : "•";
  return `${arrow} ${Math.abs(c.pct).toFixed(1)}%`;
}

/** "ASASI Canggu" / "ASASI. UBUD" -> "Canggu" / "Ubud": the brand prefix is noise inside the brand's own app. */
export function shortStoreName(name: string): string {
  const stripped = name.replace(/^asasi\.?\s*/i, "").trim();
  if (!stripped) return name;
  return stripped === stripped.toUpperCase()
    ? stripped.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase())
    : stripped;
}
