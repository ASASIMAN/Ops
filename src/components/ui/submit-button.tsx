"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button for a server-action form: disabled while the action runs so
 * a slow save can't be sent twice, and visibly busy so it never looks like a
 * dead button. Keeps its own label unless `pendingLabel` is given. Any other
 * button attribute (name/value, formAction, ...) passes straight through.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className = "as-btn",
  disabled,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  pendingLabel?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      {...rest}
      type="submit"
      className={className}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
