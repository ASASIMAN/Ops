"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CORE_ITEM_KEYS, coreItem } from "@/lib/budget/items";
import { SETTING_KEYS, can, getPlannerUser, loadBudgetPlanner, type PlannerUser } from "@/lib/budget/data";
import { addMonths, monthStart } from "@/lib/budget/model";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE = "/planning/budget";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}#pushes`);
}

async function requireUser(check: (u: PlannerUser) => boolean): Promise<PlannerUser> {
  const user = await getPlannerUser();
  if (!user) redirect("/login");
  if (!check(user)) back({ error: "not_allowed" });
  return user;
}

/** "5.000.000", "5,000,000", "Rp 5 jt" -> 5000000 (digits only; "jt"/"m" = million). */
function parseRupiah(raw: string): number {
  const text = raw.trim().toLowerCase();
  const million = /\b(jt|juta|m|mio)\b/.test(text);
  const digits = Number(text.replace(/[^\d]/g, ""));
  return million ? digits * 1_000_000 : digits;
}

async function logEvent(pushId: number, user: PlannerUser, action: string, note: string | null) {
  await createAdminClient()
    .from("marketing_push_events")
    .insert({ push_id: pushId, actor: user.email, actor_role: user.canApprove ? `${user.role}, approver` : user.role, action, note });
}

