"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const SID_KEY = "fi_sid";

function sessionId(): string {
  try {
    let sid = localStorage.getItem(SID_KEY);
    if (!sid) {
      sid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(SID_KEY, sid);
    }
    return sid;
  } catch {
    return "anon";
  }
}

/**
 * Fires a lightweight first-party pageview beacon on each in-app navigation.
 * Identity/church are resolved server-side; this only sends the path + a
 * per-browser session id. Best-effort — failures are ignored.
 */
export function PageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    const body = JSON.stringify({ path: pathname, sid: sessionId() });
    try {
      const blob = new Blob([body], { type: "application/json" });
      if (!navigator.sendBeacon?.("/api/track", blob)) {
        void fetch("/api/track", {
          method: "POST",
          body,
          keepalive: true,
          headers: { "Content-Type": "application/json" },
        }).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, [pathname]);

  return null;
}
