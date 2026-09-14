import { createAdminClient } from "@/lib/supabase/admin";
import { syncNowAction } from "./actions";
import { BALI_TZ, formatRupiahCompact } from "@/lib/creative-brief/format";
import { paletteCss, paletteVar } from "@/lib/viz/palette";

export const dynamic = "force-dynamic";
// Applies to this route's Server Actions too (e.g. the "Sync now" button) -
// the Odoo sync makes several sequential API calls and needs real headroom
// beyond the platform's short default, same as /api/sync/odoo.
export const maxDuration = 60;

const ROW_LIMIT = 1000;
const TOP_VARIANTS_LIMIT = 20;
const TOP_PRODUCTS_LIMIT = 10;

// Stores hidden from the filter picker. NSA isn't a storefront anyone
// reviews sales for. This only removes it as something you can filter *by* -
// its rows still count towards an unfiltered total, exactly as before. Say
// the word if it should be excluded from the numbers as well.
const HIDDEN_STORE_NAMES = new Set(["nsa"]);

// The stores are in Bali (WITA, UTC+8). Date filters and daily buckets are
// both anchored there, so "3 Sep" means the trading day the staff worked,
// not a UTC window that starts at 08:00 local.
const BALI_UTC_OFFSET = "+08:00";
const DAY_MS = 24 * 60 * 60 * 1000;

// Store currency as IDR for now - revisit if a future Odoo instance/store
// uses something else (see README "Currency").
const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const orderDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BALI_TZ,
  day: "numeric",
  month: "short",
  year: "2-digit",
});

