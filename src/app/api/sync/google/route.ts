import { NextRequest, NextResponse } from "next/server";
import { runGoogleSync } from "@/lib/google/sync";

export const maxDuration = 60;

/**
 * Pulls recent GA4 + Search Console data into facts_daily. Same
 * CRON_SECRET-protected pattern as /api/sync/odoo - see that route's
 * comment for the full rationale. Pass ?days=N (default 3, to overlap
 * the previous run and pick up GA4's typical processing delay).
 */
async function handleSync(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Number(request.nextUrl.searchParams.get("days") ?? "3");

  try {
    const result = await runGoogleSync(days);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handleSync;
export const POST = handleSync;
