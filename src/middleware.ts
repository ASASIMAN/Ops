import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/setup"];
// Member-facing pages (QR sign-up, member card, scan/verify, members
// portal). Matched by whole path segment so e.g. "/v" never swallows
// "/venues" and "/member" never swallows "/membership" (the staff-only module).
const PUBLIC_SEGMENTS = ["join", "member", "v", "portal"];
const CHANGE_PASSWORD_PATH = "/change-password";

// What members.studioasasi.com may show: the portal and the member pages it
// links to, nothing of the staff app. Paths are whole first segments.
const MEMBERS_HOST_SEGMENTS = new Set(["portal", "join", "member", "v", "brand", "fonts"]);
// The portal is served at the root of the members host.
const MEMBERS_HOST_REWRITES: Record<string, string> = { "/": "/portal", "/code": "/portal/code" };

function isMembersHost(host: string | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(":")[0];
  const configured = process.env.MEMBERS_HOST?.toLowerCase().trim();
  return configured ? h === configured : h.startsWith("members.");
}

export async function middleware(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (isMembersHost(host)) {
    const { pathname } = request.nextUrl;
    const rewrite = MEMBERS_HOST_REWRITES[pathname];
    if (rewrite) {
      const url = request.nextUrl.clone();
      url.pathname = rewrite;
      return NextResponse.rewrite(url);
    }
    if (MEMBERS_HOST_SEGMENTS.has(pathname.split("/")[1])) return NextResponse.next();
    // Anything of the staff app (login, dashboard, ...) - send to the portal.
    return NextResponse.redirect(new URL("/", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshes the session cookie if it's expired - required on every
  // request, not just protected ones, or sessions silently die.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic =
    PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path)) ||
    PUBLIC_SEGMENTS.includes(request.nextUrl.pathname.split("/")[1]);

  if (!user && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (
    user &&
    !isPublic &&
    !request.nextUrl.pathname.startsWith(CHANGE_PASSWORD_PATH)
  ) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("must_change_password")
      .eq("id", user.id)
      .single();

    if (profile?.must_change_password) {
      return NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets and Next internals - those
     * don't need a session check.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
