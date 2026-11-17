"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// BarcodeDetector isn't in the TS DOM lib yet.
type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

export function Scanner() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("Starting camera…");
  const [code, setCode] = useState("");

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let done = false;

    (async () => {
      const Ctor = (window as unknown as { BarcodeDetector?: new (o: object) => Detector }).BarcodeDetector;
      if (!Ctor) return setStatus("Camera scanning isn't supported in this browser - type the code below, or scan with your phone's normal camera app.");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        setStatus("Point the camera at the member's QR code.");
        const detector = new Ctor({ formats: ["qr_code"] });
        const tick = async () => {
          if (done || !video.current) return;
          try {
            const hit = (await detector.detect(video.current))[0]?.rawValue;
            const m = hit?.match(/\/v\/([A-Za-z0-9-]+)/);
            if (m) { done = true; router.push(`/v/${m[1]}`); return; }
          } catch { /* frame not ready */ }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      } catch {
        setStatus("Couldn't open the camera - check permissions, or type the code below.");
      }
    })();

    return () => {
      done = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [router]);

  return (
    <div className="mt-4">
      <video ref={video} playsInline muted className="aspect-square w-full rounded-lg bg-zinc-900 object-cover" />
      <p className="mt-2 text-sm text-zinc-500">{status}</p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (c) router.push(`/v/${c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c}`);
        }}
      >
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Member code"
          className="flex-1 rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-transparent" />
        <button className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white dark:bg-zinc-50 dark:text-zinc-900">Open</button>
      </form>
    </div>
  );
}
