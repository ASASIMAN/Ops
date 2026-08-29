import Link from "next/link";

const modules = [
  { href: "/marketing/paid-media", label: "Paid Media", status: "live" as const },
  { href: "/marketing/import", label: "Data Import", status: "live" as const },
  { href: null, label: "Overview", status: "soon" as const },
  { href: null, label: "Organic Social", status: "soon" as const },
  { href: null, label: "Web & Ecom", status: "soon" as const },
  { href: null, label: "Retail & Local", status: "soon" as const },
  { href: null, label: "Financials", status: "soon" as const },
  { href: null, label: "Campaign Tracker", status: "soon" as const },
  { href: null, label: "Creative Planner", status: "soon" as const },
  { href: null, label: "KOL CRM", status: "soon" as const },
  { href: null, label: "To-Dos", status: "soon" as const },
];

export default function MarketingPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Marketing Command Centre
      </h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Built module by module, per the build order.
      </p>

      <ul className="mt-6 divide-y divide-zinc-200 dark:divide-zinc-800">
        {modules.map((m) => (
          <li key={m.label} className="flex items-center justify-between py-3">
            {m.href ? (
              <Link href={m.href} className="text-sm font-medium hover:underline">
                {m.label}
              </Link>
            ) : (
              <span className="text-sm text-zinc-500">{m.label}</span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                m.status === "live"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
              }`}
            >
              {m.status === "live" ? "Live" : "Coming soon"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
