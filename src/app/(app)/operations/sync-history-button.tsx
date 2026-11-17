"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { planHistorySyncAction, syncHistoryChunkAction } from "./actions";

/**
 * "Sync all history": loads every order from the first one in Odoo up to now.
 * Done from the browser as a loop of short server action calls (one 14-day
 * window each) rather than one long request, so it can't hit the 60s limit
 * and can show progress. Safe to re-run - everything is an upsert.
 */
export function SyncHistoryButton() {
  const router = useRouter();
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "running" | "done" | "error"; text: string }
  >({ kind: "idle" });

  const running = status.kind === "running";

  const run = async () => {
    setStatus({ kind: "running", text: "Finding the first sale in Odoo..." });
    const plan = await planHistorySyncAction();
    if (!plan.ok) {
      setStatus({ kind: "error", text: plan.error });
      return;
    }

    let orders = 0;
    for (let i = 0; i < plan.chunks.length; i++) {
      const chunk = plan.chunks[i];
      setStatus({
        kind: "running",
        text: `Syncing ${chunk.from.slice(0, 10)} (${i + 1} of ${plan.chunks.length})... keep this page open`,
      });
      let result;
      try {
        result = await syncHistoryChunkAction(chunk.from, chunk.to, i === 0);
      } catch {
        result = { ok: false as const, error: "request failed or timed out" };
      }
      if (!result.ok) {
        setStatus({
          kind: "error",
          text: `Stopped at ${chunk.from.slice(0, 10)}: ${result.error}. Click again to retry - already-synced days are simply re-checked.`,
        });
        router.refresh();
        return;
      }
      orders += result.ordersSynced;
    }

    setStatus({
      kind: "done",
      text: `Done: ${orders.toLocaleString()} orders checked since ${plan.firstDate}.`,
    });
    router.refresh();
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="border border-[var(--ops-rule)] px-3 py-1 text-xs font-medium uppercase tracking-wider hover:bg-zinc-100 disabled:opacity-50"
      >
        {running ? "Syncing history..." : "Sync all history"}
      </button>
      {status.kind !== "idle" && (
        <span
          className={`text-xs ${status.kind === "error" ? "text-red-700" : "text-zinc-500"}`}
        >
          {status.text}
        </span>
      )}
    </div>
  );
}
