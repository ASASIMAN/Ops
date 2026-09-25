import { createAdminClient } from "@/lib/supabase/admin";
import { BALI_TZ } from "@/lib/creative-brief/format";
import { paletteCss, paletteVar } from "@/lib/viz/palette";

export const dynamic = "force-dynamic";

// How many variants to pull per window when ranking by units. Generous on
// purpose: the recent-half and prior-half windows both have to be able to
// find a variant that ranks inside the full window's top N, or its trend
// silently reads as zero. See the merge comment below.
const FETCH_LIMIT = 200;
// How many rows the table actually shows, sorted by recommended qty.
const TABLE_LIMIT = 50;
const BAR_LIMIT = 15;

const WINDOW_OPTIONS = [14, 30, 60, 90];
const HORIZON_OPTIONS = [14, 30, 60, 90];
const BUFFER_OPTIONS = [0, 10, 15, 20, 25, 30];

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_HORIZON_DAYS = 30;
const DEFAULT_BUFFER_PCT = 15;

// Stores hidden from the filter picker - same list as /operations, kept in
// sync by hand since this is the only other place that needs it.
const HIDDEN_STORE_NAMES = new Set(["nsa"]);

const BALI_UTC_OFFSET = "+08:00";
const DAY_MS = 24 * 60 * 60 * 1000;

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

