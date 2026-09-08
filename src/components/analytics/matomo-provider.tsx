"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Matomo instance. Defaults to the church's shared instance, overridable by env.
const RAW_URL = process.env.NEXT_PUBLIC_MATOMO_URL || "https://analytics.aictig.org/";
const SITE_ID = process.env.NEXT_PUBLIC_MATOMO_SITE_ID || "6";
const ENABLED = !!RAW_URL && !!SITE_ID;

/**
 * Loads Matomo and tracks SPA navigations. Custom action events are sent via
 * lib/track.ts (which pushes to window._paq). Inert if the env is cleared.
 */
export function MatomoProvider() {
  const pathname = usePathname();

  /**
   * One-time bootstrap, deliberately deferred.
   *
   * matomo.js is ~22KB and was being fetched while the page was still
   * painting. On a 400kbps connection — which is what a lot of our churches
   * actually have — that is roughly half a second of the visitor's bandwidth
   * spent on analytics before they have seen anything. The queue (`_paq`) is
   * set up immediately so nothing tracked in the meantime is lost; only the
   * download waits for the browser to be idle.
   */
  useEffect(() => {
    if (!ENABLED || typeof window === "undefined") return;
    const w = window as unknown as { _paq?: unknown[] };
    if (w._paq) return; // already initialised
    const u = RAW_URL.endsWith("/") ? RAW_URL : `${RAW_URL}/`;
    const paq: unknown[] = (w._paq = []);
    paq.push(["enableLinkTracking"]);
    paq.push(["setTrackerUrl", `${u}matomo.php`]);
    paq.push(["setSiteId", SITE_ID]);

    let cancelled = false;
    const load = () => {
      if (cancelled || document.getElementById("matomo-js")) return;
      const g = document.createElement("script");
      g.id = "matomo-js";
      g.async = true;
      g.src = `${u}matomo.js`;
      document.head.appendChild(g);
    };

    // requestIdleCallback where it exists (not Safari), a timeout elsewhere.
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    const handle = ric
      ? ric(load, { timeout: 5000 })
      : window.setTimeout(load, 3000);

    return () => {
      cancelled = true;
      const cic = (
        window as unknown as { cancelIdleCallback?: (h: number) => void }
      ).cancelIdleCallback;
      if (ric && cic) cic(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  // Track each in-app navigation (SPA pageview).
  useEffect(() => {
    if (!ENABLED || typeof window === "undefined") return;
    const w = window as unknown as { _paq?: unknown[] };
    if (!w._paq) return;
    w._paq.push(["setCustomUrl", window.location.href]);
    w._paq.push(["setDocumentTitle", document.title]);
    w._paq.push(["trackPageView"]);
  }, [pathname]);

  return null;
}
