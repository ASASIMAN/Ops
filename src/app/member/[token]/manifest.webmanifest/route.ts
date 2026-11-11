import { getMemberByToken } from "@/lib/membership/data";

export const dynamic = "force-dynamic";

// Per-member manifest so the home-screen icon opens straight to this card.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!(await getMemberByToken(token))) return new Response("Not found", { status: 404 });

  const manifest = {
    name: "ASASI Membership",
    short_name: "ASASI",
    start_url: `/member/${token}`,
    scope: `/member/${token}`,
    display: "standalone",
    background_color: "#111111",
    theme_color: "#111111",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" },
  });
}
