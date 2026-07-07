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

  // One-time bootstrap.
  useEffect(() => {
    if (!ENABLED || typeof window === "undefined") return;
    const w = window as unknown as { _paq?: unknown[] };
    if (w._paq) return; // already initialised
    const u = RAW_URL.endsWith("/") ? RAW_URL : `${RAW_URL}/`;
    const paq: unknown[] = (w._paq = []);
    paq.push(["enableLinkTracking"]);
    paq.push(["setTrackerUrl", `${u}matomo.php`]);
    paq.push(["setSiteId", SITE_ID]);
    const g = document.createElement("script");
    g.async = true;
    g.src = `${u}matomo.js`;
    document.head.appendChild(g);
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
