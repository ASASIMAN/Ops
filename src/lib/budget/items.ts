/**
 * The core items the marketing budget planner covers. Each is a group of
 * Odoo styles (product templates) matched by name, with every colour and
 * size included. The planner page lists exactly which styles each item
 * picked up, so a wrong match is visible rather than silent.
 */
export interface CoreItem {
  key: string;
  label: string;
  /** Plain-English matching rule, shown on the page. */
  rule: string;
  matches: (styleName: string) => boolean;
}

export const CORE_ITEMS: CoreItem[] = [
  { key: "affine", label: "Affine", rule: "Styles named “Affine …”", matches: (n) => /\baffine\b/i.test(n) && !/\bsample\b/i.test(n) },
  {
    key: "kavash",
    label: "Kavash",
    rule: "Styles named “Kavash …”, not the Crop",
    matches: (n) => /\bkavash\b/i.test(n) && !/\bcrop\b/i.test(n) && !/\bsample\b/i.test(n),
  },
  { key: "linen_pants", label: "Linen Pants", rule: "Styles named “… Linen Pants”", matches: (n) => /\blinen pants?\b/i.test(n) && !/\bsample\b/i.test(n) },
  { key: "origin", label: "Origin", rule: "Styles named “Origin …” (shirt, long sleeve, shorts)", matches: (n) => /\borigin\b/i.test(n) && !/\bsample\b/i.test(n) },
];

export const CORE_ITEM_KEYS = CORE_ITEMS.map((i) => i.key);

export function coreItem(key: string): CoreItem | undefined {
  return CORE_ITEMS.find((i) => i.key === key);
}
