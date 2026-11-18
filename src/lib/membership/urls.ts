import { headers } from "next/headers";
import { membersSiteOrigin } from "./host";

/**
 * Origin used in member QR codes, wallet passes and the tent card: always
 * the members site in production, so a scan never lands on the staff app.
 * In local development it's the address being browsed, so scans work there.
 */
export async function getBaseUrl(): Promise<string> {
  if (process.env.NODE_ENV === "production") return membersSiteOrigin();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export const verifyUrl = (base: string, code: string) => `${base}/v/${code}`;
export const cardUrl = (base: string, token: string) => `${base}/member/${token}`;