// Daily buckets already come back as Bali-local calendar dates, so they get
// formatted as UTC to avoid shifting them a second time.
const dayLabelFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * DAY_MS);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function utcMidnight(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function addDays(date: string, days: number): string {
  return new Date(utcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Rounds up to the next 1/2/5 x 10^n so axis ticks land on round numbers. */
function niceStep(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

interface SearchParams {
  from?: string;
  to?: string;
  store?: string | string[];
  color?: string | string[];
  size?: string | string[];
  type?: string | string[];
}

interface DailyRow {
  day: string;
  revenue: number;
  units: number;
  order_count: number;
}
interface StoreRollupRow {
  store_id: number | null;
  store_name: string;
  units: number;
  revenue: number;
}
interface TopProductRow {
  template_id: number;
  product_name: string;
  units: number;
  revenue: number;
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
interface TotalsRow {
  revenue: number;
  units: number;
  order_count: number;
  line_count: number;
}

/**
 * Rollups live in Postgres functions (migration 0022) because the line table
 * below is capped at ROW_LIMIT - aggregating the capped rows in JS would
 * quietly describe only the first 1000 lines. If the migration hasn't been
 * run yet the page still works: every section that needs a rollup says so
 * instead of rendering a number it can't stand behind.
 */
async function rollup<T>(
  call: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: string | null }> {
  const { data, error } = await call;
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as T[], error: null };
}

function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <>
      <h2 className="text-lg font-medium">{title}</h2>
      {subtitle && (
        <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
      )}
    </>
  );
}

function RollupUnavailable({ message }: { message: string }) {
  return (
    <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
      Not shown - the sales rollup functions aren&apos;t in the database yet.
      Run <code>supabase/migrations/0022_variants_and_sales_rollups.sql</code>{" "}
      in the Supabase SQL editor. ({message})
    </p>
  );
}

const CHART_W = 720;
const CHART_H = 240;
const PAD_L = 64;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 26;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sales Dashboard
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Not set up yet - SUPABASE_SERVICE_ROLE_KEY is missing. See the
          README for what to configure before this page will work.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const defaults = defaultDateRange();
  const from = params.from || defaults.from;
  const to = params.to || defaults.to;
  const storeIds = toArray(params.store).map(Number).filter(Number.isFinite);
  const colors = toArray(params.color);
  const sizes = toArray(params.size);
  const types = toArray(params.type);

  // Half-open [from 00:00 WITA, day-after-to 00:00 WITA) so the last day is
  // included whole rather than stopping a second short of midnight.
  const fromIso = `${from}T00:00:00${BALI_UTC_OFFSET}`;
  const toIso = `${addDays(to, 1)}T00:00:00${BALI_UTC_OFFSET}`;

  const supabase = createAdminClient();

  const returnTo = new URLSearchParams();
  if (params.from) returnTo.set("from", params.from);
  if (params.to) returnTo.set("to", params.to);
  for (const v of toArray(params.store)) returnTo.append("store", v);
  for (const v of toArray(params.color)) returnTo.append("color", v);
  for (const v of toArray(params.size)) returnTo.append("size", v);
  for (const v of toArray(params.type)) returnTo.append("type", v);
  const returnToUrl = `/operations${returnTo.toString() ? `?${returnTo}` : ""}`;

  // products.variant_type only exists once migration 0022 has been run.
  // Probe for it rather than letting every query on this page 400.
  const { error: variantTypeProbeError } = await supabase
    .from("products")
    .select("variant_type")
    .limit(1);
  const hasVariantType = !variantTypeProbeError;

  const rollupArgs = {
    p_from: fromIso,
    p_to: toIso,
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
    { data: lastSync },
    totalsResult,
    dailyResult,
    byStoreResult,
    topProductsResult,
    topVariantsResult,
  ] = await Promise.all([
    supabase.from("stores").select("id, name").eq("active", true).order("name"),
    supabase.from("products").select("color").not("color", "is", null),
    supabase.from("products").select("size").not("size", "is", null),
    hasVariantType
      ? supabase
          .from("products")
          .select("variant_type")
          .not("variant_type", "is", null)
      : Promise.resolve({ data: [] as { variant_type: string }[] }),
    supabase
      .from("sync_runs")
      .select("status, started_at, finished_at, orders_synced, error_message")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    rollup<TotalsRow>(supabase.rpc("ops_sales_totals", rollupArgs)),
    rollup<DailyRow>(supabase.rpc("ops_sales_daily", rollupArgs)),
    rollup<StoreRollupRow>(supabase.rpc("ops_sales_by_store", rollupArgs)),
    rollup<TopProductRow>(
      supabase.rpc("ops_top_products", {
        ...rollupArgs,
        p_limit: TOP_PRODUCTS_LIMIT,
      }),
    ),
    rollup<TopVariantRow>(
      supabase.rpc("ops_top_variants", {
        ...rollupArgs,
        p_limit: TOP_VARIANTS_LIMIT,
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

  const productColumns = [
    "name",
    "sku",
    "color",
    "size",
    hasVariantType ? "variant_type" : null,
    "category_id",
    "product_categories ( id, name )",
  ]
    .filter(Boolean)
    .join(", ");

  let query = supabase
    .from("order_lines")
    .select(
      `
      id, qty, unit_price, subtotal,
      orders!inner ( order_date, store_id, pos_reference, stores ( id, name ) ),
      products!inner ( ${productColumns} )
    `,
    )
    .gte("orders.order_date", fromIso)
    .lt("orders.order_date", toIso)
    .order("order_date", { referencedTable: "orders", ascending: false })
    .limit(ROW_LIMIT);

  if (storeIds.length) query = query.in("orders.store_id", storeIds);
  if (colors.length) query = query.in("products.color", colors);
  if (sizes.length) query = query.in("products.size", sizes);
  if (types.length && hasVariantType)
    query = query.in("products.variant_type", types);

  const { data: rows, error } = await query;

  type Row = {
    id: number;
    qty: number;
    unit_price: number;
    subtotal: number;
    orders: {
      order_date: string;
      pos_reference: string | null;
      stores: { id: number; name: string } | null;
    } | null;
    products: {
      name: string;
      sku: string | null;
      color: string | null;
      size: string | null;
      variant_type?: string | null;
      product_categories: { id: number; name: string } | null;
    } | null;
  };

  const lines = (rows ?? []) as unknown as Row[];

  const totals = totalsResult.rows[0];
  // Fall back to the capped rows only if the rollup isn't available, and
  // label the tiles accordingly rather than passing a partial sum off as the
  // real total.
  const totalsAreCapped = !totals;
  const totalRevenue = totals
    ? Number(totals.revenue)
    : lines.reduce((sum, l) => sum + Number(l.subtotal), 0);
  const totalQty = totals
    ? Number(totals.units)
    : lines.reduce((sum, l) => sum + Number(l.qty), 0);
  const totalOrders = totals ? Number(totals.order_count) : null;
  const totalLines = totals ? Number(totals.line_count) : lines.length;

  // --- Daily sales bars -----------------------------------------------
  const daily = dailyResult.rows.map((d) => ({
    day: d.day,
    revenue: Number(d.revenue),
    units: Number(d.units),
    orders: Number(d.order_count),
  }));
  const spanDays = Math.max(
    Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS) + 1,
    1,
  );
  const positiveDays = daily.filter((d) => d.revenue > 0);
  const negativeDayCount = daily.length - positiveDays.length;

  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;
  const dayStep = niceStep(Math.max(...positiveDays.map((d) => d.revenue), 1) / 4);
  const dayYMax = dayStep * 4;
  const barSlot = plotW / spanDays;
  const barWidth = Math.max(barSlot * 0.72, 1);
  const barX = (day: string) =>
    PAD_L +
    (Math.round((utcMidnight(day) - utcMidnight(from)) / DAY_MS) + 0.5) * barSlot -
    barWidth / 2;
  const barY = (value: number) => PAD_T + plotH - (value / dayYMax) * plotH;
  const dayTicks = [0, dayStep, dayStep * 2, dayStep * 3, dayStep * 4];
  const xLabelEvery = Math.max(1, Math.ceil(spanDays / 7));
  const xLabels = Array.from({ length: spanDays }, (_, i) => addDays(from, i))
    .map((day, i) => ({ day, i }))
    .filter(({ i }) => i % xLabelEvery === 0);

  // --- Store split pie -------------------------------------------------
  const storeRollup = byStoreResult.rows.map((s) => ({
    key: String(s.store_id ?? "unassigned"),
    name: s.store_name,
    revenue: Number(s.revenue),
    units: Number(s.units),
  }));
  const pieStores = storeRollup.filter((s) => s.revenue > 0);
  const pieExcluded = storeRollup.length - pieStores.length;
  const pieTotal = pieStores.reduce((sum, s) => sum + s.revenue, 0);
  const pieSlices = pieStores.reduce<
    { key: string; name: string; revenue: number; pct: number; start: number; end: number }[]
  >((acc, s) => {
    const pct = pieTotal ? (s.revenue / pieTotal) * 100 : 0;
    const start = acc.length ? acc[acc.length - 1].end : 0;
    acc.push({ ...s, pct, start, end: start + pct });
    return acc;
  }, []);
  const PIE_SCOPE = "ops-store-pie";
  const BAR_SCOPE = "ops-bar";
  // Series colours are custom properties defined once on the page root, so
  // the dark-mode step can be swapped by a media query (an inline style
  // can't do that on its own).
  const vizCss =
    paletteCss(
      PIE_SCOPE,
      pieSlices.map((s) => s.key),
    ) + paletteCss(BAR_SCOPE, ["bar"]);
  const conicStops = pieSlices
    .map(
      (s) =>
        `${paletteVar(s.key)} ${s.start.toFixed(2)}% ${s.end.toFixed(2)}%`,
    )
    .join(", ");

  // --- Top products bars -----------------------------------------------
  const topProducts = topProductsResult.rows.map((p) => ({
    templateId: p.template_id,
    name: p.product_name,
    units: Number(p.units),
    revenue: Number(p.revenue),
  }));
  const topProductMaxUnits = Math.max(...topProducts.map((p) => p.units), 1);

  const topVariants = topVariantsResult.rows.map((v) => ({
    ...v,
    units: Number(v.units),
    revenue: Number(v.revenue),
  }));

  return (
    <div className={`mx-auto max-w-6xl px-6 py-10 ${PIE_SCOPE} ${BAR_SCOPE}`}>
      <style dangerouslySetInnerHTML={{ __html: vizCss }} />
      <h1 className="text-2xl font-semibold tracking-tight">Sales Dashboard</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Synced from Odoo POS. Dates and daily buckets are Bali time (WITA).{" "}
        {!process.env.ODOO_URL &&
          "Odoo isn't connected yet, so there's no data to show - see README."}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <span className="text-zinc-500">Last sync:</span>
        {lastSync ? (
          <span>
            {lastSync.status === "success" && (
              <>
                ✅ succeeded {new Date(lastSync.started_at).toLocaleString()} -{" "}
                {lastSync.orders_synced} orders
              </>
            )}
            {lastSync.status === "error" && (
              <span className="text-red-600">
                ❌ failed {new Date(lastSync.started_at).toLocaleString()}:{" "}
                {lastSync.error_message}
              </span>
            )}
            {lastSync.status === "running" && (
              <>⏳ still running (started {new Date(lastSync.started_at).toLocaleString()})</>
            )}
          </span>
        ) : (
          <span>never run</span>
        )}
        <form action={syncNowAction} className="ml-auto flex items-center gap-2">
          <input type="hidden" name="returnTo" value={returnToUrl} />
          <input type="hidden" name="days" value="7" />
          <button
            type="submit"
            className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Sync now (last 7 days)
          </button>
        </form>
      </div>

      <form
        method="get"
        className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            From
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            To
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
            />
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
          <p className="mt-1.5 text-xs text-zinc-500">
            Nothing ticked = all stores.
          </p>
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
          Apply filters
        </button>
      </form>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">Revenue</div>
          <div className="text-xl font-semibold">
            {currencyFormatter.format(totalRevenue)}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">Units sold</div>
          <div className="text-xl font-semibold">{totalQty.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">Orders</div>
          <div className="text-xl font-semibold">
            {totalOrders !== null ? totalOrders.toLocaleString() : "-"}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">Line items</div>
          <div className="text-xl font-semibold">{totalLines.toLocaleString()}</div>
        </div>
      </div>
      {totalsAreCapped && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
          These cover only the first {ROW_LIMIT} lines in the range, not the
          whole range - run migration 0022 for true totals.
        </p>
      )}

      {error && (
        <p className="mt-6 text-sm text-red-600">Query error: {error.message}</p>
      )}

      {/* --- Sales over time --- */}
      <div className="mt-10">
        <SectionHeading
          title="Sales over time"
          subtitle="Revenue per trading day (Bali time), across the whole filtered range."
        />
        {dailyResult.error ? (
          <RollupUnavailable message={dailyResult.error} />
        ) : !positiveDays.length ? (
          <p className="mt-2 text-sm text-zinc-500">
            No sales in this range yet.
          </p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              className="mt-3 h-auto w-full"
              role="img"
              aria-label="Revenue per day"
            >
              {dayTicks.map((t) => (
                <g key={t}>
                  <line
                    x1={PAD_L}
                    x2={CHART_W - PAD_R}
                    y1={barY(t)}
                    y2={barY(t)}
                    stroke="currentColor"
                    className="text-zinc-200 dark:text-zinc-800"
                    strokeWidth={1}
                  />
                  <text
                    x={PAD_L - 6}
                    y={barY(t) + 3}
                    textAnchor="end"
                    className="fill-zinc-400 text-[9px]"
                  >
                    {formatRupiahCompact(t)}
                  </text>
                </g>
              ))}
              {positiveDays.map((d) => (
                <rect
                  key={d.day}
                  x={barX(d.day)}
                  y={barY(d.revenue)}
                  width={barWidth}
                  height={Math.max(PAD_T + plotH - barY(d.revenue), 0)}
                  className="fill-zinc-700 dark:fill-zinc-300"
                >
                  <title>
                    {dayLabelFormatter.format(new Date(`${d.day}T00:00:00Z`))}:{" "}
                    {currencyFormatter.format(d.revenue)}, {d.units} units,{" "}
                    {d.orders} orders
                  </title>
                </rect>
              ))}
              {xLabels.map(({ day, i }) => (
                <text
                  key={day}
                  x={PAD_L + (i + 0.5) * barSlot}
                  y={CHART_H - PAD_B + 15}
                  textAnchor="middle"
                  className="fill-zinc-400 text-[9px]"
                >
                  {dayLabelFormatter.format(new Date(`${day}T00:00:00Z`))}
                </text>
              ))}
            </svg>
            <p className="mt-1 text-[10px] text-zinc-400">
              A day with no bar had no synced sales. The Odoo sync only covers
              the days it has been run for, so a gap isn&apos;t necessarily a
              zero-sales day.
              {negativeDayCount > 0 &&
                ` ${negativeDayCount} day(s) netted zero or less (refunds) and aren't drawn - see the table view.`}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-zinc-500 hover:underline">
                Table view
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-xs">
                  <thead>
                    <tr className="text-zinc-500">
                      <th className="px-2 py-1">Day</th>
                      <th className="px-2 py-1 text-right">Revenue</th>
                      <th className="px-2 py-1 text-right">Units</th>
                      <th className="px-2 py-1 text-right">Orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.map((d) => (
                      <tr
                        key={d.day}
                        className="border-t border-zinc-100 dark:border-zinc-800"
                      >
                        <td className="px-2 py-1">
                          {dayLabelFormatter.format(new Date(`${d.day}T00:00:00Z`))}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {currencyFormatter.format(d.revenue)}
                        </td>
                        <td className="px-2 py-1 text-right">{d.units}</td>
                        <td className="px-2 py-1 text-right">{d.orders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        {/* --- Sales split by store --- */}
        <div>
          <SectionHeading
            title="Sales by store"
            subtitle="Share of revenue over the filtered range."
          />
          {byStoreResult.error ? (
            <RollupUnavailable message={byStoreResult.error} />
          ) : !pieSlices.length ? (
            <p className="mt-2 text-sm text-zinc-500">No sales in this range yet.</p>
          ) : (
            <div>
              <div className="mt-3 flex flex-wrap items-center gap-6">
                <div
                  className="h-40 w-40 shrink-0 rounded-full"
                  style={{ background: `conic-gradient(${conicStops})` }}
                  role="img"
                  aria-label="Revenue share by store"
                />
                <ul className="space-y-1 text-sm">
                  {pieSlices.map((s) => (
                    <li key={s.key} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: paletteVar(s.key) }}
                      />
                      <span className="text-zinc-600 dark:text-zinc-400">
                        {s.name}
                      </span>
                      <span className="text-zinc-400">
                        {s.pct.toFixed(1)}% ({formatRupiahCompact(s.revenue)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {pieExcluded > 0 && (
                <p className="mt-2 text-[10px] text-zinc-400">
                  {pieExcluded} store(s) netted zero or less over this range
                  (refunds outweighing sales) and can&apos;t be drawn as a
                  slice.
                </p>
              )}
            </div>
          )}
        </div>

        {/* --- Top products --- */}
        <div>
          <SectionHeading
            title={`Top ${TOP_PRODUCTS_LIMIT} products sold`}
            subtitle="By units, with all colour/size/type variants of a product counted together."
          />
          {topProductsResult.error ? (
            <RollupUnavailable message={topProductsResult.error} />
          ) : !topProducts.length ? (
            <p className="mt-2 text-sm text-zinc-500">No sales in this range yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {topProducts.map((p) => (
                <div key={p.templateId} className="text-xs">
                  <div className="flex justify-between gap-3 text-zinc-500">
                    <span className="truncate" title={p.name}>
                      {p.name}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {p.units.toLocaleString()} units ·{" "}
                      {formatRupiahCompact(p.revenue)}
                    </span>
                  </div>
                  <div className="mt-0.5 h-3 bg-zinc-100 dark:bg-zinc-900">
                    <div
                      className="h-3"
                      style={{
                        width: `${(p.units / topProductMaxUnits) * 100}%`,
                        backgroundColor: paletteVar("bar"),
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* --- Top variants --- */}
      <div className="mt-10">
        <SectionHeading
          title={`Top ${TOP_VARIANTS_LIMIT} product variants sold`}
          subtitle="One row per Odoo variant (SKU), by units sold over the filtered range."
        />
        {topVariantsResult.error ? (
          <RollupUnavailable message={topVariantsResult.error} />
        ) : (
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
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Units</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {topVariants.map((v, i) => (
                  <tr
                    key={v.product_id}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="px-3 py-2 text-zinc-400">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs">{v.sku ?? "-"}</td>
                    <td className="px-3 py-2">{v.product_name}</td>
                    <td className="px-3 py-2">{v.color ?? "-"}</td>
                    <td className="px-3 py-2">{v.variant_type ?? "-"}</td>
                    <td className="px-3 py-2">{v.size ?? "-"}</td>
                    <td className="px-3 py-2">{v.category_name ?? "-"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {v.units.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {currencyFormatter.format(v.revenue)}
                    </td>
                  </tr>
                ))}
                {!topVariants.length && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-zinc-500">
                      No sales in this range yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {!hasVariantType && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
            The Type column is empty until migration 0022 has been run and the
            next Odoo sync has populated it.
          </p>
        )}
      </div>

      {/* --- Line-level detail --- */}
      <div className="mt-10">
        <SectionHeading
          title="Sales lines"
          subtitle={`Most recent first, up to ${ROW_LIMIT} rows.`}
        />
        <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Order Reference</th>
                <th className="px-3 py-2">Store</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Colour</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.id}
                  className="border-t border-zinc-100 dark:border-zinc-800"
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    {line.orders?.order_date
                      ? orderDateFormatter.format(new Date(line.orders.order_date))
                      : "-"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {line.orders?.pos_reference ?? "-"}
                  </td>
                  <td className="px-3 py-2">{line.orders?.stores?.name ?? "-"}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {line.products?.sku ?? "-"}
                  </td>
                  <td className="px-3 py-2">{line.products?.name ?? "-"}</td>
                  <td className="px-3 py-2">
                    {line.products?.product_categories?.name ?? "-"}
                  </td>
                  <td className="px-3 py-2">{line.products?.color ?? "-"}</td>
                  <td className="px-3 py-2">{line.products?.variant_type ?? "-"}</td>
                  <td className="px-3 py-2">{line.products?.size ?? "-"}</td>
                  <td className="px-3 py-2 text-right">{line.qty}</td>
                  <td className="px-3 py-2 text-right">
                    {currencyFormatter.format(Number(line.subtotal))}
                  </td>
                </tr>
              ))}
              {!lines.length && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-zinc-500">
                    No sales data for this filter yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {lines.length === ROW_LIMIT && (
          <p className="mt-2 text-xs text-zinc-500">
            Showing the first {ROW_LIMIT} rows - narrow your date range for a
            complete list. The totals and sections above aggregate the whole
            range, so they aren&apos;t affected by this cap. Pagination is a
            phase 2 improvement.
          </p>
        )}
      </div>
    </div>
  );
}
