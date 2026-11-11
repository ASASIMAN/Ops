import { getMemberByToken } from "@/lib/membership/data";
import { getBaseUrl } from "@/lib/membership/urls";
import { googleSaveUrl, googleWalletConfigured } from "@/lib/membership/wallet-google";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const member = await getMemberByToken(token);
  if (!member) return new Response("Not found", { status: 404 });
  if (!googleWalletConfigured()) return new Response("Google Wallet is not configured", { status: 501 });

  return Response.redirect(googleSaveUrl(member, await getBaseUrl()), 302);
}
