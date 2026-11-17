import { Suspense } from "react";
import { getShellContext } from "@/lib/shell/context";
import { getNotifications } from "@/lib/shell/notifications";
import { CommandPalette } from "./command-palette";
import { navForRole } from "./nav-config";
import { Sidebar, SidebarFallback } from "./sidebar";
import { NotificationsFallback, NotificationsMenu, Topbar, TopbarFallback } from "./topbar";

/**
 * Restores the sidebar's collapsed/folded state from localStorage onto
 * <html> before the first paint, so the layout never jumps as the page
 * hydrates (see sidebar.tsx for why this isn't React state).
 */
const RESTORE_NAV_STATE = `try{var d=document.documentElement,s=localStorage;if(s.getItem("asasi.sidebar")==="collapsed")d.dataset.sidebar="collapsed";var c=s.getItem("asasi.nav.closed");if(c)d.dataset.navClosed=c}catch(e){}`;

async function ShellSidebar() {
  const { role } = await getShellContext();
  const groups = navForRole(role);
  return (
    <>
      <Sidebar groups={groups} />
      <CommandPalette groups={groups} />
    </>
  );
}

async function ShellNotifications() {
  const { role } = await getShellContext();
  const items = await getNotifications(role).catch(() => []);
  return <NotificationsMenu items={items} />;
}

async function ShellTopbar() {
  const { email, role } = await getShellContext();
  return (
    <Topbar
      groups={navForRole(role)}
      email={email}
      role={role}
      notifications={
        <Suspense fallback={<NotificationsFallback />}>
          <ShellNotifications />
        </Suspense>
      }
    />
  );
}

/**
 * The frame around every signed-in screen: persistent sidebar, top bar
 * (breadcrumbs, search, notifications, account) and the content column.
 *
 * It lives in the one (app) layout, so moving between sections swaps only
 * the content - the frame is never torn down or re-fetched. The parts that
 * need to know who is signed in sit behind their own <Suspense> boundaries
 * with same-sized placeholders: the page underneath starts rendering
 * immediately instead of waiting on the session lookup, and nothing shifts
 * when they arrive. Auth itself is enforced in middleware, not here.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="as-app">
      <script dangerouslySetInnerHTML={{ __html: RESTORE_NAV_STATE }} />
      <Suspense fallback={<SidebarFallback />}>
        <ShellSidebar />
      </Suspense>
      <div className="as-main-col">
        <Suspense fallback={<TopbarFallback />}>
          <ShellTopbar />
        </Suspense>
        <main className="as-content">{children}</main>
      </div>
    </div>
  );
}
