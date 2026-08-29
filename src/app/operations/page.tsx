import { createAdminClient } from "@/lib/supabase/admin";
import { syncNowAction } from "./actions";

export const dynamic = "force-dynamic";
// Applies to this route's Server Actions too (e.g. the "Sync now" button) -
// the Odoo sync makes several sequential API calls and needs real headroom
// beyond the platform's short default, same as /api/sync/odoo.
export const maxDuration = 60;

const ROW_LIMIT = 1000;

// Store currency as IDR for now - revisit if a future Odoo instance/store
// uses something else (see README "Currency").
const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

interface SearchParams {
  from?: string;
  to?: string;
  store?: string | string[];
  color?: string | string[];
  size?: string | string[];
  category?: string | string[];
}

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
  const storeIds = toArray(params.store).map(Number);
  const colors = toArray(params.color);
  const sizes = toArray(params.size);
  const categoryIds = toArray(params.category).map(Number);

  const supabase = createAdminClient();

  const returnTo = new URLSearchParams();
  if (params.from) returnTo.set("from", params.from);
  if (params.to) returnTo.set("to", params.to);
  for (const v of toArray(params.store)) returnTo.append("store", v);
  for (const v of toArray(params.color)) returnTo.append("color", v);
  for (const v of toArray(params.size)) returnTo.append("size", v);
  for (const v of toArray(params.category)) returnTo.append("category", v);
  const returnToUrl = `/operations${returnTo.toString() ? `?${returnTo}` : ""}`;

  const [
    { data: stores },
    { data: categories },
    { data: colorRows },
    { data: sizeRows },
    { data: lastSync },
  ] = await Promise.all([
    supabase.from("stores").select("id, name").order("name"),
    supabase.from("product_categories").select("id, name").order("name"),
    supabase.from("products").select("color").not("color", "is", null),
    supabase.from("products").select("size").not("size", "is", null),
    supabase
      .from("sync_runs")
      .select("status, started_at, finished_at, orders_synced, error_message")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const availableColors = Array.from(
    new Set((colorRows ?? []).map((r) => r.color as string)),
  ).sort();
  const availableSizes = Array.from(
    new Set((sizeRows ?? []).map((r) => r.size as string)),
  ).sort();

  let query = supabase
    .from("order_lines")
    .select(
      `
      id, qty, unit_price, subtotal,
      orders!inner ( order_date, store_id, stores ( id, name ) ),
      products!inner ( name, sku, color, size, category_id, product_categories ( id, name ) )
    `,
    )
    .gte("orders.order_date", `${from}T00:00:00Z`)
    .lt("orders.order_date", `${to}T23:59:59Z`)
    .order("order_date", { referencedTable: "orders", ascending: false })
    .limit(ROW_LIMIT);

  if (storeIds.length) query = query.in("orders.store_id", storeIds);
  if (colors.length) query = query.in("products.color", colors);
  if (sizes.length) query = query.in("products.size", sizes);
  if (categoryIds.length)
    query = query.in("products.category_id", categoryIds);

  const { data: rows, error } = await query;

  type Row = {
    id: number;
    qty: number;
    unit_price: number;
    subtotal: number;
    orders: { order_date: string; stores: { id: number; name: string } | null } | null;
    products: {
      name: string;
      sku: string | null;
      color: string | null;
      size: string | null;
      product_categories: { id: number; name: string } | null;
    } | null;
  };

  const lines = (rows ?? []) as unknown as Row[];

  const totalRevenue = lines.reduce((sum, l) => sum + Number(l.subtotal), 0);
  const totalQty = lines.reduce((sum, l) => sum + Number(l.qty), 0);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">
        Sales Dashboard
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Synced from Odoo POS.{" "}
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
        className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-3 lg:grid-cols-6"
      >
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
          Store(s)
          <select
            multiple
            name="store"
            defaultValue={storeIds.map(String)}
            className="h-24 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
          >
            {(stores ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Category
          <select
            multiple
            name="category"
            defaultValue={categoryIds.map(String)}
            className="h-24 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
          >
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Color
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
        <div className="col-span-full">
          <button
            type="submit"
            className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900"
          >
            Apply filters
          </button>
        </div>
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
          <div className="text-xl font-semibold">
            {totalQty.toLocaleString()}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">Line items</div>
          <div className="text-xl font-semibold">{lines.length}</div>
        </div>
      </div>

      {error && (
        <p className="mt-6 text-sm text-red-600">
          Query error: {error.message}
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Store</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Color</th>
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
                <td className="px-3 py-2">
                  {line.orders?.order_date
                    ? new Date(line.orders.order_date).toLocaleDateString()
                    : "-"}
                </td>
                <td className="px-3 py-2">{line.orders?.stores?.name ?? "-"}</td>
                <td className="px-3 py-2">{line.products?.name ?? "-"}</td>
                <td className="px-3 py-2">
                  {line.products?.product_categories?.name ?? "-"}
                </td>
                <td className="px-3 py-2">{line.products?.color ?? "-"}</td>
                <td className="px-3 py-2">{line.products?.size ?? "-"}</td>
                <td className="px-3 py-2 text-right">{line.qty}</td>
                <td className="px-3 py-2 text-right">
                  {currencyFormatter.format(Number(line.subtotal))}
                </td>
              </tr>
            ))}
            {!lines.length && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
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
          complete view. Pagination is a phase 2 improvement.
        </p>
      )}
    </div>
  );
}
