import Link from "next/link";
import { getStaffUser } from "@/lib/membership/data";
import { Scanner } from "./scanner";

export default async function ScanPage() {
  if (!(await getStaffUser())) return <p className="p-8 text-sm text-zinc-500">No access.</p>;
  return (
    <div className="mx-auto max-w-md px-6 py-8">
      <Link href="/membership" className="text-sm text-zinc-500 underline">← Membership</Link>
      <h1 className="mt-2 text-xl font-semibold">Scan a member</h1>
      <Scanner />
    </div>
  );
}
