"use client";

import { useMemo, useState } from "react";

/**
 * The Sales lines table, made sortable. The server already fetches and
 * formats every row (capped at ROW_LIMIT, same as before) - this just
 * owns which column/direction the already-rendered rows are displayed in,
 * so no new query or round-trip is needed to sort a table that's already
 * entirely on the page.
 */

export interface SalesLineRow {
  id: number;
  dateMs: number;
  dateLabel: string;
  orderRef: string;
  store: string;
  sku: string;
  product: string;
  category: string;
  variant: string;
  type: string;
  size: string;
  attributes: string;
  qty: number;
  subtotal: number;
  subtotalLabel: string;
}

type SortKey =
  | "date"
  | "orderRef"
  | "store"
  | "sku"
  | "product"
  | "category"
  | "variant"
  | "type"
  | "size"
  | "attributes"
  | "qty"
  | "subtotal";

const SORT_VALUE: Record<SortKey, (row: SalesLineRow) => string | number> = {
  date: (r) => r.dateMs,
  orderRef: (r) => r.orderRef,
  store: (r) => r.store,
  sku: (r) => r.sku,
  product: (r) => r.product,
  category: (r) => r.category,
  variant: (r) => r.variant,
  type: (r) => r.type,
  size: (r) => r.size,
  attributes: (r) => r.attributes,
  qty: (r) => r.qty,
  subtotal: (r) => r.subtotal,
};

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "date", label: "Date" },
  { key: "orderRef", label: "Order Reference" },
  { key: "store", label: "Store" },
  { key: "sku", label: "SKU" },
  { key: "product", label: "Product" },
  { key: "category", label: "Category" },
  { key: "variant", label: "Variants" },
  { key: "type", label: "Type" },
  { key: "size", label: "Size" },
  { key: "attributes", label: "Attributes" },
  { key: "qty", label: "Qty", align: "right" },
  { key: "subtotal", label: "Subtotal", align: "right" },
];

function compare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function SalesLinesTable({ rows }: { rows: SalesLineRow[] }) {
  // null = the order the server sent (most recent first) - clicking a
  // header always starts at ascending, same as most spreadsheet UIs.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const getValue = SORT_VALUE[sort.key];
    const sorted = [...rows].sort((a, b) => compare(getValue(a), getValue(b)));
    return sort.dir === "desc" ? sorted.reverse() : sorted;
  }, [rows, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current?.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };

  return (
    <table className="w-full text-sm">
      <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
        <tr>
          {COLUMNS.map((col) => (
            <th key={col.key} className="px-3 py-2">
              <button
                type="button"
                onClick={() => toggleSort(col.key)}
                className={`flex w-full items-center gap-1 ${
                  col.align === "right" ? "justify-end" : "justify-start"
                } hover:text-zinc-900 dark:hover:text-zinc-50`}
              >
                {col.label}
                <span className="text-[10px] text-zinc-400">
                  {sort?.key === col.key ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                </span>
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => (
          <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800">
            <td className="px-3 py-2 whitespace-nowrap">{row.dateLabel}</td>
            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{row.orderRef}</td>
            <td className="px-3 py-2">{row.store}</td>
            <td className="px-3 py-2 font-mono text-xs">{row.sku}</td>
            <td className="px-3 py-2">{row.product}</td>
            <td className="px-3 py-2">{row.category}</td>
            <td className="px-3 py-2">{row.variant}</td>
            <td className="px-3 py-2">{row.type}</td>
            <td className="px-3 py-2">{row.size}</td>
            <td className="px-3 py-2 text-xs text-zinc-500">{row.attributes}</td>
            <td className="px-3 py-2 text-right">{row.qty}</td>
            <td className="px-3 py-2 text-right">{row.subtotalLabel}</td>
          </tr>
        ))}
        {!sortedRows.length && (
          <tr>
            <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-zinc-500">
              No sales data for this filter yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
