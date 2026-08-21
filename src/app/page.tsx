import Link from "next/link";
import { StatusCard } from "@/components/status-card";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold tracking-tight">Ops</span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome to Ops
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            This is a blank starting point. Add pages, components, and
            Supabase tables as the team&apos;s requests come in.
          </p>
        </div>

        <StatusCard />

        <Link
          href="/dashboard"
          className="rounded-lg border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
        >
          <div className="text-sm font-medium">Sales Dashboard →</div>
          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Odoo POS sales data, filterable by date, store, category, color,
            and size.
          </div>
        </Link>
      </main>
    </div>
  );
}
