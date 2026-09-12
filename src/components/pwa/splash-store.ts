"use client";

/**
 * The splash's lifecycle, kept outside React.
 *
 * It is a two-second timeline driven by the browser, not by rendering: decide
 * once on launch, hold, fade, done. Mirroring that into component state means
 * setting state in an effect on mount, which is the cascading-render pattern
 * the lint rule exists to prevent — and the timers would have to be torn down
 * and rebuilt on every remount, which a route change would do.
 */

export type SplashPhase = "hidden" | "showing" | "leaving";

/** How long the logo holds before it starts to fade. */
export const HOLD_MS = 2000;
/** And how long the fade itself takes. */
export const FADE_MS = 420;

const SHOWN_KEY = "fi-splash-shown";

let phase: SplashPhase = "hidden";
let started = false;
const listeners = new Set<() => void>();

function set(next: SplashPhase) {
  if (phase === next) return;
  phase = next;
  for (const l of listeners) l();
}

function shouldShow(): boolean {
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: fullscreen)").matches === true ||
    // iOS Safari predates the media query and still reports it this way.
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  // In a browser tab the page is the page. Covering someone's own dashboard
  // for two seconds would be an interstitial, not a splash.
  if (!standalone) return false;

  try {
    if (sessionStorage.getItem(SHOWN_KEY)) return false;
    sessionStorage.setItem(SHOWN_KEY, "1");
  } catch {
    // Private mode can throw on either call. Showing the splash once more than
    // intended is a much smaller problem than not rendering the app.
  }
  return true;
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (!shouldShow()) return;

  set("showing");
  setTimeout(() => set("leaving"), HOLD_MS);
  setTimeout(() => set("hidden"), HOLD_MS + FADE_MS);
}

export function subscribeSplash(cb: () => void) {
  start();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getSplashPhase(): SplashPhase {
  return phase;
}

/** Never on the server: the markup would flash before hydration decides. */
export function getServerSplashPhase(): SplashPhase {
  return "hidden";
}
