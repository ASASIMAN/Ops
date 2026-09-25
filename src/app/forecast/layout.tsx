import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

export default function ForecastLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
