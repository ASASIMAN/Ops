"use client";

/**
 * A date filter input that opens the browser's date picker on any click
 * inside the field, not just its small calendar icon. `showPicker()` is a
 * standard input method (Chrome/Edge/Safari; Firefox 99+) - this is
 * additive, so a browser without it just falls back to the native
 * click-the-icon behaviour rather than breaking.
 */
export function DateField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        type="date"
        name={name}
        defaultValue={defaultValue}
        onClick={(e) => e.currentTarget.showPicker?.()}
        className="cursor-pointer rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-transparent"
      />
    </label>
  );
}
