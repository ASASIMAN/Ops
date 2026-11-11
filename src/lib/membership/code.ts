import { randomInt } from "node:crypto";

/** Cookie remembering the member on this device so /join skips to their card. */
export const MEMBER_COOKIE = "asasi_member";

// No 0/O/1/I/L - codes get read aloud and typed in at the till.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateMemberCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function normalizeMemberCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length === 8 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;
}

/** Accepts a bare code or a full /v/<code> URL (what the QR contains). */
export function extractMemberCode(input: string): string {
  const match = input.match(/\/v\/([A-Za-z0-9-]+)/);
  return normalizeMemberCode(match ? match[1] : input);
}
