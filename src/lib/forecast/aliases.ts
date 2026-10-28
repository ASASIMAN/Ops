import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Colour/size name reconciliation (migration 0031). Every place that
 * groups or joins by colour/size across sources - the dropdowns, the
 * trailing-sales-mix allocation, the PO grid's CMT-price lookup -
 * canonicalizes through this first, so "Bone" and "Off White" (or
 * whatever the business's own aliases turn out to be) are treated as
 * one value rather than two, without any string-similarity guessing.
 */
export interface AttributeAliasMap {
  color: Map<string, string>;
  size: Map<string, string>;
}

export async function fetchAttributeAliases(supabase: SupabaseClient): Promise<AttributeAliasMap> {
  const { data } = await supabase.from("attribute_aliases").select("attribute_type, canonical_value, alias_value");
  const map: AttributeAliasMap = { color: new Map(), size: new Map() };
  for (const r of data ?? []) {
    const type = r.attribute_type as "color" | "size";
    if (type === "color" || type === "size") {
      map[type].set(r.alias_value, r.canonical_value);
    }
  }
  return map;
}

export function canonicalColor(value: string | null, aliases: AttributeAliasMap): string | null {
  if (value === null) return null;
  return aliases.color.get(value) ?? value;
}

export function canonicalSize(value: string | null, aliases: AttributeAliasMap): string | null {
  if (value === null) return null;
  return aliases.size.get(value) ?? value;
}
