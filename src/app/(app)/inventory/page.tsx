import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessModule } from "@/components/shell/nav-config";
import { Card, EmptyState, NeedsMigration } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { idr, num, shortStoreName } from "@/lib/biz/format";
import {
  ROLLUPS_MIGRATION,
  fetchInventorySummary,
  fetchOpenPurchaseOrders,
  fetchSlowMovers,
  fetchStockLevels,
  type StockView,
} from "@/lib/biz/sales";
import { getShellContext } from "@/lib/shell/context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stock" };

const PAGE_SIZE = 50;
const SLOW_MOVER_DAYS = 90;
const VIEWS: { value: StockView; label: string }[] = [
  { value: "all", label: "Every variant" },
  { value: "in", label: "In stock" },
  { value: "store_out", label: "Out in at least one store" },
  { value: "low", label: "Low (at or below the level set)" },
  { value: "out", label: "Out of stock everywhere" },
];
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const SYNC_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Makassar",
});
const day = (d: string) => DATE.format(new Date(`${d}T00:00:00Z`));

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; view?: string; low?: string; page?: string }>;
}) {
  const [params, { role }] = await Promise.all([searchParams, getShellContext()]);
  if (!canAccessModule(role, "forecast")) {
    return <EmptyState title="Not part of your role">Inventory isn&apos;t included in your access.</EmptyState>;
  }

  const admin = createAdminClient();
  const q = (params.q ?? "").trim().slice(0, 80);
  const view = VIEWS.find((v) => v.value === params.view)?.value ?? "all";
  const lowAt = Math.min(999, Math.max(1, Number.parseInt(params.low ?? "", 10) || 2));
  const categoryId = Number.parseInt(params.category ?? "", 10) || null;
  const page = Math.max(1, Number.parseInt(params.page ?? "", 10) || 1);

  const [summary, stock, storeOut, openPos, slowMovers, categoriesRes, leadTimesRes] = await Promise.all([
    fetchInventorySummary(admin),
    fetchStockLevels(admin, { search: q, categoryId, view, lowAt, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    // Only the count is used: how many variants are missing from at least one shop.
    fetchStockLevels(admin, { view: "store_out", lowAt, limit: 1, offset: 0 }),
    fetchOpenPurchaseOrders(admin),
    fetchSlowMovers(admin, SLOW_MOVER_DAYS, 15),
    admin.from("product_categories").select("id, name").order("name"),
    admin
      .from("lead_times")
      .select("vendor, min_days, max_days, source, lead_time_products ( canonical_name )")
      .order("vendor", { ascending: true })
      .limit(200),
  ]);

  const locations = summary.ok ? [...summary.data].sort((a, b) => (a.kind === b.kind ? a.locationName.localeCompare(b.locationName) : a.kind === "office" ? -1 : 1)) : [];
  const locationLabel = (l: (typeof locations)[number]) => (l.kind === "office" ? "Office" : shortStoreName(l.storeName ?? l.locationName));
  const totalUnits = locations.reduce((sum, l) => sum + l.units, 0);
  const totalValue = locations.reduce((sum, l) => sum + l.retailValue, 0);
  const lastSync = locations.map((l) => l.syncedAt).filter((s): s is string => Boolean(s)).sort().pop();
  const openUnits = openPos.ok ? openPos.data.reduce((sum, po) => sum + po.open, 0) : null;

  const rows = stock.ok ? stock.data.rows : [];
  const totalRows = stock.ok ? stock.data.total : 0;
  const pages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const href = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = {
      q: q || undefined,
      category: categoryId ? String(categoryId) : undefined,
      view: view === "all" ? undefined : view,
      low: view === "low" ? String(lowAt) : undefined,
      ...overrides,
    };
    const query = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => Boolean(e[1]))).toString();
    return query ? `/inventory?${query}` : "/inventory";
  };

  type LeadRow = { vendor: string | null; min_days: number; max_days: number; source: string; lead_time_products: { canonical_name: string } | null };
  const leadTimes = ((leadTimesRes.data ?? []) as unknown as LeadRow[]).filter((r) => r.vendor);
  const vendors = new Map<string, LeadRow[]>();
  for (const r of leadTimes) vendors.set(r.vendor!, [...(vendors.get(r.vendor!) ?? []), r]);

  const missing = !summary.ok && summary.missing;

  return (
    <>
      <div className="as-page-head">
        <div>
          <h1 className="as-page-title">Stock</h1>
          <p className="as-page-desc">
            On-hand quantities from Odoo for the office and each store
            {lastSync ? `, last synced ${SYNC_TIME.format(new Date(lastSync))} (Bali)` : ""}. Values are at retail (list)
            price - cost prices aren&apos;t synced, so there is no cost value or margin here.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/forecast" className="as-btn as-btn-secondary">
            PO planner
          </Link>
          <Link href="/forecast/overview" className="as-btn as-btn-quiet">
            Restock alerts
          </Link>
        </div>
      </div>

      {missing ? (
        <div className="as-card">
          <NeedsMigration file={ROLLUPS_MIGRATION} />
        </div>
      ) : (
        <>
          {!summary.ok && <p className="as-notice as-notice-bad mb-4">Stock figures couldn&apos;t be loaded: {summary.error}</p>}

          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Stat label="Units on hand" value={summary.ok ? num(totalUnits) : null} note={`Across ${locations.length} location${locations.length === 1 ? "" : "s"}`} />
            <Stat label="Stock value" tag="At retail" value={summary.ok ? idr(totalValue) : null} note="On-hand units x list price" />
            <Stat
              label="Missing in a store"
              value={storeOut.ok ? num(storeOut.data.total) : null}
              note="Variants in stock somewhere but at 0 in at least one shop"
              href={href({ view: "store_out", page: undefined })}
              invert
            />
            <Stat
              label="On order"
              value={openUnits !== null ? `${num(openUnits)} unit${openUnits === 1 ? "" : "s"}` : null}
              note={openPos.ok ? `${openPos.data.length} purchase order${openPos.data.length === 1 ? "" : "s"} not fully received` : undefined}
              href="/forecast/lead-times"
            />
          </div>

          <Card className="mt-6" title="By location">
            {locations.length > 0 ? (
              <div className="as-table-wrap">
                <table className="as-table">
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th>Odoo location</th>
                      <th className="as-num">Units</th>
                      <th className="as-num">Value at retail</th>
                      <th className="as-num">Variants in stock</th>
                      <th className="as-num">Variants at zero</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((l) => (
                      <tr key={l.locationId}>
                        <td>{locationLabel(l)}</td>
                        <td className="text-muted">{l.locationName}</td>
                        <td className="as-num">{num(l.units)}</td>
                        <td className="as-num">{idr(l.retailValue)}</td>
                        <td className="as-num">{num(l.skusInStock)}</td>
                        <td className="as-num">{num(l.skusAtZero)}</td>
                      </tr>
                    ))}
                    <tr className="font-medium">
                      <td>Total</td>
                      <td />
                      <td className="as-num">{num(totalUnits)}</td>
                      <td className="as-num">{idr(totalValue)}</td>
                      <td />
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No stock on file">
                Run &ldquo;Sync stock from Odoo&rdquo; on the <Link href="/forecast" className="underline">PO planner</Link> to
                load on-hand quantities.
              </EmptyState>
            )}
          </Card>

          <Card
            className="mt-4"
            title="Stock by variant"
            note={`${num(totalRows)} variant${totalRows === 1 ? "" : "s"}${q ? ` matching “${q}”` : ""} · sold = units sold in the last 30 days`}
          >
            <form action="/inventory" className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-4">
              <label className="as-field min-w-[14rem] flex-1">
                Search
                <input name="q" defaultValue={q} placeholder="Product, SKU or colour" className="as-input" />
              </label>
              <label className="as-field">
                Category
                <select name="category" defaultValue={categoryId ? String(categoryId) : ""} className="as-input">
                  <option value="">All categories</option>
                  {((categoriesRes.data ?? []) as { id: number; name: string }[]).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="as-field">
                Show
                <select name="view" defaultValue={view} className="as-input">
                  {VIEWS.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="as-field">
                Low level
                <input name="low" type="number" min={1} max={999} defaultValue={lowAt} className="as-input w-24" aria-label="Units at or below which a variant counts as low" />
              </label>
              <button type="submit" className="as-btn">
                Apply
              </button>
              {(q || categoryId || view !== "all") && (
                <Link href="/inventory" className="as-link pb-2.5">
                  Clear
                </Link>
              )}
            </form>

            {!stock.ok ? (
              <p className="as-notice as-notice-bad m-5">Stock couldn&apos;t be loaded: {stock.error}</p>
            ) : rows.length > 0 ? (
              <>
                <div className="as-table-wrap">
                  <table className="as-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Variant</th>
                        {locations.map((l) => (
                          <th key={l.locationId} className="as-num">
                            {locationLabel(l)}
                          </th>
                        ))}
                        <th className="as-num">Total</th>
                        <th className="as-num">Sold 30d</th>
                        <th className="as-num">List price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.productId}>
                          <td>
                            <Link href={`/sales/products?product=${encodeURIComponent(r.name)}`}>{r.name}</Link>
                            <span className="block text-xs text-muted">{r.category ?? "Uncategorised"}</span>
                          </td>
                          <td>
                            {[r.color, r.size].filter(Boolean).join(" · ") || <span className="text-faint">-</span>}
                            {r.sku && <span className="block text-xs text-muted">{r.sku}</span>}
                          </td>
                          {locations.map((l) => {
                            const qty = r.byLocation[l.locationName] ?? 0;
                            return (
                              <td key={l.locationId} className={`as-num ${qty <= 0 ? (l.kind === "store" && r.totalQty > 0 ? "as-down" : "text-faint") : ""}`}>
                                {num(qty)}
                              </td>
                            );
                          })}
                          <td className="as-num font-medium">{num(r.totalQty)}</td>
                          <td className="as-num">{r.unitsSold30d ? num(r.unitsSold30d) : <span className="text-faint">0</span>}</td>
                          <td className="as-num">{r.listPrice !== null ? idr(r.listPrice) : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
                  <span>
                    {num((page - 1) * PAGE_SIZE + 1)} - {num(Math.min(page * PAGE_SIZE, totalRows))} of {num(totalRows)}
                  </span>
                  <span className="flex gap-4">
                    {page > 1 ? (
                      <Link href={href({ page: page > 2 ? String(page - 1) : undefined })} className="as-link" scroll={false}>
                        ← Previous
                      </Link>
                    ) : (
                      <span className="as-link opacity-30">← Previous</span>
                    )}
                    {page < pages ? (
                      <Link href={href({ page: String(page + 1) })} className="as-link" scroll={false}>
                        Next →
                      </Link>
                    ) : (
                      <span className="as-link opacity-30">Next →</span>
                    )}
                  </span>
                </div>
              </>
            ) : (
              <EmptyState title="Nothing matches">No variants match these filters.</EmptyState>
            )}
          </Card>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card title="On order" note="Purchase orders with units still to arrive (ordered minus received)" href="/forecast/lead-times" hrefLabel="Lead times">
              {!openPos.ok ? (
                openPos.missing ? <NeedsMigration file={ROLLUPS_MIGRATION} /> : <EmptyState title="Couldn't load purchase orders" />
              ) : openPos.data.length > 0 ? (
                <div className="as-table-wrap max-h-[26rem] overflow-y-auto">
                  <table className="as-table">
                    <thead>
                      <tr>
                        <th>PO</th>
                        <th>Ordered on</th>
                        <th className="as-num">Ordered</th>
                        <th className="as-num">Received</th>
                        <th className="as-num">To arrive</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openPos.data.map((po) => (
                        <tr key={po.id}>
                          <td>
                            {po.poNo}
                            {po.manualEtaDate && <span className="block text-xs text-muted">ETA set: {day(po.manualEtaDate)}</span>}
                          </td>
                          <td>{day(po.poDate)}</td>
                          <td className="as-num">{num(po.ordered)}</td>
                          <td className="as-num">{num(po.received)}</td>
                          <td className="as-num font-medium">{num(po.open)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="Nothing on order">Every purchase order on file has been fully received.</EmptyState>
              )}
            </Card>

            <Card title="Slow-moving stock" note={`Styles in stock with the fewest units sold in the last ${SLOW_MOVER_DAYS} days`}>
              {!slowMovers.ok ? (
                slowMovers.missing ? <NeedsMigration file={ROLLUPS_MIGRATION} /> : <EmptyState title="Couldn't load" />
              ) : slowMovers.data.length > 0 ? (
                <div className="as-table-wrap max-h-[26rem] overflow-y-auto">
                  <table className="as-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="as-num">Sold {SLOW_MOVER_DAYS}d</th>
                        <th className="as-num">On hand</th>
                        <th className="as-num">Value at retail</th>
                        <th>Last sold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slowMovers.data.map((p) => (
                        <tr key={p.templateId}>
                          <td>
                            <Link href={href({ q: p.name, page: undefined, view: undefined, category: undefined })}>{p.name}</Link>
                            <span className="block text-xs text-muted">{p.category ?? "Uncategorised"}</span>
                          </td>
                          <td className="as-num">{num(p.unitsSold)}</td>
                          <td className="as-num">{num(p.onHand)}</td>
                          <td className="as-num">{idr(p.retailValue)}</td>
                          <td>{p.lastSold ? day(p.lastSold) : <span className="text-faint">never</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No stock on file" />
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card title="Suppliers" note="Vendors on file with their quoted or measured lead times" href="/forecast/lead-times" hrefLabel="Lead times">
              {vendors.size > 0 ? (
                <div className="as-table-wrap max-h-[22rem] overflow-y-auto">
                  <table className="as-table">
                    <thead>
                      <tr>
                        <th>Supplier</th>
                        <th>Products</th>
                        <th className="as-num">Lead time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...vendors.entries()].map(([vendor, list]) => {
                        const min = Math.min(...list.map((r) => r.min_days));
                        const max = Math.max(...list.map((r) => r.max_days));
                        const names = [...new Set(list.map((r) => r.lead_time_products?.canonical_name).filter(Boolean))];
                        return (
                          <tr key={vendor}>
                            <td>{vendor}</td>
                            <td className="text-muted">
                              {names.slice(0, 4).join(", ")}
                              {names.length > 4 ? ` +${names.length - 4} more` : ""}
                            </td>
                            <td className="as-num">{min === max ? `${min} days` : `${min} - ${max} days`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No suppliers on file">
                  Add vendors and their lead times on the <Link href="/forecast/lead-times" className="underline">Lead times</Link>{" "}
                  screen.
                </EmptyState>
              )}
            </Card>
            <Card title="Cost prices and margins">
              <EmptyState title="No data">
                Only each product&apos;s list (retail) price is synced from Odoo. Until cost prices are brought in too,
                stock value at cost and gross margin can&apos;t be shown - they aren&apos;t estimated here.
              </EmptyState>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
