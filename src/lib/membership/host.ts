/**
 * The members site (members.studioasasi.com): where every member-facing
 * page lives - the points lookup, member cards, the QR check partners
 * see, and the in-store sign-up. Kept free of server-only imports so the
 * middleware can use it too.
 */
export const DEFAULT_MEMBERS_HOST = "members.studioasasi.com";

function configuredHost(): string | null {
  return process.env.MEMBERS_HOST?.trim().toLowerCase() || null;
}

/** Is this request for the members site? (Any members.* host, so local test addresses work too.) */
export function isMembersHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(":")[0];
  const configured = configuredHost();
  return configured ? h === configured : h.startsWith("members.");
}

/** https://members.studioasasi.com (or MEMBERS_HOST) - what QR codes, wallet passes and redirects point at. */
export function membersSiteOrigin(): string {
  return `https://${configuredHost() || DEFAULT_MEMBERS_HOST}`;
}
