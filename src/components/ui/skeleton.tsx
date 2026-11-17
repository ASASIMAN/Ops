/**
 * Placeholder shapes shown the instant a link is clicked, while the real
 * screen is still being rendered on the server. They mirror the common page
 * anatomy (title, row of stat tiles, cards) so the swap to real content
 * doesn't shift the layout.
 */
export function Skel({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`as-skel ${className}`} />;
}

export function PageSkeleton({
  tiles = 4,
  cards = 2,
}: {
  tiles?: number;
  cards?: number;
}) {
  return (
    <div role="status" aria-label="Loading">
      <div className="as-page-head">
        <div>
          <Skel className="h-7 w-56" />
          <Skel className="mt-3 h-3.5 w-80 max-w-full" />
        </div>
        <Skel className="h-9 w-64 max-w-full" />
      </div>
      {tiles > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: tiles }, (_, i) => (
            <div key={i} className="as-stat">
              <Skel className="h-3 w-24" />
              <Skel className="h-7 w-32" />
              <Skel className="mt-auto h-3 w-28" />
            </div>
          ))}
        </div>
      )}
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="as-card">
            <div className="as-card-head">
              <Skel className="h-3.5 w-40" />
            </div>
            <div className="as-card-pad">
              <Skel className="h-56 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      <div className="as-page-head">
        <div>
          <Skel className="h-7 w-56" />
          <Skel className="mt-3 h-3.5 w-80 max-w-full" />
        </div>
      </div>
      <div className="as-card">
        <div className="as-card-head">
          <Skel className="h-3.5 w-40" />
        </div>
        <div className="as-card-pad flex flex-col gap-4">
          {Array.from({ length: rows }, (_, i) => (
            <Skel key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
