import Link from "next/link";
import { AsasiLogo } from "@/components/brand/asasi-logo";
import { getStaffUser } from "@/lib/membership/data";
import { qrSvg } from "@/lib/membership/qr";
import { getBaseUrl } from "@/lib/membership/urls";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export default async function TentCardPage() {
  if (!(await getStaffUser())) return <p className="p-8 text-sm text-zinc-500">No access.</p>;

  const base = await getBaseUrl();
  const joinUrl = `${base}/join?src=tent`;
  const qr = await qrSvg(joinUrl, { margin: 0 });
  const usingFallback = !process.env.MEMBERSHIP_BASE_URL;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 print:max-w-none print:p-0">
      <div className="print:hidden">
        <Link href="/membership" className="text-sm text-zinc-500 underline">← Membership</Link>
        <h1 className="mt-2 text-xl font-semibold">Tent card</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Prints on A5 landscape. Fold in half for a tent: the top half prints
          upside-down so both sides read correctly.
        </p>
        {usingFallback && (
          <p className="mt-3 rounded bg-amber-100 p-3 text-sm text-amber-900">
            <b>Before printing:</b> this QR points to <code>{base}</code>, taken from the current
            address. Set <code>MEMBERSHIP_BASE_URL</code> to your live domain and reload, otherwise
            the printed cards will point at the wrong place.
          </p>
        )}
        <div className="mt-4"><PrintButton /></div>
      </div>

      <div className="mt-6 w-full border border-dashed border-zinc-400 bg-white text-black print:mt-0 print:border-0">
        <Half flipped qr={qr} joinUrl={joinUrl} />
        <div className="border-t border-dashed border-zinc-400" />
        <Half qr={qr} joinUrl={joinUrl} />
      </div>
    </div>
  );
}

function Half({ qr, joinUrl, flipped }: { qr: string; joinUrl: string; flipped?: boolean }) {
  return (
    <div className={`flex h-[74mm] items-center justify-center gap-8 px-10 ${flipped ? "rotate-180" : ""}`}>
      <div className="flex flex-col items-start">
        <AsasiLogo className="h-8" />
        <p className="mt-3 text-2xl font-semibold leading-tight">
          Join ASASI<br />Membership
        </p>
        <p className="mt-2 max-w-[55mm] text-xs leading-snug text-zinc-700">
          Scan to add your card to your phone wallet. Member discounts at our
          partner venues + points every time you shop.
        </p>
        <p className="mt-2 break-all text-[9px] text-zinc-500">{joinUrl.replace(/^https?:\/\//, "").replace(/\?.*/, "")}</p>
      </div>
      <div className="h-[48mm] w-[48mm] shrink-0 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
    </div>
  );
}
