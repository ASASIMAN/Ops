import Link from "next/link";
import { getInsights } from "@/lib/insights";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const { active, blocked } = await getInsights();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Insights &amp; Alerts</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Every rule from the brief&apos;s analysis section, run against real
        data. Rules that can&apos;t run yet are listed below with the
        specific reason, not silently skipped.
      </p>

      <h2 className="mt-6 text-sm font-medium text-zinc-500">
        Active ({active.length})
      </h2>
      <ul className="mt-2 space-y-2">
        {active.map((insight) => (
          <li
            key={insight.text}
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30"
          >
            <Link href={insight.href} className="text-amber-900 hover:underline dark:text-amber-400">
              {insight.text}
            </Link>
          </li>
        ))}
        {!active.length && (
          <li className="text-sm text-zinc-500">Nothing needs attention right now.</li>
        )}
      </ul>

      <h2 className="mt-8 text-sm font-medium text-zinc-500">
        Not computable yet ({blocked.length})
      </h2>
      <ul className="mt-2 space-y-2">
        {blocked.map((b) => (
          <li
            key={b.rule}
            className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
          >
            <div className="font-medium">{b.rule}</div>
            <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{b.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
