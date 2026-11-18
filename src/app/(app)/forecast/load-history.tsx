"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { syncHistoryChunkAction } from "../operations/actions";

const DAY_MS = 24 * 60 * 60 * 1000;
// Same window size as /operations' "Sync all history": one short server
// action per window, so no request nears the 60s limit.
const CHUNK_DAYS = 14;

const monthFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", year: "numeric" });

/**
 * Loads POS sales from Odoo from a chosen month up to now, from the browser
 * as a loop of 14-day windows, with progress. Safe to re-run: every write
 * is an upsert. Reports orders found per month at the end, so a month that
 * Odoo itself has no sales for shows up as 0 rather than going unnoticed.
 */
export function LoadSalesHistory({ defaultFromMonth, earliestSynced }: { defaultFromMonth: string; earliestSynced: string | null }) {
  const router = useRouter();
  const [fromMonth, setFromMonth] = useState(defaultFromMonth);
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "running" | "done" | "error"; text: string }>({ kind: "idle" });
  const running = status.kind === "running";

  const run = async () => {
    const start = new Date(`${fromMonth}-01T00:00:00Z`);
    const now = new Date();
    if (!Number.isFinite(start.getTime()) || start >= now) {
      setStatus({ kind: "error", text: "Pick a month in the past." });
      return;
    }
    const chunks: { from: string; to: string }[] = [];
    for (let t = start.getTime(); t < now.getTime(); t += CHUNK_DAYS * DAY_MS) {
      chunks.push({ from: new Date(t).toISOString(), to: new Date(Math.min(t + CHUNK_DAYS * DAY_MS, now.getTime())).toISOString() });
    }

    const ordersByMonth = new Map<string, number>();
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      setStatus({ kind: "running", text: `Loading ${chunk.from.slice(0, 10)} (${i + 1} of ${chunks.length})... keep this page open.` });
      let result;
      try {
        result = await syncHistoryChunkAction(chunk.from, chunk.to, i === 0);
      } catch {
        result = { ok: false as const, error: "request failed or timed out" };
      }
      if (!result.ok) {
        setStatus({ kind: "error", text: `Stopped at ${chunk.from.slice(0, 10)}: ${result.error}. Run it again to retry - loaded days are just re-checked.` });
        router.refresh();
        return;
      }
      const month = chunk.from.slice(0, 7);
      ordersByMonth.set(month, (ordersByMonth.get(month) ?? 0) + result.ordersSynced);
    }

    const total = Array.from(ordersByMonth.values()).reduce((a, b) => a + b, 0);
    const perMonth = Array.from(ordersByMonth.entries())
      .map(([m, n]) => `${monthFormatter.format(new Date(`${m}-01T00:00:00Z`))} ${n.toLocaleString()}`)
      .join(" · ");
    setStatus({ kind: "done", text: `Done: ${total.toLocaleString()} orders from Odoo. Orders by window start month: ${perMonth}.` });
    router.refresh();
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <label className="fc-card-sub flex items-center gap-2" style={{ marginTop: 0 }}>
        Load sales from
        <input
          type="month"
          value={fromMonth}
          onChange={(e) => setFromMonth(e.target.value)}
          disabled={running}
          className="fc-control fc-control-light"
          style={{ height: "2rem" }}
        />
      </label>
      <button type="button" onClick={run} disabled={running} className="fc-btn fc-btn-light" style={{ background: "#fff" }}>
        {running ? "Loading sales..." : "Load sales history from Odoo"}
      </button>
      <span className="fc-card-sub" style={{ marginTop: 0, color: status.kind === "error" ? "var(--fc-bad)" : undefined }}>
        {status.kind === "idle"
          ? earliestSynced
            ? `Synced sales start ${monthFormatter.format(new Date(`${earliestSynced.slice(0, 7)}-01T00:00:00Z`))}.`
            : "No sales synced yet."
          : status.text}
      </span>
    </div>
  );
}
