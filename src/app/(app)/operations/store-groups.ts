/**
 * Odoo has more than one POS register per physical store: an older-style one
 * ("ASASI Ubud") and a newer one ("ASASI. UBUD"), each its own pos.config and
 * so its own `stores` row and id. For filtering and reporting they're one
 * store, so /operations folds them together.
 *
 * Registers are matched by name rather than a stored mapping: lower-case it,
 * drop the "ASASI" prefix and all spacing/punctuation, so "ASASI Nusa Dua" and
 * "ASASI. NUSA DUA" both become "nusadua". A register that shares no name with
 * another (a future store, NSA) simply forms a group of one.
 */

export function storeGroupKey(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/asasi/g, "")
    .replace(/[^a-z0-9]/g, "");
  return key || name.trim().toLowerCase();
}

export interface StoreGroup {
  key: string;
  label: string;
  ids: number[];
}

export function buildStoreGroups(
  stores: { id: number; name: string }[],
): StoreGroup[] {
  const groups = new Map<
    string,
    { key: string; names: string[]; ids: number[] }
  >();
  for (const s of stores) {
    const key = storeGroupKey(s.name);
    const group = groups.get(key) ?? { key, names: [], ids: [] };
    group.names.push(s.name.trim());
    group.ids.push(s.id);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({
      key: g.key,
      // The older-style name ("ASASI Ubud") reads better than the shouty
      // "ASASI. UBUD", so prefer a name without the stray full stop.
      label: g.names.find((n) => !n.includes(".")) ?? g.names[0],
      ids: g.ids,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
