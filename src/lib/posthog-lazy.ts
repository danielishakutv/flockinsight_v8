/**
 * Lazy access to posthog-js.
 *
 * `import posthog from "posthog-js"` at the top of a module puts the whole
 * library — a large one — into the bundle for every page that module reaches,
 * whether or not PostHog is switched on. It was reaching the root layout, so
 * every visitor to the marketing site downloaded an analytics SDK that then
 * did nothing, because the key is env-gated and usually unset.
 *
 * Importing it inside a function instead moves it to its own chunk, which is
 * fetched only when there is a key to use it with — and then after the page
 * has painted, rather than competing with it.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

export const posthogEnabled = !!KEY;

type PostHog = typeof import("posthog-js").default;

let loading: Promise<PostHog | null> | null = null;

/**
 * The initialised client, or null when PostHog is off. Safe to call from
 * anywhere and as often as you like — it loads and initialises once.
 */
export function loadPostHog(): Promise<PostHog | null> {
  if (!KEY || typeof window === "undefined") return Promise.resolve(null);
  if (loading) return loading;

  loading = import("posthog-js")
    .then((mod) => {
      const ph = mod.default;
      // Guard against a second init across hot reloads.
      if (!(ph as unknown as { __loaded?: boolean }).__loaded) {
        ph.init(KEY, {
          api_host: HOST,
          capture_pageview: true,
          capture_pageleave: true,
          autocapture: true,
          // Only build person profiles for signed-in users.
          person_profiles: "identified_only",
          session_recording: {
            maskAllInputs: true,
            maskTextSelector: "[data-ph-mask]",
          },
        });
      }
      return ph;
    })
    .catch(() => null);

  return loading;
}

/** Already-loaded client, or null. For code that must not trigger a download. */
export function peekPostHog(): PostHog | null {
  if (!KEY || typeof window === "undefined") return null;
  const w = window as unknown as { posthog?: PostHog };
  const ph = w.posthog;
  return ph && (ph as unknown as { __loaded?: boolean }).__loaded ? ph : null;
}
