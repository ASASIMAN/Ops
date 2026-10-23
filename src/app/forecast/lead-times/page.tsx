import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  importLeadTimeEstimatesAction,
  updateLeadTimeSettingsAction,
  upsertLeadTimeRowAction,
  updateMappingAction,
  setManualPoEtaAction,
} from "./actions";
import {
  hasLeadTimeSchema,
  fetchLeadTimeSettings,
  fetchLeadTimeProducts,
  fetchEstimatesByProduct,
  fetchMeasuredDeliveriesByProduct,
  fetchProductsUsingDefault,
  fetchNameMappings,
  fetchPurchaseOrders,
  resolveAllProducts,
} from "@/lib/leadtime/data";
import { computeMeasuredLeadTime, resolveEtaForPo } from "@/lib/leadtime/resolve";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function AssumptionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
      {children}
    </p>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-lg font-medium">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
    </div>
  );
}

const tierLabel: Record<string, string> = {
  manual_po: "Manual ETA on PO",
  measured: "Measured",
  table: "Vendor estimate / override",
  default: "Global default",
};

export default async function LeadTimesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; imported?: string }>;
}) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Lead times</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Not set up yet - SUPABASE_SERVICE_ROLE_KEY is missing.
        </p>
      </div>
    );
  }

  const { error, imported } = await searchParams;
  const supabase = createAdminClient();

  const schemaOk = await hasLeadTimeSchema(supabase);
  if (!schemaOk) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Lead times</h1>
        <AssumptionNote>
          Not shown yet - run{" "}
          <code>supabase/migrations/0027_lead_times.sql</code> and{" "}
          <code>supabase/migrations/0028_seed_purchase_orders.sql</code> in
          the Supabase SQL editor first.
        </AssumptionNote>
      </div>
    );
  }

  const settings = await fetchLeadTimeSettings(supabase);
  const products = await fetchLeadTimeProducts(supabase);
  const estimatesByProduct = await fetchEstimatesByProduct(supabase);
  const measuredByProduct = await fetchMeasuredDeliveriesByProduct(supabase, settings.firstDeliveryOnly);
  const resolutions = resolveAllProducts(products, estimatesByProduct, measuredByProduct, settings);
  const usingDefault = await fetchProductsUsingDefault(supabase, estimatesByProduct);
  const mappings = await fetchNameMappings(supabase);
  const purchaseOrders = await fetchPurchaseOrders(supabase);

  const flaggedMappings = mappings.filter((m) => m.note || m.leadTimeProductId === null);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lead times</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Per-product vendor lead-time estimates, purchase-order history,
            and the ETA resolution restock alerts use.
          </p>
        </div>
        <Link href="/forecast" className="text-xs text-zinc-500 hover:underline">
          ← Back to Forecasting
        </Link>
      </div>

      {error && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      )}
      {imported && (
        <p className="mt-4 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400">
          {imported}
        </p>
      )}

      {/* ---------------------------------------------------------- */}
      {/* ETA priority + settings                                      */}
      {/* ---------------------------------------------------------- */}
      <section className="mt-8">
        <SectionHeading
          title="ETA priority & assumptions"
          subtitle="Most specific first: manual ETA on a PO > measured (once ≥ N POs have real delivery dates) > this product's vendor estimate/override > the global default range."
        />
        <form
          action={updateLeadTimeSettingsAction}
          className="mt-3 grid gap-3 rounded-lg border border-zinc-200 p-4 text-xs sm:grid-cols-3 dark:border-zinc-800"
        >
          <label className="flex flex-col gap-1">
            Late-end buffer (%) for single-point estimates
            <input type="number" name="lateEndBufferPct" step="0.1" defaultValue={settings.lateEndBufferPct} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
          </label>
          <label className="flex flex-col gap-1">
            Global default - min days
            <input type="number" name="globalDefaultMinDays" defaultValue={settings.globalDefaultMinDays} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
          </label>
          <label className="flex flex-col gap-1">
            Global default - max days
            <input type="number" name="globalDefaultMaxDays" defaultValue={settings.globalDefaultMaxDays} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
          </label>
          <label className="flex flex-col gap-1">
            Min POs with real dates before &quot;measured&quot; activates
            <input type="number" name="measuredMinPoCount" min={1} defaultValue={settings.measuredMinPoCount} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
          </label>
          <label className="flex items-center gap-2 self-end pb-1">
            <input type="checkbox" name="firstDeliveryOnly" defaultChecked={settings.firstDeliveryOnly} />
            An estimate covers only the first delivery/batch (unchecked = whole PO)
          </label>
          <div className="flex flex-col gap-1 text-zinc-500">
            Clock start: <span className="font-medium text-zinc-700 dark:text-zinc-300">PO date</span> (only option implemented so far)
          </div>
          <button type="submit" className="self-start rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 sm:col-span-3">
            Save assumptions
          </button>
        </form>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Import vendor estimates                                      */}
      {/* ---------------------------------------------------------- */}
      <section className="mt-8">
        <SectionHeading title="Import vendor lead-time estimates" />
        <AssumptionNote>
          This app doesn&apos;t parse .xlsx directly (the only npm package
          for it carries unpatched high-severity vulnerabilities) - export{" "}
          <strong>Product_estimation_Vendor.xlsx</strong> to CSV first (File
          → Save As / Download as → CSV), then upload it below. Expected
          columns: a product/style name, a lead-time column (e.g. &quot;10
          days&quot;, &quot;1 Bulan&quot;, &quot;2-3 Months&quot;), and
          optionally vendor/note columns.
        </AssumptionNote>
        <form
          action={importLeadTimeEstimatesAction}
          className="mt-3 flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <label className="flex flex-col gap-1 text-sm">
            Vendor estimates CSV
            <input type="file" name="file" accept=".csv" required className="rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700" />
          </label>
          <button type="submit" className="self-start rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900">
            Import
          </button>
        </form>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Products using default, flagged                              */}
      {/* ---------------------------------------------------------- */}
      <section className="mt-8">
        <SectionHeading
          title="Products with PO history but no lead-time row"
          subtitle="Using the global default range until a vendor estimate or override is added."
        />
        {usingDefault.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">None - every product with PO history has an estimate.</p>
        ) : (
          <table className="mt-2 w-full max-w-lg text-left text-xs">
            <tbody>
              {usingDefault.map((p) => (
                <tr key={p.productId} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="px-2 py-1">{p.canonicalName}</td>
                  <td className="px-2 py-1 text-right text-zinc-500">{p.poCount} PO(s)</td>
                  <td className="px-2 py-1 text-amber-600 dark:text-amber-400">using default</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Name mappings needing review                                 */}
      {/* ---------------------------------------------------------- */}
      <section className="mt-8">
        <SectionHeading
          title="Name mappings to review"
          subtitle="Auto-created 1:1 (never merged automatically) or flagged with a note - confirm, or reassign to an existing product."
        />
        {flaggedMappings.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">Nothing flagged.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {flaggedMappings.map((m) => (
              <form
                key={m.id}
                action={updateMappingAction}
                className="flex flex-wrap items-end gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/20"
              >
                <input type="hidden" name="mappingId" value={m.id} />
                <div>
                  <div className="font-medium">&quot;{m.rawName}&quot;</div>
                  <div className="text-zinc-500">
                    currently → {m.canonicalName ?? <span className="text-red-600 dark:text-red-400">no product (skipped on import)</span>}
                  </div>
                  {m.note && <div className="mt-1 max-w-md text-amber-800 dark:text-amber-400">{m.note}</div>}
                </div>
                <label className="flex flex-col gap-1">
                  Reassign to
                  <select name="productId" defaultValue={m.leadTimeProductId ?? ""} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
                    <option value="">(no product)</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.canonicalName}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="rounded border border-zinc-300 px-2 py-1 hover:border-zinc-500 dark:border-zinc-700">
                  Confirm
                </button>
              </form>
            ))}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Lead times table (editable) + comparison                    */}
      {/* ---------------------------------------------------------- */}
      <section className="mt-8">
        <SectionHeading
          title="Lead times by product"
          subtitle="Resolved column reflects the ETA priority above. Estimated vs. measured shown once both exist."
        />
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="text-zinc-500">
                <th className="px-2 py-1">Product</th>
                <th className="px-2 py-1">Vendor estimate(s)</th>
                <th className="px-2 py-1">Measured</th>
                <th className="px-2 py-1">Resolved (used for alerts)</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const estimates = estimatesByProduct.get(p.id) ?? [];
                const measured = computeMeasuredLeadTime(measuredByProduct.get(p.id) ?? [], settings.measuredMinPoCount);
                const measuredCount = (measuredByProduct.get(p.id) ?? []).filter((d) => d.deliveredDate).length;
                const resolution = resolutions.get(p.id)!;
                return (
                  <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-900 align-top">
                    <td className="px-2 py-1">{p.canonicalName}</td>
                    <td className="px-2 py-1">
                      {estimates.length
                        ? estimates.map((e, i) => (
                            <div key={i}>
                              {e.minDays === e.maxDays ? `${e.minDays}d` : `${e.minDays}-${e.maxDays}d`} ({e.source}{e.vendor ? `, ${e.vendor}` : ""})
                            </div>
                          ))
                        : "-"}
                    </td>
                    <td className="px-2 py-1">
                      {measured
                        ? `${measured.minDays}-${measured.maxDays}d (${measured.poCount} POs)`
                        : `not enough data (${measuredCount}/${settings.measuredMinPoCount} POs with dates)`}
                    </td>
                    <td className="px-2 py-1 font-medium">
                      {resolution.minDays}-{resolution.maxDays}d
                      <span className="ml-1 font-normal text-zinc-500">({tierLabel[resolution.tier]})</span>
                      {resolution.usedFallback && <span className="ml-1 text-amber-600 dark:text-amber-400">*</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h3 className="mt-6 text-sm font-medium">Add / override a product&apos;s lead time</h3>
        <form action={upsertLeadTimeRowAction} className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
          <label className="flex flex-col gap-1">
            Product
            <select name="productId" required className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.canonicalName}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Vendor (optional)
            <input name="vendor" className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
          </label>
          <label className="flex flex-col gap-1">
            Min days
            <input type="number" name="minDays" required min={0} className="w-20 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
          </label>
          <label className="flex flex-col gap-1">
            Max days
            <input type="number" name="maxDays" required min={0} className="w-20 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
          </label>
          <label className="flex flex-col gap-1">
            Source
            <select name="source" className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
              <option value="manual">manual</option>
              <option value="vendor estimate">vendor estimate</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Note (optional)
            <input name="note" className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
          </label>
          <button type="submit" className="rounded bg-zinc-800 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900">
            Save
          </button>
        </form>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Purchase orders + manual ETA                                 */}
      {/* ---------------------------------------------------------- */}
      <section className="mt-8 mb-16">
        <SectionHeading
          title="Purchase orders"
          subtitle="A manual ETA here overrides everything else for that PO. Resolved ETA shown using the current tier when no manual date is set."
        />
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="text-zinc-500">
                <th className="px-2 py-1">PO</th>
                <th className="px-2 py-1">PO date</th>
                <th className="px-2 py-1">Resolved ETA</th>
                <th className="px-2 py-1">Manual ETA override</th>
              </tr>
            </thead>
            <tbody>
              {purchaseOrders.map((po) => {
                // One PO can carry several products (different styles on
                // the same order) with different lead times - shown as the
                // widest range across them rather than picking one
                // arbitrarily.
                const productResolutions = po.productIds.map((id) => resolutions.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
                const etas = productResolutions.map((r) => resolveEtaForPo(po.poDate, po.manualEtaDate, r));
                const earliest = etas.length ? etas.map((e) => e.etaDateRange!.earliest).sort()[0] : null;
                const latest = etas.length ? etas.map((e) => e.etaDateRange!.latest).sort().slice(-1)[0] : null;

                return (
                  <tr key={po.id} className="border-t border-zinc-100 dark:border-zinc-900 align-top">
                    <td className="px-2 py-1">{po.poNo}</td>
                    <td className="px-2 py-1">{po.poDate}</td>
                    <td className="px-2 py-1">
                      {earliest && latest ? (earliest === latest ? earliest : `${earliest} to ${latest}`) : "-"}
                    </td>
                    <td className="px-2 py-1">
                      <form action={setManualPoEtaAction} className="flex items-center gap-1">
                        <input type="hidden" name="poId" value={po.id} />
                        <input type="date" name="manualEtaDate" defaultValue={po.manualEtaDate ?? ""} className="rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-xs dark:border-zinc-700" />
                        <input type="text" name="manualEtaNote" placeholder="note" defaultValue={po.manualEtaNote ?? ""} className="w-28 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-xs dark:border-zinc-700" />
                        <button type="submit" className="rounded border border-zinc-300 px-1.5 py-0.5 hover:border-zinc-500 dark:border-zinc-700">
                          Save
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
