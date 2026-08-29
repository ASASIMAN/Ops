import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

export default function OperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
