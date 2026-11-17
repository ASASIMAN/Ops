import { AppShell } from "@/components/shell/app-shell";

/**
 * One layout for every signed-in screen. Because all sections share it,
 * moving between them keeps the sidebar and top bar mounted and only swaps
 * the content area.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
