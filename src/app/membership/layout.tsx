import { AuthenticatedShell } from "@/components/shell/authenticated-shell";
import { MembershipNav } from "./nav";

export default function MembershipLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthenticatedShell>
      <MembershipNav />
      {children}
    </AuthenticatedShell>
  );
}
