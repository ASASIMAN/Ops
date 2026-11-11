import { headers } from "next/headers";

/**
 * Public origin used in QR codes and wallet passes. Printed material and
 * installed passes outlive any one deploy, so set MEMBERSHIP_BASE_URL to the
 * production domain; the request host is only a dev fallback.
 */
export async function getBaseUrl(): Promise<string> {
  const configured = process.env.MEMBERSHIP_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export const verifyUrl = (base: string, code: string) => `${base}/v/${code}`;
export const cardUrl = (base: string, token: string) => `${base}/member/${token}`;
