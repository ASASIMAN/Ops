import Form from "next/form";
import Link from "next/link";
import { PERIOD_OPTIONS, type Period } from "@/lib/biz/period";

/**
 * Period tabs as plain links (so the choice lives in the URL, survives a
 * refresh and can be shared), plus a date range form when Custom is active.
 * `keep` carries any other filters on the page through the switch.
 */
export function PeriodPicker({
  basePath,
  period,
  keep = {},
}: {
  basePath: string;
  period: Period;
  keep?: Record<string, string | undefined>;
}) {
  const kept = Object.entries(keep).filter((e): e is [string, string] => Boolean(e[1]));
  const hrefFor = (key: string) => {
    const params = new URLSearchParams(kept);
    params.set("period", key);
    if (key === "custom") {
      params.set("from", period.from);
      params.set("to", period.to);
    }
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="flex flex-col items-start gap-2 lg:items-end">
      <nav className="as-seg" aria-label="Reporting period">
        {PERIOD_OPTIONS.map((o) => (
          <Link key={o.key} href={hrefFor(o.key)} aria-current={o.key === period.key ? "true" : undefined} scroll={false}>
            {o.label}
          </Link>
        ))}
      </nav>
      {period.key === "custom" && (
        <Form action={basePath} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value="custom" />
          {kept.map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <label className="as-field">
            From
            <input type="date" name="from" defaultValue={period.from} className="as-input" required />
          </label>
          <label className="as-field">
            To
            <input type="date" name="to" defaultValue={period.to} className="as-input" required />
          </label>
          <button type="submit" className="as-btn">
            Apply
          </button>
        </Form>
      )}
    </div>
  );
}
