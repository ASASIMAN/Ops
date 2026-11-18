import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PortalFrame } from "@/components/portal/frame";
import { MemberHome } from "@/components/portal/member-home";
import { portalPaths } from "@/lib/membership/portal";
import { getMemberByToken } from "@/lib/membership/data";

export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "My ASASI Membership",
    robots: { index: false },
    manifest: `/member/${token}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "ASASI", statusBarStyle: "black" },
  };
}

/** A member's card by its secret link (saved links, wallet passes) - the same page the members portal shows. */
export default async function MemberCardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [member, paths] = await Promise.all([getMemberByToken(token), portalPaths()]);
  if (!member) notFound();
  return (
    <PortalFrame homeHref={paths.home}>
      <MemberHome member={member} />
    </PortalFrame>
  );
}
