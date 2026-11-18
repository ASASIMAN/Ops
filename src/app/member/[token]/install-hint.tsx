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
    <div className="border border-line bg-surface p-4 text-sm">
      <p className="text-[0.6875rem] font-medium uppercase tracking-[0.18em]">Keep your card on your home screen</p>
      {mode === "ios" ? (
        <p className="mt-2 text-muted">
          Tap the <b>Share</b> button in Safari (the square with an arrow), then{" "}
          <b>Add to Home Screen</b>. Your ASASI card opens in one tap.
        </p>
      ) : deferred ? (
        <button onClick={() => deferred.prompt()} className="as-btn mt-3">
          Add to home screen
        </button>
      ) : (
        <p className="mt-2 text-muted">
          Open your browser menu (⋮) and choose <b>Add to Home screen</b>.
        </p>
      )}
    </div>
  );
}
