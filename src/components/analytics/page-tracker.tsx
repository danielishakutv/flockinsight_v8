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
        }).catch((e: unknown) => {
          // One lost page view. Recorded at debug rather than as an error: this
          // fails routinely offline or on a flaky connection, and a page view is
          // not worth shouting about — but a systematic failure should still be
          // findable rather than invisible.
          console.debug("analytics: page view not recorded", e);
        });
      }
    } catch (e) {
      // Blob or sendBeacon unavailable. Nothing to retry, but not nothing to say.
      console.debug("analytics: could not queue the page view", e);
    }
  }, [pathname]);

  return null;
}
