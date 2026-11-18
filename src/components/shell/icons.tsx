import type { IconName } from "./nav-config";

/**
 * The app's whole icon set: thin single-weight line drawings, in the spirit
 * of the three header icons on studioasasi.com. Kept deliberately small -
 * the interface is typographic, icons only mark the six sections and the
 * top-bar controls.
 */
const common = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function NavIcon({ name }: { name: IconName }) {
  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="7" height="7" />
          <rect x="13.5" y="3.5" width="7" height="7" />
          <rect x="3.5" y="13.5" width="7" height="7" />
          <rect x="13.5" y="13.5" width="7" height="7" />
        </svg>
      );
    case "sales":
      return (
        <svg {...common}>
          <path d="M5 8.5h14l-1 11.5H6L5 8.5Z" />
          <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
        </svg>
      );
    case "inventory":
      return (
        <svg {...common}>
          <path d="m12 3.5 8 4.25v8.5L12 20.5l-8-4.25v-8.5L12 3.5Z" />
          <path d="m4 7.75 8 4.25 8-4.25M12 12v8.5" />
        </svg>
      );
    case "marketing":
      return (
        <svg {...common}>
          <path d="M4 19.5h16M7 16v-5M12 16V6M17 16v-8" />
        </svg>
      );
    case "planning":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" />
          <path d="M3.5 9.5h17M8 3v4M16 3v4M8 14h3M8 17h6" />
        </svg>
      );
    case "customers":
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5" />
        </svg>
      );
  }
}

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <svg {...common}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg {...common}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

export function BellIcon() {
  return (
    <svg {...common}>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function UserIcon() {
  return (
    <svg {...common}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5" />
    </svg>
  );
}
