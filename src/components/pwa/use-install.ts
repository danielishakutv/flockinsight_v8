"use client";

import { useSyncExternalStore } from "react";
import {
  EMPTY_STATE,
  QUIET_MS,
  installRoute,
  parseState,
  recordDismissal,
  recordInstalled,
  recordVisit,
  shouldAskToInstall,
  type InstallRoute,
  type InstallState,
} from "@/lib/pwa-install";

/**
 * Whether to offer the app for install — shared by every surface that asks.
 *
 * Held in one module-level store rather than in each component's state, for
 * two reasons. The pop-up and the dashboard line must never disagree; a banner
 * reading "install the app" on a device that already has it is the sort of bug
 * nobody reports and everybody notices. And the visit counter is written on
 * mount, so per-component state would count one visit per surface and bring
 * the prompt forward every time a new one is added.
 *
 * Everything below the React boundary talks to localStorage and matchMedia
 * directly, which is what useSyncExternalStore is for: React subscribes to the
 * browser rather than mirroring it into state inside an effect.
 */

const KEY = "fi-install-v2";
const VISIT_KEY = "fi-install-visit";

export type InstallSnapshot = {
  /** Already running as an installed app. */
  standalone: boolean;
  route: InstallRoute;
  /** The pop-up is allowed to appear right now. */
  mayAsk: boolean;
  installed: boolean;
};

const SERVER: InstallSnapshot = {
  standalone: false,
  route: "unsupported",
  mayAsk: false,
  installed: false,
};

let snapshot: InstallSnapshot = SERVER;
let stored: InstallState = EMPTY_STATE;
let deferred: BIPEvent | null = null;
let started = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Replace the snapshot only on a real change — the hook compares by identity. */
function patch(next: Partial<InstallSnapshot>) {
  const merged = { ...snapshot, ...next };
  if (
    merged.standalone === snapshot.standalone &&
    merged.route === snapshot.route &&
    merged.mayAsk === snapshot.mayAsk &&
    merged.installed === snapshot.installed
  ) {
    return;
  }
  snapshot = merged;
  emit();
}

function persist(next: InstallState) {
  stored = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode — the cadence degrades to this session only, which is fine */
  }
}

function detectStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: fullscreen)").matches === true ||
    // iOS Safari predates the media query and still reports it this way.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function detectIOS(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;

  try {
    stored = parseState(localStorage.getItem(KEY));
  } catch {
    stored = EMPTY_STATE;
  }

  const standalone = detectStandalone();

  /*
   * Running inside the installed app is the only reliable proof of install we
   * get. `appinstalled` does not fire if they installed on another device, or
   * before this code shipped, so seeing standalone once is what records it.
   */
  if (standalone) {
    persist(recordInstalled(stored));
    patch({ standalone: true, installed: true, mayAsk: false });
    return;
  }

  // One visit per session, however many surfaces ask.
  try {
    if (!sessionStorage.getItem(VISIT_KEY)) {
      sessionStorage.setItem(VISIT_KEY, "1");
      persist(recordVisit(stored));
    }
  } catch {
    stored = recordVisit(stored);
  }

  patch({
    installed: stored.installed,
    route: installRoute({ hasDeferredPrompt: false, isIOS: detectIOS() }),
  });

  window.addEventListener("beforeinstallprompt", (e: Event) => {
    // Keep it for later — firing it on arrival is the pop-up behaviour this
    // whole module exists to avoid.
    e.preventDefault();
    deferred = e as BIPEvent;
    patch({ route: "prompt" });
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    persist(recordInstalled(stored));
    patch({ standalone: true, installed: true, mayAsk: false });
  });

  // Someone may install from the browser's own menu while the tab is open.
  window
    .matchMedia?.("(display-mode: standalone)")
    ?.addEventListener?.("change", (e) => {
      if (e.matches) {
        persist(recordInstalled(stored));
        patch({ standalone: true, installed: true, mayAsk: false });
      }
    });

  // The quiet delay: let someone get on with what they opened the app for.
  setTimeout(() => {
    if (shouldAskToInstall(stored, Date.now())) patch({ mayAsk: true });
  }, QUIET_MS);
}

export async function requestInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  if (!deferred) return "unavailable";
  try {
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === "accepted") persist(recordInstalled(stored));
    else persist(recordDismissal(stored, Date.now()));
    patch({ mayAsk: false, installed: outcome === "accepted" });
    return outcome;
  } catch {
    return "unavailable";
  }
}

export function dismissInstall() {
  persist(recordDismissal(stored, Date.now()));
  patch({ mayAsk: false });
}

function subscribe(cb: () => void) {
  start();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useInstall(): InstallSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER,
  );
}

export type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