// en-CA gives YYYY-MM-DD directly, which is what the rest of this file's
// date arithmetic (and the <input type="date">) wants.
const baliDateStrFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BALI_TZ,
});

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function utcMidnight(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function addDays(date: string, days: number): string {
  return new Date(utcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function pickOption(options: number[], raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return options.includes(n) ? n : fallback;
}

interface SearchParams {
  window?: string;
  horizon?: string;
  buffer?: string;
  store?: string | string[];
  color?: string | string[];
  size?: string | string[];
  type?: string | string[];
}

interface TopVariantRow {
  product_id: number;
  product_name: string;
  sku: string | null;
  color: string | null;
  size: string | null;
  variant_type: string | null;
  category_name: string | null;
  units: number;
  revenue: number;
}

interface ForecastRow {
  productId: number;
  name: string;
  sku: string | null;
  color: string | null;
  size: string | null;
  variantType: string | null;
  categoryName: string | null;
  windowUnits: number;
  windowRevenue: number;
  dailyVelocity: number;
  forecastUnits: number;
  recommendedQty: number;
  trendPct: number | null; // null = no sales in the prior half to compare against
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <h2 className="text-lg font-medium">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
    </>
  );
}

async function rollup<T>(
  call: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: string | null }> {
  const { data, error } = await call;
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as T[], error: null };
}

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Production Forecast</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Not set up yet - SUPABASE_SERVICE_ROLE_KEY is missing. See the
          README for what to configure before this page will work.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const windowDays = pickOption(WINDOW_OPTIONS, params.window, DEFAULT_WINDOW_DAYS);
  const horizonDays = pickOption(HORIZON_OPTIONS, params.horizon, DEFAULT_HORIZON_DAYS);
  const bufferPct = pickOption(BUFFER_OPTIONS, params.buffer, DEFAULT_BUFFER_PCT);
  const storeIds = toArray(params.store).map(Number).filter(Number.isFinite);
  const colors = toArray(params.color);
  const sizes = toArray(params.size);
  const types = toArray(params.type);

  const supabase = createAdminClient();

  // "Today" in Bali time - the forecast is always anchored to now, not to a
  // date range someone picks, since this is forward-looking (what to
  // produce next), not a historical report like /operations.
  const today = baliDateStrFormatter.format(new Date());
  const recentHalfDays = Math.max(Math.round(windowDays / 2), 1);
  const priorHalfDays = Math.max(windowDays - recentHalfDays, 1);

  const toIso = `${addDays(today, 1)}T00:00:00${BALI_UTC_OFFSET}`;
  const recentFromDate = addDays(today, -recentHalfDays);
  const recentFromIso = `${recentFromDate}T00:00:00${BALI_UTC_OFFSET}`;
  const windowFromDate = addDays(recentFromDate, -priorHalfDays);
  const windowFromIso = `${windowFromDate}T00:00:00${BALI_UTC_OFFSET}`;

  const { error: variantTypeProbeError } = await supabase
    .from("products")
    .select("variant_type")
    .limit(1);
  const hasVariantType = !variantTypeProbeError;

  const baseFilters = {
    p_store_ids: storeIds.length ? storeIds : null,
    p_colors: colors.length ? colors : null,
    p_sizes: sizes.length ? sizes : null,
    p_types: types.length ? types : null,
  };

  const [
    { data: stores },
    { data: colorRows },
    { data: sizeRows },
    { data: typeRows },
    windowResult,
    recentHalfResult,
    priorHalfResult,
  ] = await Promise.all([
    supabase.from("stores").select("id, name").eq("active", true).order("name"),
    supabase.from("products").select("color").not("color", "is", null),
    supabase.from("products").select("size").not("size", "is", null),
    hasVariantType
      ? supabase.from("products").select("variant_type").not("variant_type", "is", null)
      : Promise.resolve({ data: [] as { variant_type: string }[] }),
    rollup<TopVariantRow>(
      supabase.rpc("ops_top_variants", {
        ...baseFilters,
        p_from: windowFromIso,
        p_to: toIso,
        p_limit: FETCH_LIMIT,
      }),
    ),
    rollup<TopVariantRow>(
      supabase.rpc("ops_top_variants", {
        ...baseFilters,
        p_from: recentFromIso,
        p_to: toIso,
        p_limit: FETCH_LIMIT,
      }),
    ),
    rollup<TopVariantRow>(
      supabase.rpc("ops_top_variants", {
        ...baseFilters,
        p_from: windowFromIso,
        p_to: recentFromIso,
        p_limit: FETCH_LIMIT,
      }),
    ),
  ]);

  const selectableStores = (stores ?? []).filter(
    (s) => !HIDDEN_STORE_NAMES.has(s.name.trim().toLowerCase()),
  );
  const availableColors = Array.from(
    new Set((colorRows ?? []).map((r) => r.color as string)),
  ).sort();
  const availableSizes = Array.from(
    new Set((sizeRows ?? []).map((r) => r.size as string)),
  ).sort();
  const availableTypes = Array.from(
    new Set((typeRows ?? []).map((r) => r.variant_type as string)),
  ).sort();

  const rollupError = windowResult.error || recentHalfResult.error || priorHalfResult.error;

  // Merge the three windows by variant. The full window is the source of
  // truth for which variants exist and their total units; the two halves
  // are only consulted for the trend indicator, so a variant missing from
  // one of them (it ranked outside FETCH_LIMIT there) just reads as no
  // sales in that half rather than an error.
  const recentUnitsById = new Map(recentHalfResult.rows.map((r) => [r.product_id, Number(r.units)]));
  const priorUnitsById = new Map(priorHalfResult.rows.map((r) => [r.product_id, Number(r.units)]));

  const forecastRows: ForecastRow[] = windowResult.rows.map((r) => {
    const windowUnits = Number(r.units);
    const dailyVelocity = windowUnits / windowDays;
    const forecastUnits = Math.ceil(dailyVelocity * horizonDays);
    const recommendedQty = Math.ceil(forecastUnits * (1 + bufferPct / 100));

    const recentUnits = recentUnitsById.get(r.product_id) ?? 0;
    const priorUnits = priorUnitsById.get(r.product_id) ?? 0;
    const recentVelocity = recentUnits / recentHalfDays;
    const priorVelocity = priorUnits / priorHalfDays;
    const trendPct =
      priorVelocity > 0
        ? ((recentVelocity - priorVelocity) / priorVelocity) * 100
        : recentVelocity > 0
          ? null // selling now but wasn't in the prior half - "new", not a %
          : 0;

    return {
      productId: r.product_id,
      name: r.product_name,
      sku: r.sku,
      color: r.color,
      size: r.size,
      variantType: r.variant_type,
      categoryName: r.category_name,
      windowUnits,
      windowRevenue: Number(r.revenue),
      dailyVelocity,
      forecastUnits,
      recommendedQty,
      trendPct,
    };
  });

  forecastRows.sort((a, b) => b.recommendedQty - a.recommendedQty);
  const tableRows = forecastRows.slice(0, TABLE_LIMIT);
  const barRows = forecastRows.slice(0, BAR_LIMIT);
  const maxRecommendedQty = Math.max(...barRows.map((r) => r.recommendedQty), 1);

  const totalWindowUnits = forecastRows.reduce((sum, r) => sum + r.windowUnits, 0);
  const totalWindowRevenue = forecastRows.reduce((sum, r) => sum + r.windowRevenue, 0);
  const totalForecastUnits = forecastRows.reduce((sum, r) => sum + r.forecastUnits, 0);
  const totalRecommendedQty = forecastRows.reduce((sum, r) => sum + r.recommendedQty, 0);
  const cappedAtFetchLimit = windowResult.rows.length >= FETCH_LIMIT;

  const BAR_SCOPE = "forecast-bar";

  return (
    <div className={`mx-auto max-w-6xl px-6 py-10 ${BAR_SCOPE}`}>
      <style dangerouslySetInnerHTML={{ __html: paletteCss(BAR_SCOPE, ["bar"]) }} />
      <h1 className="text-2xl font-semibold tracking-tight">Production Forecast</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Projected demand per variant, based on recent sell-through in the
        same synced Odoo sales data as Operations.
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        This is a demand estimate, not a reorder number - the app doesn&apos;t
        track current stock or work-in-progress, so it can&apos;t net out
        what&apos;s already on hand. Treat &quot;Recommended qty&quot; as what
        the trailing sell-through says the next {horizonDays} days will need,
        plus a buffer, and check it against actual stock before committing a
        production run.
      </p>

      <form
        method="get"
        className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            Trailing window
            <select
              name="window"
              defaultValue={windowDays}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            >
              {WINDOW_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  Last {d} days
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Forecast horizon
            <select
              name="horizon"
              defaultValue={horizonDays}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            >
              {HORIZON_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  Next {d} days
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Safety buffer
            <select
              name="buffer"
              defaultValue={bufferPct}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            >
              {BUFFER_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  +{p}%
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Colour
            <select
              multiple
              name="color"
              defaultValue={colors}
              className="h-24 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            >
              {availableColors.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            Size
            <select
              multiple
              name="size"
              defaultValue={sizes}
              className="h-24 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            >
              {availableSizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm">Stores</legend>
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">
            {selectableStores.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
              >
                <input
                  type="checkbox"
                  name="store"
                  value={s.id}
                  defaultChecked={storeIds.includes(s.id)}
                  className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
                />
                {s.name}
              </label>
            ))}
            {!selectableStores.length && (
              <span className="text-sm text-zinc-500">No stores synced yet.</span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">Nothing ticked = all stores.</p>
        </fieldset>

        {hasVariantType && availableTypes.length > 0 && (
          <fieldset className="mt-4">
            <legend className="text-sm">Type</legend>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">
              {availableTypes.map((t) => (
                <label
                  key={t}
                  className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                >
                  <input
                    type="checkbox"
                    name="type"
                    value={t}
                    defaultChecked={types.includes(t)}
                    className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
                  />
                  {t}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <button
          type="submit"
          className="mt-4 rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          Apply
        </button>
      </form>

      {rollupError && (
        <p className="mt-6 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
          Not shown - the sales rollup functions aren&apos;t in the database
          yet. Run <code>supabase/migrations/0022_variants_and_sales_rollups.sql</code>{" "}
          in the Supabase SQL editor. ({rollupError})
        </p>
      )}

      {!rollupError && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500">Sold, last {windowDays}d</div>
              <div className="text-xl font-semibold">{totalWindowUnits.toLocaleString()}</div>
              <div className="text-xs text-zinc-400">{currencyFormatter.format(totalWindowRevenue)}</div>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500">Forecast, next {horizonDays}d</div>
              <div className="text-xl font-semibold">{totalForecastUnits.toLocaleString()}</div>
              <div className="text-xs text-zinc-400">units, no buffer</div>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500">Recommended to produce</div>
              <div className="text-xl font-semibold">{totalRecommendedQty.toLocaleString()}</div>
              <div className="text-xs text-zinc-400">with +{bufferPct}% buffer</div>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500">Variants with sales</div>
              <div className="text-xl font-semibold">{forecastRows.length.toLocaleString()}</div>
              <div className="text-xs text-zinc-400">in the trailing window</div>
            </div>
          </div>
          {cappedAtFetchLimit && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
              {FETCH_LIMIT}+ variants sold in this window - the totals above
              stop at the top {FETCH_LIMIT} by units, not the full catalogue.
            </p>
          )}

          {!forecastRows.length ? (
            <p className="mt-10 text-sm text-zinc-500">
              No sales in the trailing window for this filter - nothing to
              forecast from yet.
            </p>
          ) : (
            <>
              <div className="mt-10">
                <SectionHeading
                  title={`Top ${barRows.length} by recommended production qty`}
                  subtitle={`Trailing ${windowDays}-day sell-through, projected ${horizonDays} days forward, plus the +${bufferPct}% buffer.`}
                />
                <div className="mt-3 space-y-2">
                  {barRows.map((r) => (
                    <div key={r.productId} className="text-xs">
                      <div className="flex justify-between gap-3 text-zinc-500">
                        <span className="truncate" title={r.sku ? `${r.name} (${r.sku})` : r.name}>
                          {r.name}
                          {r.sku && <span className="text-zinc-400"> · {r.sku}</span>}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {r.recommendedQty.toLocaleString()} units
                        </span>
                      </div>
                      <div className="mt-0.5 h-3 bg-zinc-100 dark:bg-zinc-900">
                        <div
                          className="h-3"
                          style={{
                            width: `${(r.recommendedQty / maxRecommendedQty) * 100}%`,
                            backgroundColor: paletteVar("bar"),
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-10">
                <SectionHeading
                  title="Forecast by variant"
                  subtitle={`One row per SKU, top ${TABLE_LIMIT} by recommended qty. Trend compares the most recent ${recentHalfDays} days of the window to the ${priorHalfDays} before that.`}
                />
                <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">SKU</th>
                        <th className="px-3 py-2">Product</th>
                        <th className="px-3 py-2">Colour</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Size</th>
                        <th className="px-3 py-2 text-right">
                          Sold ({windowDays}d)
                        </th>
                        <th className="px-3 py-2 text-right">Units/day</th>
                        <th className="px-3 py-2 text-right">Trend</th>
                        <th className="px-3 py-2 text-right">
                          Forecast ({horizonDays}d)
                        </th>
                        <th className="px-3 py-2 text-right">Recommended</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((r, i) => (
                        <tr
                          key={r.productId}
                          className="border-t border-zinc-100 dark:border-zinc-800"
                        >
                          <td className="px-3 py-2 text-zinc-400">{i + 1}</td>
                          <td className="px-3 py-2 font-mono text-xs">{r.sku ?? "-"}</td>
                          <td className="px-3 py-2">{r.name}</td>
                          <td className="px-3 py-2">{r.color ?? "-"}</td>
                          <td className="px-3 py-2">{r.variantType ?? "-"}</td>
                          <td className="px-3 py-2">{r.size ?? "-"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.windowUnits.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.dailyVelocity.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.trendPct === null ? (
                              <span className="text-zinc-400">new</span>
                            ) : r.trendPct === 0 ? (
                              <span className="text-zinc-400">-</span>
                            ) : (
                              <span
                                className={
                                  r.trendPct > 0
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-red-600 dark:text-red-400"
                                }
                              >
                                {r.trendPct > 0 ? "▲" : "▼"} {Math.abs(r.trendPct).toFixed(0)}%
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.forecastUnits.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">
                            {r.recommendedQty.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {forecastRows.length > TABLE_LIMIT && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Showing the top {TABLE_LIMIT} of {forecastRows.length}{" "}
                    variants with sales in this window, ranked by recommended
                    qty.
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
