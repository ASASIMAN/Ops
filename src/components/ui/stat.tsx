import Link from "next/link";
import { changeText, type Change } from "@/lib/biz/format";

/**
 * One headline number. `value: null` renders an explicit "No data" - a tile
 * never shows a zero or a dash it can't stand behind; `note` says why.
 * With `href` the whole tile links to the report behind the number.
 */
export function Stat({
  label,
  tag,
  value,
  change,
  compareLabel,
  note,
  href,
  invert = false,
}: {
  label: string;
  /** Small qualifier at the top right, e.g. the channel or the month a figure is for. */
  tag?: string;
  value: string | null;
  change?: Change;
  compareLabel?: string;
  note?: string;
  href?: string;
  /** For figures where up is the bad direction (returns, discounts). */
  invert?: boolean;
}) {
  const text = change ? changeText(change) : null;
  const good = change?.direction === (invert ? "down" : "up");
  const bad = change?.direction === (invert ? "up" : "down");
  const body = (
    <>
      <div className="as-stat-label">
        <span>{label}</span>
        {tag && <span className="font-normal tracking-[0.08em] text-faint">{tag}</span>}
      </div>
      <div
        className="as-stat-value"
        data-empty={value === null}
        style={value !== null ? ({ "--chars": value.length } as React.CSSProperties) : undefined}
      >
        {value ?? "No data"}
      </div>
      <div className="as-stat-foot">
        {text && (
          <>
            <span className={good ? "as-up" : bad ? "as-down" : undefined}>{text}</span>{" "}
          </>
        )}
        {text && compareLabel}
        {note && <span className={text ? "block" : undefined}>{note}</span>}
      </div>
    </>
  );
  return href ? (
    <Link href={href} className="as-stat">
      {body}
    </Link>
  ) : (
    <div className="as-stat">{body}</div>
  );
}
