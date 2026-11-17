import Link from "next/link";

/**
 * A one-of-N filter as links: the choice lives in the URL (shareable, kept on
 * refresh) and switching it is a normal client-side navigation.
 */
export function FilterLinks({
  basePath,
  param,
  value,
  options,
  allLabel,
  keep = {},
  label,
}: {
  basePath: string;
  param: string;
  /** Current value; undefined/"" means the "all" option. */
  value?: string;
  options: { value: string; label: string }[];
  /** Omit to offer no "all" option. */
  allLabel?: string;
  keep?: Record<string, string | undefined>;
  label: string;
}) {
  const hrefFor = (v: string | null) => {
    const params = new URLSearchParams(
      Object.entries(keep).filter((e): e is [string, string] => Boolean(e[1]) && e[0] !== param),
    );
    if (v) params.set(param, v);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  return (
    <nav className="as-seg" aria-label={label}>
      {allLabel && (
        <Link href={hrefFor(null)} aria-current={!value ? "true" : undefined} scroll={false}>
          {allLabel}
        </Link>
      )}
      {options.map((o) => (
        <Link key={o.value} href={hrefFor(o.value)} aria-current={value === o.value ? "true" : undefined} scroll={false}>
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
