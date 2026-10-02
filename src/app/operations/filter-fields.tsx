"use client";

import { useMemo, useState } from "react";

/**
 * The top half of the /operations filter form: the product-family dropdown,
 * the date range, and the Variants/Size multi-selects.
 *
 * Lives on the client only because Variants and Size depend on which
 * product is picked - choosing "Linen Pants" should narrow both lists to
 * what Linen Pants actually comes in, without a page reload. The server
 * sends the full catalogue facet map once; this just filters it. The form
 * itself is still a plain GET form: every control keeps its `name`, so
 * "Apply filters" submits exactly the same query string as before.
 */

export interface ProductFamily {
  name: string;
  colors: string[];
  sizes: string[];
}

const SELECT_CLASS =
  "rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent";
const DATE_CLASS = `${SELECT_CLASS} dark:[&::-webkit-calendar-picker-indicator]:invert`;

function union(lists: string[][]): string[] {
  return Array.from(new Set(lists.flat())).sort();
}

export function FilterFields({
  families,
  initialProduct,
  initialColors,
  initialSizes,
  from,
  to,
}: {
  families: ProductFamily[];
  initialProduct: string;
  initialColors: string[];
  initialSizes: string[];
  from: string;
  to: string;
}) {
  const [product, setProduct] = useState(initialProduct);
  const [colors, setColors] = useState(initialColors);
  const [sizes, setSizes] = useState(initialSizes);

  const allColors = useMemo(() => union(families.map((f) => f.colors)), [families]);
  const allSizes = useMemo(() => union(families.map((f) => f.sizes)), [families]);

  const family = families.find((f) => f.name === product);
  const colorOptions = family ? family.colors : allColors;
  const sizeOptions = family ? family.sizes : allSizes;

  // A product from the URL that isn't in the catalogue any more (renamed,
  // deleted) would otherwise silently render as "All products" while still
  // filtering by it - keep it visible as an option instead.
  const productInList = !product || families.some((f) => f.name === product);

  const onProductChange = (next: string) => {
    setProduct(next);
    const nextFamily = families.find((f) => f.name === next);
    // Drop selections the new product doesn't have, so a hidden, stale
    // selection can't keep filtering the results.
    if (nextFamily) {
      setColors((c) => c.filter((v) => nextFamily.colors.includes(v)));
      setSizes((s) => s.filter((v) => nextFamily.sizes.includes(v)));
    }
  };

  const selected = (e: React.ChangeEvent<HTMLSelectElement>) =>
    Array.from(e.target.selectedOptions, (o) => o.value);

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Product name
        <select
          name="product"
          value={product}
          onChange={(e) => onProductChange(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">All products</option>
          {!productInList && <option value={product}>{product}</option>}
          {families.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          From
          <input type="date" name="from" defaultValue={from} className={DATE_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <input type="date" name="to" defaultValue={to} className={DATE_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Variants
          <select
            multiple
            name="color"
            value={colors}
            onChange={(e) => setColors(selected(e))}
            className={`h-24 ${SELECT_CLASS}`}
          >
            {colorOptions.map((c) => (
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
            value={sizes}
            onChange={(e) => setSizes(selected(e))}
            className={`h-24 ${SELECT_CLASS}`}
          >
            {sizeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
