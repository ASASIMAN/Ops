"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "./icons";
import type { NavGroup } from "./nav-config";
import { globalSearchAction, type SearchHit } from "./search-action";

interface Entry {
  group: string;
  label: string;
  detail?: string;
  href: string;
}

/**
 * Global search. Typing matches the app's own screens instantly (that list
 * is already in the browser) and, a beat later, real records - products,
 * members, campaigns, KOLs, ads, tasks - from the server. Open it from the
 * top bar, with Ctrl/Cmd+K, or with "/" when not typing in a field.
 */
export function CommandPalette({ groups }: { groups: NavGroup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("asasi:search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("asasi:search", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const term = query.trim();

  // Debounced record search; a newer keystroke makes any older reply stale.
  useEffect(() => {
    if (!open || term.length < 2) return;
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const hits = await globalSearchAction(term);
        if (id === requestId.current) setRecords(hits);
      } catch {
        if (id === requestId.current) setRecords([]);
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [open, term]);

  const entries = useMemo<Entry[]>(() => {
    const needle = term.toLowerCase();
    const pages: Entry[] = [];
    for (const g of groups) {
      for (const item of g.items) {
        const haystack = `${item.label} ${g.label} ${item.keywords ?? ""}`.toLowerCase();
        if (!needle || needle.split(" ").every((w) => haystack.includes(w))) {
          pages.push({ group: "Go to", label: item.label, detail: g.label, href: item.href });
        }
      }
    }
    return [...pages.slice(0, needle ? 8 : 40), ...(term.length >= 2 ? records : [])];
  }, [groups, term, records]);

  const active = Math.min(cursor, Math.max(0, entries.length - 1));

  function close() {
    setOpen(false);
    setQuery("");
    setRecords([]);
    setCursor(0);
  }

  function go(entry: Entry | undefined) {
    if (!entry) return;
    close();
    router.push(entry.href);
  }

  if (!open) return null;

  let lastGroup = "";
  return (
    <div className="as-palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="as-palette" role="dialog" aria-modal="true" aria-label="Search">
        <input
          ref={inputRef}
          className="as-palette-input"
          placeholder="Search screens, products, members, campaigns…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor(Math.min(active + 1, entries.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor(Math.max(active - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(entries[active]);
            }
          }}
          aria-label="Search"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="as-palette-list" role="listbox">
          {entries.map((entry, i) => {
            const header = entry.group !== lastGroup ? entry.group : null;
            lastGroup = entry.group;
            return (
              <div key={`${entry.group}-${entry.href}-${entry.label}-${i}`}>
                {header && <div className="as-palette-group">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  className="as-palette-item"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(entry)}
                >
                  <span className="truncate">{entry.label}</span>
                  {entry.detail && <small>{entry.detail}</small>}
                </button>
              </div>
            );
          })}
          {entries.length === 0 && (
            <div className="as-empty">
              {searching ? "Searching…" : term.length < 2 ? "Type to search." : `Nothing matches “${term}”.`}
            </div>
          )}
          {entries.length > 0 && searching && <div className="as-palette-group">Searching records…</div>}
        </div>
      </div>
    </div>
  );
}

export function SearchTrigger() {
  return (
    <button
      type="button"
      className="as-search-trigger"
      onClick={() => window.dispatchEvent(new Event("asasi:search"))}
      aria-label="Search"
    >
      <SearchIcon />
      <span>Search</span>
      <kbd className="as-kbd">Ctrl K</kbd>
    </button>
  );
}
