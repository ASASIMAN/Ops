import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
