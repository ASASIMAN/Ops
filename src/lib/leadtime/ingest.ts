import type { createAdminClient } from "@/lib/supabase/admin";
import type { ParsedEstimateRow } from "@/lib/adapters/lead-time-estimates";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface IngestResult {
  imported: number;
  autoCreatedProducts: string[]; // new canonical products created for names never seen before
  skippedUnmapped: string[]; // raw names a human explicitly mapped to "no product" - left alone, not overwritten
}

/**
 * Upserts parsed vendor-estimate rows into `lead_times`, source =
 * 'vendor estimate'. Safe to re-run on an overlapping/updated export -
 * same promise as the Meta Ads importer ("updates rather than
 * duplicates"): one row per (product, 'vendor estimate') is kept
 * in-place rather than enforced by a DB constraint, since `vendor` has
 * to stay nullable (per the brief) and Postgres unique constraints
 * don't play well with nullable columns in an onConflict upsert.
 *
 * Every raw product/style name gets EXACTLY one of three outcomes, never
 * a silent merge:
 *   - already mapped to a product -> write/update that product's row.
 *   - never seen before -> a brand-new lead_time_products row is created
 *     1:1 (same name), `auto_created = true`, so it's visibly flagged for
 *     a human to confirm it isn't a duplicate of an existing product
 *     under a slightly different name.
 *   - already mapped to NULL (a human decided this name has no product
 *     yet, e.g. it's a typo or a discontinued line) -> left alone and
 *     reported back, not auto-filled.
 */
export async function ingestLeadTimeEstimates(
  supabase: AdminClient,
  rows: ParsedEstimateRow[],
): Promise<IngestResult> {
  const { data: mappingRows } = await supabase
    .from("lead_time_name_mappings")
    .select("raw_name, lead_time_product_id");
  const mappingByName = new Map(
    (mappingRows ?? []).map((m) => [m.raw_name, m.lead_time_product_id as number | null]),
  );

  const autoCreatedProducts: string[] = [];
  const skippedUnmapped: string[] = [];
  const resolvedRows: (ParsedEstimateRow & { productId: number })[] = [];

  for (const row of rows) {
    if (mappingByName.has(row.rawName)) {
      const productId = mappingByName.get(row.rawName)!;
      if (productId === null) {
        skippedUnmapped.push(row.rawName);
        continue;
      }
      resolvedRows.push({ ...row, productId });
      continue;
    }

    // Never seen before - create a new 1:1 product, never merge into an
    // existing one automatically.
    const { data: product } = await supabase
      .from("lead_time_products")
      .insert({ canonical_name: row.rawName })
      .select("id")
      .single();
    if (!product) continue;

    await supabase
      .from("lead_time_name_mappings")
      .insert({ raw_name: row.rawName, lead_time_product_id: product.id, auto_created: true });

    mappingByName.set(row.rawName, product.id);
    autoCreatedProducts.push(row.rawName);
    resolvedRows.push({ ...row, productId: product.id });
  }

  const productIds = Array.from(new Set(resolvedRows.map((r) => r.productId)));
  const { data: existing } = await supabase
    .from("lead_times")
    .select("id, lead_time_product_id")
    .eq("source", "vendor estimate")
    .in("lead_time_product_id", productIds.length ? productIds : [-1]);
  const existingIdByProduct = new Map((existing ?? []).map((r) => [r.lead_time_product_id, r.id]));

  for (const row of resolvedRows) {
    const existingId = existingIdByProduct.get(row.productId);
    const payload = {
      lead_time_product_id: row.productId,
      vendor: row.vendor,
      min_days: row.minDays,
      max_days: row.maxDays,
      source: "vendor estimate" as const,
      raw_text: row.rawText,
      note: row.note,
      updated_at: new Date().toISOString(),
    };
    if (existingId) {
      await supabase.from("lead_times").update(payload).eq("id", existingId);
    } else {
      await supabase.from("lead_times").insert(payload);
    }
  }

  return { imported: resolvedRows.length, autoCreatedProducts, skippedUnmapped };
}
