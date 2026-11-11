import { readFile } from "node:fs/promises";
import path from "node:path";
import { PKPass } from "passkit-generator";
import type { Member } from "./data";
import { verifyUrl } from "./urls";

export function appleWalletConfigured(): boolean {
  return !!(
    process.env.APPLE_PASS_TYPE_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_PASS_CERT &&
    process.env.APPLE_PASS_KEY &&
    process.env.APPLE_WWDR_CERT
  );
}

// Certs are stored base64-encoded in env vars (PEM files, base64 of the file).
const pem = (v: string) => Buffer.from(v, "base64");

export async function buildApplePass(member: Member, baseUrl: string): Promise<Buffer> {
  const logo = await readFile(path.join(process.cwd(), "public/brand/asasi-logo.png"));

  const pass = new PKPass(
    { "icon.png": logo, "icon@2x.png": logo, "logo.png": logo, "logo@2x.png": logo },
    {
      wwdr: pem(process.env.APPLE_WWDR_CERT!),
      signerCert: pem(process.env.APPLE_PASS_CERT!),
      signerKey: pem(process.env.APPLE_PASS_KEY!),
      signerKeyPassphrase: process.env.APPLE_PASS_KEY_PASSPHRASE,
    },
    {
      formatVersion: 1,
      passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
      teamIdentifier: process.env.APPLE_TEAM_ID!,
      organizationName: "ASASI",
      description: "ASASI Membership",
      serialNumber: member.code,
      backgroundColor: "rgb(17, 17, 17)",
      foregroundColor: "rgb(255, 255, 255)",
      labelColor: "rgb(180, 180, 180)",
    },
  );

  pass.type = "generic";
  pass.primaryFields.push({ key: "name", label: "MEMBER", value: member.full_name });
  pass.secondaryFields.push({ key: "code", label: "MEMBER ID", value: member.code });
  pass.backFields.push({
    key: "perks",
    label: "Your membership",
    value: "Show this pass at ASASI stores and partner venues for member discounts, and to collect points.",
  });
  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: verifyUrl(baseUrl, member.code),
    messageEncoding: "iso-8859-1",
    altText: member.code,
  });

  return pass.getAsBuffer();
}
