import { isMembersHost } from "@/lib/membership/portal";

export const dynamic = "force-dynamic";

// "Add to home screen" for the members portal - opens straight to the card.
export async function GET(request: Request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const home = isMembersHost(host) ? "/" : "/portal";
  const manifest = {
    name: "ASASI Membership",
    short_name: "ASASI",
    start_url: home,
    scope: home,
    display: "standalone",
    background_color: "#efefef",
    theme_color: "#1c2b10",
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
