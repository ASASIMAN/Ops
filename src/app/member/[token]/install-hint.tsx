"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type Mode = "ios" | "android" | null;

const noop = () => () => {};

function detectMode(): Mode {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone;
  if (standalone) return null;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return null;
}

export function InstallHint() {
  const mode = useSyncExternalStore(noop, detectMode, () => null);
  const [deferred, setDeferred] = useState<(Event & { prompt(): Promise<void> }) | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as Event & { prompt(): Promise<void> });
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!mode) return null;

  return (
    <div className="mt-4 rounded-2xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <p className="font-medium">Keep your card on your home screen</p>
      {mode === "ios" ? (
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Tap the <b>Share</b> button in Safari (the square with an arrow), then{" "}
          <b>Add to Home Screen</b>. Your ASASI card opens in one tap.
        </p>
      ) : deferred ? (
        <button
          onClick={() => deferred.prompt()}
          className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          Add to home screen
        </button>
      ) : (
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Open your browser menu (⋮) and choose <b>Add to Home screen</b>.
        </p>
      )}
    </div>
  );
}
