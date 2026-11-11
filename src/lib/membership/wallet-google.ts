import { createSign } from "node:crypto";
import type { Member } from "./data";
import { verifyUrl } from "./urls";

export function googleWalletConfigured(): boolean {
  return !!(
    process.env.GOOGLE_WALLET_ISSUER_ID &&
    process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_WALLET_PRIVATE_KEY
  );
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/**
 * "Add to Google Wallet" link: a signed JWT carrying the pass class + object,
 * so nothing has to be pre-created via the Wallet API. Each save is one
 * member's pass.
 */
export function googleSaveUrl(member: Member, baseUrl: string): string {
  const issuer = process.env.GOOGLE_WALLET_ISSUER_ID!;
  const email = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL!;
  const privateKey = process.env.GOOGLE_WALLET_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const classId = `${issuer}.asasi_membership`;

  const payload = {
    iss: email,
    aud: "google",
    typ: "savetowallet",
    origins: [baseUrl],
    payload: {
      genericClasses: [{ id: classId }],
      genericObjects: [
        {
          id: `${issuer}.member_${member.code.replace("-", "")}`,
          classId,
          state: "ACTIVE",
          cardTitle: { defaultValue: { language: "en", value: "ASASI Membership" } },
          header: { defaultValue: { language: "en", value: member.full_name } },
          subheader: { defaultValue: { language: "en", value: "Member" } },
          hexBackgroundColor: "#111111",
          logo: { sourceUri: { uri: `${baseUrl}/brand/asasi-logo.png` } },
          textModulesData: [
            { id: "code", header: "MEMBER ID", body: member.code },
            { id: "perks", header: "PERKS", body: "Partner discounts & points - show this code" },
          ],
          barcode: { type: "QR_CODE", value: verifyUrl(baseUrl, member.code), alternateText: member.code },
        },
      ],
    },
  };

  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey).toString("base64url");
  return `https://pay.google.com/gp/v/save/${head}.${body}.${sig}`;
}
