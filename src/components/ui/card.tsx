import Link from "next/link";

export function Card({
  title,
  note,
  href,
  hrefLabel = "Open report",
  className = "",
  children,
}: {
  title: string;
  note?: React.ReactNode;
  /** The fuller report behind this card. */
  href?: string;
  hrefLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`as-card flex flex-col ${className}`}>
      <header className="as-card-head">
        <div>
          <h2 className="as-card-title">{title}</h2>
          {note && <p className="as-card-note mt-0.5">{note}</p>}
        </div>
        {href && (
          <Link href={href} className="as-link shrink-0">
            {hrefLabel}
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

/** What a card shows instead of numbers it doesn't have. */
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="as-empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

/** Shown where a figure needs a database function that hasn't been installed yet. */
export function NeedsMigration({ file }: { file: string }) {
  return (
    <EmptyState title="Not set up yet">
      Run <code className="font-mono text-xs">{file}</code> in Supabase to turn this on.
    </EmptyState>
  );
}