export async function proposePushAction(formData: FormData) {
  const user = await requireUser(can.propose);
  const itemKey = String(formData.get("item") || "");
  const month = String(formData.get("month") || "");
  const amount = parseRupiah(String(formData.get("amount") || ""));
  const unitsRaw = String(formData.get("unitsPerSale") || "").trim().replace(",", ".");
  const unitsPerSale = unitsRaw ? Number(unitsRaw) : null;
  const reason = String(formData.get("reason") || "").trim().slice(0, 500) || null;

  const current = monthStart(new Date());
  if (!coreItem(itemKey)) back({ error: "item" });
  if (!/^\d{4}-\d{2}-01$/.test(month) || month < current || month > addMonths(current, 11)) back({ error: "month" });
  if (!(amount > 0) || amount > 10_000_000_000) back({ error: "amount" });
  if (unitsPerSale !== null && !(unitsPerSale > 0 && unitsPerSale <= 20)) back({ error: "units" });

  // Snapshot the prediction so the result can be compared once the month is over.
  const plan = await loadBudgetPlanner();
  const item = plan.items.find((i) => i.item.key === itemKey);
  const perSale = unitsPerSale ?? item?.unitsPerSale ?? null;
  let predicted: { units: number; revenue: number | null; profit: number | null } | null = null;
  if (item && plan.response && perSale) {
    const igSales = amount / plan.response.costPerIgSale;
    const units = igSales * perSale;
    predicted = {
      units,
      revenue: item.price !== null ? units * item.price : null,
      profit: item.price !== null && item.cost !== null ? units * (item.price - item.cost) - amount : null,
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("marketing_pushes")
    .insert({
      item_key: itemKey,
      month,
      amount_idr: Math.round(amount),
      units_per_ig_sale: unitsPerSale,
      reason,
      proposed_by: user.email,
      predicted_units: predicted ? Math.round(predicted.units * 10) / 10 : null,
      predicted_revenue_idr: predicted?.revenue != null ? Math.round(predicted.revenue) : null,
      predicted_profit_idr: predicted?.profit != null ? Math.round(predicted.profit) : null,
    })
    .select("id")
    .single();
  if (error || !data) back({ error: error?.message ?? "save" });
  await logEvent(data.id, user, "proposed", reason);
  revalidatePath(PAGE);
  back({ done: "proposed" });
}

/** Ops checks the stock is really there and agrees the push makes sense. */
export async function confirmPushAction(formData: FormData) {
  const user = await requireUser(can.confirm);
  const id = Number(formData.get("id"));
  const note = String(formData.get("note") || "").trim().slice(0, 500) || null;
  const { data } = await createAdminClient()
    .from("marketing_pushes")
    .update({ status: "confirmed", confirmed_by: user.email, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "proposed")
    .select("id");
  if (!data?.length) back({ error: "changed" });
  await logEvent(id, user, "confirmed", note);
  revalidatePath(PAGE);
  back({ done: "confirmed" });
}

/** The CEO approves or rejects a push ops has confirmed. */
export async function decidePushAction(formData: FormData) {
  const user = await requireUser(can.approve);
  const id = Number(formData.get("id"));
  const decision = formData.get("decision") === "approve" ? "approved" : "rejected";
  const note = String(formData.get("note") || "").trim().slice(0, 500) || null;
  if (decision === "rejected" && !note) back({ error: "reason" });
  const { data } = await createAdminClient()
    .from("marketing_pushes")
    .update({ status: decision, decided_by: user.email, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "confirmed")
    .select("id");
  if (!data?.length) back({ error: "changed" });
  await logEvent(id, user, decision, note);
  revalidatePath(PAGE);
  back({ done: decision });
}

/** The proposer (or an admin) takes back a push that hasn't been decided yet. */
export async function withdrawPushAction(formData: FormData) {
  const user = await requireUser(() => true);
  const id = Number(formData.get("id"));
  const admin = createAdminClient();
  const { data: push } = await admin.from("marketing_pushes").select("proposed_by, status").eq("id", id).maybeSingle();
  if (!push || !["proposed", "confirmed"].includes(push.status)) back({ error: "changed" });
  if (push.proposed_by !== user.email && user.role !== "admin") back({ error: "not_allowed" });
  await admin
    .from("marketing_pushes")
    .update({ status: "withdrawn", updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["proposed", "confirmed"]);
  await logEvent(id, user, "withdrawn", null);
  revalidatePath(PAGE);
  back({ done: "withdrawn" });
}

/** Anyone on the team can add a note to a push. */
export async function commentPushAction(formData: FormData) {
  const user = await requireUser(() => true);
  const id = Number(formData.get("id"));
  const note = String(formData.get("note") || "").trim().slice(0, 1000);
  if (!note) back({ error: "empty" });
  await logEvent(id, user, "commented", note);
  revalidatePath(PAGE);
  back({ done: "commented" });
}

async function setAssumption(key: string, value: number | null, label: string) {
  const admin = createAdminClient();
  if (value === null) {
    await admin.from("assumptions").delete().eq("key", key);
    return;
  }
  const { data: existing } = await admin.from("assumptions").select("id").eq("key", key).maybeSingle();
  const row = { value, label, updated_at: new Date().toISOString() };
  if (existing) await admin.from("assumptions").update(row).eq("id", existing.id);
  else await admin.from("assumptions").insert({ key, ...row });
}

function optionalNumber(raw: FormDataEntryValue | null, min: number, max: number): number | null | "invalid" {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= min && n <= max ? n : "invalid";
}

export async function saveBudgetSettingsAction(formData: FormData) {
  await requireUser(can.settings);
  const aged = optionalNumber(formData.get("agedDays"), 30, 1000);
  const lead = optionalNumber(formData.get("askLead"), 0, 6);
  if (aged === "invalid" || lead === "invalid") redirect(`${PAGE}?error=settings#settings`);
  const targets = CORE_ITEM_KEYS.map((k) => [k, optionalNumber(formData.get(`target_${k}`), 0.5, 24)] as const);
  if (targets.some(([, v]) => v === "invalid")) redirect(`${PAGE}?error=settings#settings`);

  await setAssumption(SETTING_KEYS.agedDays, aged, "Budget planner: stock older than this many days is flagged as old");
  await setAssumption(SETTING_KEYS.askLead, lead, "Budget planner: ask for budget this many months before a pile");
  for (const [k, v] of targets) await setAssumption(SETTING_KEYS.target(k), v as number | null, `Budget planner: target months of stock for ${coreItem(k)!.label}`);

  // The approver (CEO): exactly the accounts ticked.
  const approvers = new Set(formData.getAll("approver").map(String));
  const admin = createAdminClient();
  const { data: people, error } = await admin.from("profiles").select("id, can_approve_budget");
  if (!error)
    for (const p of people ?? [])
      if (Boolean(p.can_approve_budget) !== approvers.has(p.id))
        await admin.from("profiles").update({ can_approve_budget: approvers.has(p.id) }).eq("id", p.id);

  revalidatePath(PAGE);
  redirect(`${PAGE}?done=settings#settings`);
}
