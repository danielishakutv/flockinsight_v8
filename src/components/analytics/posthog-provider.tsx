"use client";

import { useEffect } from "react";
import { loadPostHog, posthogEnabled } from "@/lib/posthog-lazy";

/**
 * Starts PostHog, if it is configured at all.
 *
 * Renders nothing and wraps nothing. It used to wrap the whole tree in
 * PostHog's own provider, which meant `posthog-js` was imported statically and
 * shipped to every visitor — including the marketing pages, where it was
 * initialised only to discover there was no key. Nothing in the app uses
 * PostHog's React hooks, so the wrapper bought us nothing and cost everyone a
 * large download.
 *
 * The load is deferred to idle so it never competes with first paint on a slow
 * connection.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!posthogEnabled || typeof window === "undefined") return;

    let cancelled = false;
    const start = () => {
      if (!cancelled) void loadPostHog();
    };

    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    const handle = ric ? ric(start, { timeout: 5000 }) : window.setTimeout(start, 3000);

    return () => {
      cancelled = true;
      const cic = (
        window as unknown as { cancelIdleCallback?: (h: number) => void }
      ).cancelIdleCallback;
      if (ric && cic) cic(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  return <>{children}</>;
}
