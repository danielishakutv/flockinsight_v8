"use client";

import { useCallback, useSyncExternalStore } from "react";

/* ============================================================
 * Reading client-only facts without an effect.
 *
 * The usual `const [mounted, setMounted] = useState(false)` +
 * `useEffect(() => setMounted(true), [])` works, but it schedules a second
 * render for something React can tell us directly. `useSyncExternalStore`
 * returns the server answer during SSR and hydration, then the client answer —
 * which is exactly what "mounted" means, in one render fewer.
 * ========================================================== */

/** Nothing to subscribe to: the value only changes at hydration. */
const noSubscribe = () => () => {};

/** False during SSR and hydration, true once running on the client. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/* ------------------------------------------------------------------ *
 * localStorage, read reactively
 * ------------------------------------------------------------------ */

const listeners = new Set<() => void>();

function subscribeToStorage(onChange: () => void) {
  listeners.add(onChange);
  // `storage` only fires in *other* tabs; same-tab writes go through
  // `writeStoredValue` below, which notifies these listeners directly.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The value of a localStorage key. `null` during SSR, and if storage is blocked. */
export function useStoredValue(key: string): string | null {
  const read = useCallback(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null; // private mode / storage disabled
    }
  }, [key]);

  return useSyncExternalStore(subscribeToStorage, read, () => null);
}

/** Write a key and tell every reader in this tab about it. */
export function writeStoredValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled — nothing we can do, and nothing breaks */
  }
  for (const listener of listeners) listener();
}
