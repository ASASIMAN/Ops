import modules from "@config/modules.json";

/**
 * The one description of the app's navigation: the sidebar, the breadcrumbs
 * and the "go to" half of global search all read from this, so a new screen
 * is added in exactly one place.
 *
 * Who sees a section still comes from config/modules.json (the same role
 * lists the old hub tiles used), keyed by `module` below.
 */

export type Role = "admin" | "marketing" | "ops" | "viewer";
export type IconName = "overview" | "sales" | "inventory" | "marketing" | "planning" | "customers";

export interface NavItem {
  href: string;
  label: string;
  /** Extra words global search should match this page on. */
  keywords?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: IconName;
  /** config/modules.json id that decides which roles see this group; null = everyone signed in. */
  module: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    icon: "overview",
    module: null,
    items: [{ href: "/dashboard", label: "Dashboard", keywords: "home executive summary kpi" }],
  },
  {
    id: "sales",
    label: "Sales & Retail",
    icon: "sales",
    module: "operations",
    items: [
      { href: "/sales", label: "Sales overview", keywords: "revenue orders aov trend daily" },
      { href: "/sales/stores", label: "Stores", keywords: "canggu pererenan ubud nusa dua location comparison targets" },
      { href: "/sales/products", label: "Products", keywords: "best sellers category units variants" },
      { href: "/operations", label: "Sales explorer", keywords: "odoo pos lines filter sync transactions" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: "inventory",
    module: "forecast",
    items: [
      { href: "/inventory", label: "Stock", keywords: "stock on hand low stock sku variants value" },
      { href: "/forecast", label: "Forecast & PO planner", keywords: "demand purchase order restock" },
      { href: "/forecast/overview", label: "Forecast overview", keywords: "restock alerts top low sellers accuracy" },
      { href: "/forecast/lead-times", label: "Lead times", keywords: "vendor supplier purchase orders eta" },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: "marketing",
    module: "marketing",
    items: [
      { href: "/marketing", label: "Overview", keywords: "spend roas cac marketing command centre" },
      { href: "/marketing/paid-media", label: "Paid media", keywords: "meta ads google tiktok cpm cpc" },
      { href: "/marketing/organic-social", label: "Organic social", keywords: "instagram tiktok posts reels engagement" },
      { href: "/marketing/campaigns", label: "Campaigns", keywords: "campaign tracker planner" },
      { href: "/marketing/creative", label: "Creative planner", keywords: "content calendar activations" },
      { href: "/marketing/creative-brief", label: "Creative brief", keywords: "monthly review notes" },
      { href: "/marketing/kols", label: "KOL CRM", keywords: "influencers partnerships tiers" },
      { href: "/marketing/attribution", label: "Attribution & visitors", keywords: "walk-in sources geography ga4 search" },
      { href: "/marketing/financials", label: "Financials", keywords: "budget spend monthly" },
      { href: "/marketing/insights", label: "Insights", keywords: "recommendations attention" },
      { href: "/marketing/tasks", label: "Tasks", keywords: "to do owner due" },
      { href: "/marketing/import", label: "Data import", keywords: "csv upload meta ads" },
      { href: "/marketing/settings", label: "Settings", keywords: "assumptions taxonomy" },
    ],
  },
  {
    id: "planning",
    label: "Planning",
    icon: "planning",
    module: "budget_planner",
    items: [
      { href: "/planning/budget", label: "Marketing budget", keywords: "budget planner pushes stock pile deadstock forecast ceo approve" },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    icon: "customers",
    module: "membership",
    items: [
      { href: "/membership", label: "Members", keywords: "membership loyalty points sign-ups" },
      { href: "/membership/scan", label: "Scan card", keywords: "qr scan points" },
      { href: "/membership/venues", label: "Partner venues", keywords: "discounts partners" },
      { href: "/membership/tent-card", label: "Tent card", keywords: "print qr sign-up" },
    ],
  },
];

const MODULE_ROLES = new Map(
  (modules as { id: string; roles: string[] }[]).map((m) => [m.id, m.roles]),
);

export function canAccessModule(role: string, moduleId: string | null): boolean {
  if (moduleId === null) return true;
  return MODULE_ROLES.get(moduleId)?.includes(role) ?? false;
}

export function navForRole(role: string): NavGroup[] {
  return NAV_GROUPS.filter((g) => canAccessModule(role, g.module));
}

/** The nav item a path belongs to: the longest href that prefixes it. */
export function findActive(
  groups: NavGroup[],
  pathname: string,
): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && (!best || item.href.length > best.item.href.length)) best = { group, item };
    }
  }
  return best;
}
