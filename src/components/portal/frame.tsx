import { AsasiLogo } from "@/components/brand/asasi-logo";

/**
 * The member-facing pages' frame (portal, sign-up, partner check): the
 * website's olive header with the wordmark, then a single phone-width
 * column. Light only, square edges, like studioasasi.com.
 */
export function PortalFrame({
  children,
  logoHref = "https://studioasasi.com",
}: {
  children: React.ReactNode;
  /** Where the header logo goes: the ASASI website, unless a page says otherwise. */
  logoHref?: string;
}) {
  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="bg-brand text-white">
        <div className="mx-auto flex h-16 max-w-md items-center justify-center px-5">
          <a href={logoHref} aria-label={logoHref.startsWith("http") ? "ASASI website" : "Back to Members"}>
            <AsasiLogo className="h-6" />
          </a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md px-5 pb-16 pt-8">{children}</main>
      <footer className="mx-auto max-w-md px-5 pb-10 text-center text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
        <a href="https://studioasasi.com" className="hover:text-ink">
          studioasasi.com
        </a>
      </footer>
    </div>
  );
}

export function PortalHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8 text-center">
      {eyebrow && <p className="text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted">{eyebrow}</p>}
      <h1 className="mt-2 text-[1.375rem] uppercase tracking-[0.16em]">{title}</h1>
      {children && <div className="mt-3 text-[0.875rem] text-muted">{children}</div>}
    </div>
  );
}
