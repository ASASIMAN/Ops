import { createAdminAction } from "./actions";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight">
          Create the admin account
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          One-time setup. Needs the SETUP_SECRET from the Vercel environment
          variables. Refuses to run again once an admin exists.
        </p>

        <form action={createAdminAction} className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Setup key
            <input
              type="password"
              name="setupKey"
              required
              className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Admin email
            <input
              type="email"
              name="email"
              required
              className="rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700 dark:bg-transparent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              type="password"
              name="password"
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
            Create admin
          </button>
        </form>
      </div>
    </div>
  );
}
