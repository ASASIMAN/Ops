"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/membership", "Members"],
  ["/membership/scan", "Scan"],
  ["/membership/venues", "Partner venues"],
  ["/membership/tent-card", "Tent card"],
] as const;

export function MembershipNav() {
  const path = usePathname();
  return (
    <nav className="border-b border-zinc-200 print:hidden dark:border-zinc-800">
      <div className="mx-auto flex max-w-6xl gap-5 overflow-x-auto px-6 text-sm">
        {LINKS.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className={`whitespace-nowrap border-b-2 py-2.5 ${
              path === href
                ? "border-zinc-900 font-medium dark:border-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
