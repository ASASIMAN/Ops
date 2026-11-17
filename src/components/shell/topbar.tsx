"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { signOutAction } from "./actions";
import { SearchTrigger } from "./command-palette";
import { BellIcon, MenuIcon, UserIcon } from "./icons";
import { findActive, type NavGroup } from "./nav-config";
import type { AppNotification } from "@/lib/shell/notifications";

function toggleSidebar() {
  const root = document.documentElement;
  if (!window.matchMedia("(min-width: 1024px)").matches) {
    if (root.dataset.nav === "open") delete root.dataset.nav;
    else root.dataset.nav = "open";
    return;
  }
  const collapsed = root.dataset.sidebar === "collapsed";
  if (collapsed) delete root.dataset.sidebar;
  else root.dataset.sidebar = "collapsed";
  try {
    if (collapsed) localStorage.removeItem("asasi.sidebar");
    else localStorage.setItem("asasi.sidebar", "collapsed");
  } catch {}
}

function Breadcrumbs({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const active = findActive(groups, pathname);
  if (!active) return <nav className="as-crumbs" aria-label="Breadcrumb" />;
  const deeper = pathname !== active.item.href;
  const sameAsGroup = active.group.items.length === 1;
  return (
    <nav className="as-crumbs" aria-label="Breadcrumb">
      {!sameAsGroup && (
        <>
          <Link href={active.group.items[0].href} className="max-sm:hidden">
            {active.group.label}
          </Link>
          <span className="as-crumb-sep max-sm:hidden" aria-hidden>
            /
          </span>
        </>
      )}
      {deeper ? (
        <>
          <Link href={active.item.href}>{active.item.label}</Link>
          <span className="as-crumb-sep" aria-hidden>
            /
          </span>
          <span aria-current="page">Detail</span>
        </>
      ) : (
        <span aria-current="page">{active.item.label}</span>
      )}
    </nav>
  );
}

/** A top-bar button with a panel under it; closes on outside click, Escape, or navigation. */
function Popover({
  label,
  button,
  children,
}: {
  label: string;
  button: ReactNode;
  children: ReactNode;
}) {
  // Remembering *which page* the panel was opened on (rather than a plain
  // boolean) means it closes by itself the moment the route changes.
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) =>
    setOpenedOn((prev) => {
      const value = typeof next === "function" ? next(prev === pathname) : next;
      return value ? pathname : null;
    });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenedOn(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenedOn(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="as-iconbtn"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {button}
      </button>
      {open && <div className="as-popover">{children}</div>}
    </div>
  );
}

const TONE_LABEL = { bad: "Action needed", warn: "Check", info: "Marketing" } as const;
const TONE_CLASS = { bad: "as-badge as-badge-bad", warn: "as-badge as-badge-warn", info: "as-badge" } as const;

export function NotificationsMenu({ items }: { items: AppNotification[] }) {
  const urgent = items.filter((n) => n.tone !== "info").length;
  return (
    <Popover
      label={`Notifications${items.length ? ` (${items.length})` : ""}`}
      button={
        <>
          <BellIcon />
          {items.length > 0 && <span className="as-dot-count">{urgent || items.length}</span>}
        </>
      }
    >
      <div className="as-popover-head">
        <span className="as-card-title">Notifications</span>
        <span className="as-card-note">{items.length ? `${items.length} open` : "All clear"}</span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {items.length === 0 && (
          <div className="as-empty">Nothing needs attention right now.</div>
        )}
        {items.map((n) => (
          <Link key={n.id} href={n.href} className="as-popover-item">
            <span className={TONE_CLASS[n.tone]}>{TONE_LABEL[n.tone]}</span>
            <span className="mt-1.5 block">{n.title}</span>
            {n.detail && <span className="mt-0.5 block text-xs text-muted">{n.detail}</span>}
          </Link>
        ))}
      </div>
    </Popover>
  );
}

/** Placeholder with the bell's footprint while notifications are still being worked out. */
export function NotificationsFallback() {
  return (
    <span className="as-iconbtn opacity-40" aria-hidden>
      <BellIcon />
    </span>
  );
}

function SignOutItem() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="as-popover-item w-full text-left" disabled={pending}>
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

function UserMenu({ email, role }: { email: string | null; role: string }) {
  return (
    <Popover label="Account" button={<UserIcon />}>
      <div className="as-popover-head">
        <span className="min-w-0">
          <span className="block truncate text-[0.8125rem]">{email ?? "Signed in"}</span>
          <span className="as-eyebrow mt-0.5 block">{role}</span>
        </span>
      </div>
      <Link href="/change-password" className="as-popover-item">
        Change password
      </Link>
      <form action={signOutAction}>
        <SignOutItem />
      </form>
    </Popover>
  );
}

export function Topbar({
  groups,
  email,
  role,
  notifications,
}: {
  groups: NavGroup[];
  email: string | null;
  role: string;
  /** Server-rendered bell, streamed in separately so it never holds the bar up. */
  notifications: ReactNode;
}) {
  return (
    <header className="as-topbar">
      <button type="button" className="as-iconbtn -ml-2" onClick={toggleSidebar} aria-label="Toggle navigation">
        <MenuIcon />
      </button>
      <Breadcrumbs groups={groups} />
      <div className="ml-auto flex items-center gap-1">
        <SearchTrigger />
        {notifications}
        <UserMenu email={email} role={role} />
      </div>
    </header>
  );
}

export function TopbarFallback() {
  return <header className="as-topbar" aria-hidden />;
}
