// Shared OAuth token refresh for Google APIs (GA4, Search Console, and
// eventually Business Profile once its access request is approved).
// Same client_id/client_secret across all three - only the refresh_token
// and requested scope differ per API, since each was authorized
// separately in the OAuth Playground.
//
// Access tokens are cached in memory per refresh token, same pattern as
// Odoo's cached uid (src/lib/odoo/rpc.ts) - avoids a token refresh round
// trip before every single API call within a warm function instance.

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<string, CachedToken>();

export async function getGoogleAccessToken(refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.accessToken;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
    );
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token refresh failed: HTTP ${res.status} ${body}`);
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(refreshToken, {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  });
  return body.access_token;
}
