"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button for a server-action form: disables itself and shows what it
 * is doing while the action runs, so a slow save can't be double-submitted
 * and never looks like a dead button.
 */
export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  className = "as-btn",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} data-pending={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
