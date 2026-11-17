import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessModule } from "@/components/shell/nav-config";
import { BarList, TrendChart } from "@/components/ui/charts";
import { Card, EmptyState, NeedsMigration } from "@/components/ui/card";
import { FilterLinks } from "@/components/ui/filter-links";
import { PeriodPicker } from "@/components/ui/period-picker";
import { Stat } from "@/components/ui/stat";
import { change, changeText, idr, idrCompact, num, pct } from "@/lib/biz/format";
import { resolvePeriod } from "@/lib/biz/period";
import {
  ROLLUPS_MIGRATION,
  fetchByCategory,
  fetchByProduct,
  fetchDaily,
  fetchShops,
  fetchStockLevels,
  fetchVariants,
} from "@/lib/biz/sales";
import { bucketsFor, seriesFor } from "@/lib/biz/trend";
import { baliToday, getShellContext } from "@/lib/shell/context";
import { ASASI_PALETTE, CONTEXT_SERIES_COLOR } from "@/lib/viz/palette";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; store?: string; category?: string; product?: string }>;
}) {
  const [params, { role }] = await Promise.all([searchParams, getShellContext()]);
  if (!canAccessModule(role, "operations")) {
    return <EmptyState title="Not part of your role">Sales reporting isn&apos;t included in your access.</EmptyState>;
  }

  const today = baliToday();
  const period = resolvePeriod(params, today);
  const admin = createAdminClient();
  const productName = (params.product ?? "").trim();
  const seesInventory = canAccessModule(role, "forecast");

  const { shops } = await fetchShops(admin);
  const shop = shops.find((s) => s.key === params.store);
  const storeIds = shop?.ids ?? null;

  const [byProduct, prevByProduct, byCategory, productDaily, prevProductDaily, variants, stock] = await Promise.all([
    fetchByProduct(admin, period, storeIds),
    fetchByProduct(admin, period.prev, storeIds),
    fetchByCategory(admin, period, storeIds),
    productName ? fetchDaily(admin, period, storeIds, productName) : Promise.resolve(null),
    productName ? fetchDaily(admin, period.prev, storeIds, productName) : Promise.resolve(null),
    productName ? fetchVariants(admin, period, productName, storeIds) : Promise.resolve(null),
    productName && seesInventory
      ? fetchStockLevels(admin, { search: productName, view: "all", lowAt: 2, limit: 500, offset: 0 })
      : Promise.resolve(null),
  ]);

  const keep = {
    period: period.key,
    from: period.key === "custom" ? period.from : undefined,
    to: period.key === "custom" ? period.to : undefined,
    store: shop?.key,
    category: params.category,
    product: productName || undefined,
  };
  const query = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(
      Object.entries({ ...keep, ...extra }).filter((e): e is [string, string] => Boolean(e[1])),
    );
    return `/sales/products?${p.toString()}`;
  };

  const all = byProduct.ok ? byProduct.data : [];
  const prevByTemplate = new Map((prevByProduct.ok ? prevByProduct.data : []).map((p) => [p.templateId, p]));
  const categories = byCategory.ok ? byCategory.data.filter((c) => c.revenue !== 0 || c.units !== 0) : [];
  const category = categories.find((c) => c.name === params.category)?.name;
  const listed = category ? all.filter((p) => (p.category ?? "Uncategorised") === category) : all;
  const totalRevenue = all.reduce((sum, p) => sum + p.revenue, 0);
  const totalCategoryRevenue = categories.reduce((sum, c) => sum + c.revenue, 0);

  const selected = productName ? all.find((p) => p.name === productName) : undefined;
  const selectedPrev = selected ? prevByTemplate.get(selected.templateId) : undefined;
  const buckets = bucketsFor(period, period.bucket);
  const prevBuckets = bucketsFor(period.prev, period.bucket);
  const unitsNow = productDaily?.ok ? seriesFor(buckets, period.bucket, productDaily.data, "units", today) : [];
  const unitsPrev = prevProductDaily?.ok ? seriesFor(prevBuckets, period.bucket, prevProductDaily.data, "units", today) : [];
  // Exact-name matches only: the stock search is a contains-match.
  const stockRows = stock?.ok ? stock.data.rows.filter((r) => r.name === productName) : [];
  const stockTotal = stockRows.reduce((sum, r) => sum + r.totalQty, 0);

  return (
    <>
      <div className="as-page-head">
        <div>
          <h1 className="as-page-title">Products</h1>
          <p className="as-page-desc">
            {shop ? shop.name : "All stores"} <span className="text-faint">·</span> {period.rangeLabel}{" "}
            <span className="text-faint">·</span> compared {period.prev.label.replace(/^vs /, "with ")}. One row per style;
            loyalty &ldquo;Redeem&rdquo; lines are left out.
          </p>
        </div>
        <PeriodPicker basePath="/sales/products" period={period} keep={keep} />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <FilterLinks
          basePath="/sales/products"
          param="store"
          value={shop?.key}
          options={shops.map((s) => ({ value: s.key, label: s.name }))}
          allLabel="All stores"
          keep={keep}
          label="Store"
        />
      </div>

      {!byProduct.ok && byProduct.missing && (
        <div className="as-card mb-4">
          <NeedsMigration file={ROLLUPS_MIGRATION} />
        </div>
      )}
      {!byProduct.ok && !byProduct.missing && (
        <p className="as-notice as-notice-bad mb-4">Product figures couldn&apos;t be loaded: {byProduct.error}</p>
      )}

      {productName && (
        <section className="mb-6">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="as-subtitle">{productName}</h2>
            <Link href={query({ product: undefined })} className="as-link">
              ← All products
            </Link>
          </div>
          {selected ? (
            <>
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Stat label="Revenue" value={idr(selected.revenue)} change={change(selected.revenue, selectedPrev?.revenue)} compareLabel={period.prev.label} note={totalRevenue > 0 ? `${pct((selected.revenue / totalRevenue) * 100, 1)} of all product revenue` : undefined} />
                <Stat label="Units sold" value={num(selected.units)} change={change(selected.units, selectedPrev?.units)} compareLabel={period.prev.label} />
                <Stat label="Returns" value={`${num(selected.returnUnits)} unit${selected.returnUnits === 1 ? "" : "s"}`} change={change(selected.returnUnits, selectedPrev?.returnUnits)} compareLabel={period.prev.label} invert />
                {seesInventory ? (
                  <Stat
                    label="Stock on hand"
                    tag="Now"
                    value={stock?.ok ? `${num(stockTotal)} unit${stockTotal === 1 ? "" : "s"}` : null}
                    note={stock?.ok ? "Office and all stores" : stock && !stock.ok && stock.missing ? "Needs migration 0040" : undefined}
                    href={`/inventory?q=${encodeURIComponent(productName)}`}
                  />
                ) : (
                  <Stat label="Orders" value={num(selected.orders)} />
                )}
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <Card className="xl:col-span-2" title="Units sold over time" note={period.bucket === "day" ? "Per day" : period.bucket === "week" ? "Per week" : "Per month"}>
                  <div className="as-card-pad">
                    {unitsNow.some((v) => v !== null) ? (
                      <TrendChart
                        ariaLabel={`Units of ${productName} sold over the period`}
                        xLabels={buckets.map((b) => b.label)}
                        tipTitles={buckets.map((b) => b.title)}
                        format={num}
                        axisFormat={num}
                        series={[
                          { label: period.rangeLabel, color: ASASI_PALETTE[0].light, values: unitsNow },
                          ...(unitsPrev.some((v) => v !== null)
                            ? [
                                {
                                  label: period.prev.label.replace(/^vs /, ""),
                                  color: CONTEXT_SERIES_COLOR,
                                  dashed: true,
                                  values: buckets.map((_, i) => unitsPrev[i] ?? null),
                                  tipLabels: buckets.map((_, i) => prevBuckets[i]?.title ?? "Comparison"),
                                },
                              ]
                            : []),
                        ]}
                      />
                    ) : (
                      <EmptyState title="No sales of this product in the period" />
                    )}
                  </div>
                </Card>
                <Card title="Variants" note="Colour and size, by units">
                  {variants?.ok && variants.data.length > 0 ? (
                    <div className="as-table-wrap max-h-[22rem] overflow-y-auto">
                      <table className="as-table">
                        <thead>
                          <tr>
                            <th>Variant</th>
                            <th className="as-num">Units</th>
                            <th className="as-num">Revenue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {variants.data.map((v) => (
                            <tr key={v.productId}>
                              <td>
                                {[v.color, v.size, v.variantType].filter(Boolean).join(" · ") || "Single variant"}
                                {v.sku && <span className="block text-xs text-muted">{v.sku}</span>}
                              </td>
                              <td className="as-num">{num(v.units)}</td>
                              <td className="as-num">{idrCompact(v.revenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyState title="No variant sales in the period" />
                  )}
                </Card>
              </div>
            </>
          ) : (
            <div className="as-card">
              <EmptyState title="No sales in this period">
                {productName} has no sales on file for {period.rangeLabel}
                {shop ? ` at ${shop.name}` : ""}.
              </EmptyState>
            </div>
          )}
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="By category" note={period.rangeLabel}>
          {!byCategory.ok && byCategory.missing ? (
            <NeedsMigration file={ROLLUPS_MIGRATION} />
          ) : categories.length > 0 ? (
            <>
              <BarList
                rows={categories.map((c) => ({
                  key: String(c.id ?? c.name),
                  label: c.name,
                  sub: `${num(c.units)} units · ${totalCategoryRevenue > 0 ? pct((c.revenue / totalCategoryRevenue) * 100, 0) : "-"} of revenue`,
                  value: Math.max(0, c.revenue),
                  valueText: idr(c.revenue),
                  href: query({ category: c.name === category ? undefined : c.name, product: undefined }),
                }))}
              />
              {category && (
                <p className="border-t border-line px-5 py-3 text-xs">
                  Showing <strong className="font-medium">{category}</strong> ·{" "}
                  <Link href={query({ category: undefined })} className="underline underline-offset-2">
                    show all categories
                  </Link>
                </p>
              )}
            </>
          ) : (
            <EmptyState title="No category sales in this period" />
          )}
        </Card>

        <Card
          className="xl:col-span-2"
          title={category ? `${category} · ${listed.length} style${listed.length === 1 ? "" : "s"}` : `All products · ${listed.length} style${listed.length === 1 ? "" : "s"}`}
          note="Ranked by revenue. Select a product for its trend, variants and stock."
        >
          {listed.length > 0 ? (
            <div className="as-table-wrap max-h-[44rem] overflow-y-auto">
              <table className="as-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="as-num">Units</th>
                    <th className="as-num">Revenue</th>
                    <th className="as-num">Share</th>
                    <th className="as-num">{period.prev.label}</th>
                    <th className="as-num">Returns</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.map((p) => {
                    const c = change(p.revenue, prevByTemplate.get(p.templateId)?.revenue);
                    return (
                      <tr key={p.templateId} className={p.name === productName ? "bg-surface-2" : undefined}>
                        <td>
                          <Link href={query({ product: p.name })}>{p.name}</Link>
                          <span className="block text-xs text-muted">{p.category ?? "Uncategorised"}</span>
                        </td>
                        <td className="as-num">{num(p.units)}</td>
                        <td className="as-num">{idr(p.revenue)}</td>
                        <td className="as-num">{totalRevenue > 0 ? pct((p.revenue / totalRevenue) * 100, 1) : "-"}</td>
                        <td className={`as-num ${c.direction === "up" ? "as-up" : c.direction === "down" ? "as-down" : "text-faint"}`}>
                          {changeText(c) ?? "new in period"}
                        </td>
                        <td className="as-num">{p.returnUnits ? num(p.returnUnits) : <span className="text-faint">0</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : byProduct.ok ? (
            <EmptyState title="Nothing sold in this period">No product sales are on file for {period.rangeLabel}.</EmptyState>
          ) : (
            <EmptyState title="Not available" />
          )}
        </Card>
      </div>
    </>
  );
}
