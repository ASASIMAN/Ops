import { createAdminClient } from "@/lib/supabase/admin";
import { getInsights } from "@/lib/insights";
import { canAccessModule } from "@/components/shell/nav-config";
import { baliToday } from "./context";

export interface AppNotification {
  id: string;
  tone: "bad" | "warn" | "info";
  title: string;
  detail?: string;
  href: string;
}

const STALE_AFTER_HOURS = 36;

/**
 * Everything the bell shows is derived from the current state of real
 * records - a failed or overdue sync, tasks past their due date, the
 * marketing rules that are currently tripped. Nothing is stored, so a
 * notice disappears by itself once the underlying thing is fixed.
 */
export async function getNotifications(role: string): Promise<AppNotification[]> {
  const admin = createAdminClient();
  const out: AppNotification[] = [];
  const seesSales = canAccessModule(role, "operations") || canAccessModule(role, "forecast");
  const seesMarketing = canAccessModule(role, "marketing");

  const [syncRes, taskRes, insights] = await Promise.all([
    seesSales
      ? admin
          .from("sync_runs")
          .select("sync_type, status, started_at, error_message")
          .order("started_at", { ascending: false })
          .limit(40)
      : Promise.resolve({ data: null }),
    seesMarketing
      ? admin
          .from("tasks")
          .select("id, title, due_date")
          .neq("status", "done")
          .lt("due_date", baliToday())
          .order("due_date", { ascending: true })
          .limit(50)
      : Promise.resolve({ data: null }),
    seesMarketing ? getInsights().catch(() => null) : Promise.resolve(null),
  ]);

  const runs = (syncRes.data ?? []) as {
    sync_type: string | null;
    status: string;
    started_at: string;
    error_message: string | null;
  }[];
  for (const [type, label, href] of [
    ["sales", "Sales", "/operations"],
    ["stock", "Stock", "/forecast"],
  ] as const) {
    const ofType = runs.filter((r) => (r.sync_type ?? "sales") === type);
    const latest = ofType[0];
    if (!latest) continue;
    if (latest.status === "error") {
      out.push({
        id: `sync-${type}-error`,
        tone: "bad",
        title: `${label} sync failed`,
        detail: latest.error_message?.slice(0, 140) ?? undefined,
        href,
      });
      continue;
    }
    const lastOk = ofType.find((r) => r.status === "success");
    if (lastOk) {
      const hours = (Date.now() - new Date(lastOk.started_at).getTime()) / 36e5;
      if (hours > STALE_AFTER_HOURS) {
        out.push({
          id: `sync-${type}-stale`,
          tone: "warn",
          title: `${label} data is ${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? "" : "s"} old`,
          detail: "The last successful Odoo sync is older than a day and a half.",
          href,
        });
      }
    }
  }

  const overdue = (taskRes.data ?? []) as { id: number; title: string; due_date: string }[];
  if (overdue.length) {
    out.push({
      id: "tasks-overdue",
      tone: "warn",
      title: `${overdue.length} overdue task${overdue.length === 1 ? "" : "s"}`,
      detail: overdue
        .slice(0, 2)
        .map((t) => t.title)
        .join(" · "),
      href: "/marketing/tasks",
    });
  }

  for (const [i, insight] of (insights?.active ?? []).slice(0, 5).entries()) {
    out.push({
      id: `insight-${i}`,
      tone: "info",
      title: insight.text,
      href: insight.href || "/marketing/insights",
    });
  }

  return out;
}
