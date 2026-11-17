"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900"
    >
      Print
    </button>
  );
}
