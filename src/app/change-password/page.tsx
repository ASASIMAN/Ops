import { changePasswordAction } from "./actions";

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight">
          Set a new password
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          This account needs a password change before continuing.
        </p>

        <form action={changePasswordAction} className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            New password
            <input
              type="password"
              name="password"
              required
              minLength={8}
              className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Confirm password
            <input
              type="password"
              name="confirm"
              required
              minLength={8}
              className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            className="mt-2 rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900"
          >
            Set password
          </button>
        </form>
      </div>
    </div>
  );
}
