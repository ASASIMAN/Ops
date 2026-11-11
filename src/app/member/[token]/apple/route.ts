import { getMemberByToken } from "@/lib/membership/data";
import { getBaseUrl } from "@/lib/membership/urls";
import { appleWalletConfigured, buildApplePass } from "@/lib/membership/wallet-apple";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const member = await getMemberByToken(token);
  if (!member) return new Response("Not found", { status: 404 });
  if (!appleWalletConfigured()) return new Response("Apple Wallet is not configured", { status: 501 });

  const buf = await buildApplePass(member, await getBaseUrl());
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="asasi-${member.code}.pkpass"`,
      "Cache-Control": "no-store",
    },
  });
}
