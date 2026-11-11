import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

export default function MembershipLayout({ children }: { children: React.ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
