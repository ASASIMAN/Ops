"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getIdrPerPoint, getMemberByCode, getStaffUser } from "@/lib/membership/data";
import { createAdminClient } from "@/lib/supabase/admin";

async function apply(formData: FormData, kind: "earn" | "redeem") {
  const staff = await getStaffUser();
  if (!staff) redirect("/login");

  const code = String(formData.get("code") || "");
  const member = await getMemberByCode(code);
  if (!member) redirect(`/v/${code}`);
  if (member.status !== "active") redirect(`/v/${code}?result=suspended`);

  const location = String(formData.get("location") || "").trim().slice(0, 80) || null;
  let points: number;
  let amount: number | null = null;

  if (kind === "earn") {
    amount = Math.round(Number(formData.get("amountIdr")));
    if (!Number.isFinite(amount) || amount <= 0) redirect(`/v/${code}?result=invalid`);
    points = Math.floor(amount / (await getIdrPerPoint()));
    if (points <= 0) redirect(`/v/${code}?result=toosmall`);
  } else {
    const requested = Math.round(Number(formData.get("points")));
    if (!Number.isFinite(requested) || requested <= 0) redirect(`/v/${code}?result=invalid`);
    if (requested > member.points_balance) redirect(`/v/${code}?result=insufficient`);
    points = -requested;
  }

  const { error } = await createAdminClient().rpc("member_apply_points", {
    p_member: member.id,
    p_kind: kind,
    p_points: points,
    p_amount_idr: amount,
    p_location: location,
    p_note: String(formData.get("note") || "").trim().slice(0, 200) || null,
    p_created_by: staff.email,
  });
  if (error) {
    console.error("member_apply_points failed", error);
    redirect(`/v/${code}?result=failed`);
  }

  revalidatePath(`/v/${code}`);
  revalidatePath("/membership");
  redirect(`/v/${code}?result=${kind}&points=${Math.abs(points)}`);
}

export async function earnPointsAction(fd: FormData) {
  await apply(fd, "earn");
}

export async function redeemPointsAction(fd: FormData) {
  await apply(fd, "redeem");
}
