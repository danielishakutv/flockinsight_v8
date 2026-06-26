"use client";

import { useEffect } from "react";

/** True if an error looks like a failed JS chunk load (stale build after deploy). */
function isChunkError(text: string | undefined | null): boolean {
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to load chunk|error loading dynamically imported module|importing a module script failed/i.test(
    text || "",
  );
}

/**
 * Registers the service worker (production only — it would fight HMR in dev).
 * Enables offline support, fast asset caching and web-push delivery.
 */
export function ServiceWorkerRegister() {
  // Auto-recover from stale chunks after a deploy: if a JS chunk fails to load
  // (the page references files from an older build), reload once to fetch the
  // new build. Throttled so a genuinely broken asset can't loop forever.
  useEffect(() => {
    const reloadOnce = () => {
      try {
        const key = "fi-chunk-reload-at";
        const last = Number(sessionStorage.getItem(key) || 0);
        if (Date.now() - last < 15000) return;
        sessionStorage.setItem(key, String(Date.now()));
      } catch {
        /* sessionStorage may be unavailable */
      }
      window.location.reload();
    };
    const onError = (e: ErrorEvent) => {
      if (isChunkError(e.message) || isChunkError((e.error as Error)?.name)) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { name?: string; message?: string } | undefined;
      if (isChunkError(r?.name) || isChunkError(r?.message)) reloadOnce();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          /* registration failures are non-fatal */
        });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
