"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { AsasiLogo } from "@/components/brand/asasi-logo";
import { ChevronIcon, NavIcon } from "./icons";
import { findActive, type NavGroup } from "./nav-config";

/**
 * Which groups are folded, and whether the whole sidebar is collapsed to its
 * rail, are kept as attributes on <html> (restored from localStorage by the
 * inline script in app-shell.tsx before first paint) rather than in React
 * state - so the sidebar never flashes open and shut while the page hydrates.
 */
const CLOSED_KEY = "asasi.nav.closed";

function readClosed(): string[] {
  return (document.documentElement.dataset.navClosed ?? "").split(" ").filter(Boolean);
}

function toggleGroup(id: string) {
  const closed = new Set(readClosed());
  if (closed.has(id)) closed.delete(id);
  else closed.add(id);
  const value = [...closed].join(" ");
  document.documentElement.dataset.navClosed = value;
  try {
    localStorage.setItem(CLOSED_KEY, value);
  } catch {
    // private mode / storage blocked: the fold just won't persist
  }
}

/** Shows only while the clicked link's destination is still loading. */
function PendingDot() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className="as-nav-pending" data-pending={pending} />;
}

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const active = findActive(groups, pathname);

  // Close the mobile drawer once a navigation lands.
  useEffect(() => {
    delete document.documentElement.dataset.nav;
  }, [pathname]);

  return (
    <>
      <div
        className="as-scrim"
        onClick={() => delete document.documentElement.dataset.nav}
        aria-hidden
      />
      <aside className="as-sidebar" aria-label="Main navigation">
        <Link href="/dashboard" className="as-sidebar-head" aria-label="ASASI - dashboard">
          <AsasiLogo className="as-sidebar-logo h-[1.35rem]" />
          <span className="as-sidebar-mark" aria-hidden>
            A.
          </span>
        </Link>
        <nav className="as-nav">
          {groups.map((group) => (
            <div
              key={group.id}
              className="as-nav-group"
              data-group={group.id}
              data-active={active?.group.id === group.id}
            >
              <button
                type="button"
                className="as-nav-group-head"
                title={group.label}
                onClick={() => {
                  // On the collapsed rail the icon is a shortcut to the
                  // section's first screen; expanded, it folds the group.
                  const railed =
                    document.documentElement.dataset.sidebar === "collapsed" &&
                    window.matchMedia("(min-width: 1024px)").matches;
                  if (railed) {
                    delete document.documentElement.dataset.sidebar;
                    try {
                      localStorage.removeItem("asasi.sidebar");
                    } catch {}
                    return;
                  }
                  toggleGroup(group.id);
                }}
              >
                <NavIcon name={group.icon} />
                <span className="as-nav-group-label">{group.label}</span>
                <ChevronIcon className="as-nav-chevron" />
              </button>
              <div className="as-nav-items">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="as-nav-link"
                    aria-current={active?.item.href === item.href ? "page" : undefined}
                  >
                    {item.label}
                    <PendingDot />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="as-sidebar-foot">Studio ASASI &middot; Bali</div>
      </aside>
    </>
  );
}

/** Same footprint as the real sidebar, shown for the instant before the signed-in user's sections are known. */
export function SidebarFallback() {
  return (
    <aside className="as-sidebar" aria-hidden>
      <div className="as-sidebar-head">
        <AsasiLogo className="as-sidebar-logo h-[1.35rem]" />
      </div>
    </aside>
  );
}
