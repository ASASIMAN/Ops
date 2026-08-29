import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

export default function HubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
