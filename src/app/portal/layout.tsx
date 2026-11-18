import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: { default: "ASASI Membership", template: "%s · ASASI Membership" },
  description: "Your ASASI member card, points and partner perks.",
  robots: { index: false },
  manifest: "/portal/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ASASI", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#1c2b10" };

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
