"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { idr } from "@/lib/biz/format";
import { proposePushAction } from "./actions";

export interface ProposeItem {
  key: string;
  label: string;
  /** Normal units of this item per Instagram-driven store sale. */
  unitsPerSale: number | null;
  price: number | null;
  cost: number | null;
}

const rp = idr;

function parseRupiah(raw: string): number {
  const text = raw.trim().toLowerCase();
  const million = /\b(jt|juta|m|mio)\b/.test(text);
  const digits = Number(text.replace(/[^\d]/g, ""));
  return million ? digits * 1_000_000 : digits;
}

/** Propose a push, with the model's estimate updating as you type. */
export function ProposeForm({
  items,
  months,
  costPerIgSale,
  defaultItem,
  defaultMonth,
}: {
  items: ProposeItem[];
  months: { value: string; label: string }[];
  costPerIgSale: number | null;
  defaultItem?: string;
  defaultMonth?: string;
}) {
  const [itemKey, setItemKey] = useState(defaultItem ?? items[0]?.key ?? "");
  const [amount, setAmount] = useState("");
  const [perSale, setPerSale] = useState("");
  const item = items.find((i) => i.key === itemKey);
  const spend = parseRupiah(amount);
  const unitsPerSale = perSale.trim() ? Number(perSale.replace(",", ".")) : (item?.unitsPerSale ?? null);

  let preview: string | null = null;
  if (spend > 0 && costPerIgSale && unitsPerSale && unitsPerSale > 0) {
    const igSales = spend / costPerIgSale;
    const extraUnits = igSales * unitsPerSale;
    const parts = [`≈ ${Math.round(igSales).toLocaleString("en-US")} extra Instagram store sales`, `≈ ${extraUnits.toFixed(1)} extra units`];
    if (item?.price) parts.push(`≈ ${rp(extraUnits * item.price)} sales`);
    if (item?.price && item.cost !== null) {
      const profit = extraUnits * (item.price - item.cost) - spend;
      parts.push(`${profit >= 0 ? "profit" : "loss"} after the spend ≈ ${rp(Math.abs(profit))}`);
      if (item.price > item.cost)
        parts.push(`pays for itself at ${(costPerIgSale / (item.price - item.cost)).toFixed(2)} units per Instagram sale`);
    } else parts.push("profit unknown (no cost price in Odoo)");
    preview = parts.join(" · ");
  }

  return (
    <form action={proposePushAction} className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
      <label className="as-field">
        Item
        <select name="item" value={itemKey} onChange={(e) => setItemKey(e.target.value)} className="as-input">
          {items.map((i) => (
            <option key={i.key} value={i.key}>
              {i.label}
            </option>
          ))}
        </select>
      </label>
      <label className="as-field">
        Month
        <select name="month" defaultValue={defaultMonth ?? months[0]?.value} className="as-input">
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="as-field">
        Extra spend (Rp)
        <input
          name="amount"
          required
          inputMode="numeric"
          placeholder="e.g. 5000000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="as-input"
        />
      </label>
      <label className="as-field">
        Units per Instagram sale
        <input
          name="unitsPerSale"
          inputMode="decimal"
          placeholder={item?.unitsPerSale ? `normal ${item.unitsPerSale.toFixed(2)}` : "no data"}
          value={perSale}
          onChange={(e) => setPerSale(e.target.value)}
          className="as-input"
        />
      </label>
      <label className="as-field sm:col-span-2 lg:col-span-4">
        Why (what you&apos;d run, which stock it shifts)
        <input name="reason" maxLength={500} placeholder="e.g. Reels featuring Linen Pants in Bone - 140 units over 6 months old" className="as-input" />
      </label>
      <p className="text-sm text-muted sm:col-span-2 lg:col-span-4" aria-live="polite">
        {preview ??
          (costPerIgSale
            ? "Enter an amount to see what it should sell."
            : "No estimate yet: the marketing section needs Meta spend, store orders and walk-in counts.")}
        {" "}
        <span className="text-xs">
          Leave &ldquo;units per Instagram sale&rdquo; empty to use the item&apos;s normal share; raise it if the ads feature this item.
        </span>
      </p>
      <div className="sm:col-span-2 lg:col-span-4">
        <SubmitButton pendingLabel="Proposing…">Propose push</SubmitButton>
      </div>
    </form>
  );
}
