import { AuthenticatedShell } from "@/components/shell/authenticated-shell";
import "./brand.css";

export default function OperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `.ops-brand` scopes the ASASI brand theme (brand.css) to this workspace.
  return (
    <div className="ops-brand">
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </div>
  );
}
