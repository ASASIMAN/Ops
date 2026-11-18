import Image from "next/image";
import type { PartnerVenue } from "@/lib/membership/data";

/**
 * Our partner venues as members see them: logo, name and the member offer
 * (when one is set). Managed on Members -> Partner venues.
 */
export function PartnerList({ venues, title, intro }: { venues: PartnerVenue[]; title: string; intro?: string }) {
  if (venues.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className="text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted">{title}</h2>
      {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {venues.map((v) => (
          <li key={v.id} className="flex items-center gap-4 py-3">
            {v.logo ? (
              <Image
                src={v.logo}
                alt={`${v.name} logo`}
                width={56}
                height={56}
                unoptimized
                className="size-14 shrink-0 border border-line bg-white object-contain"
              />
            ) : (
              <span
                aria-hidden
                className="grid size-14 shrink-0 place-items-center border border-line bg-surface text-sm uppercase tracking-[0.12em] text-muted"
              >
                {v.name.trim().slice(0, 1)}
              </span>
            )}
            <div className="min-w-0">
              <p className="tracking-[0.02em]">{v.name}</p>
              {v.discount_text && <p className="text-sm text-muted">{v.discount_text}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
