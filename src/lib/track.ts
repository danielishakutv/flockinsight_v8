import { peekPostHog } from "@/lib/posthog-lazy";

/**
 * Client-side action tracking. Fires a named event to PostHog and Matomo (both
 * optional / env-gated — no-ops if neither is loaded). Use at success points in
 * client components, e.g. track("member.added"). First-party analytics are
 * captured separately, server-side, via recordAction() in lib/analytics.ts.
 */
export function track(name: string, props?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    // Only if PostHog is already up — tracking an action must never be the
    // thing that triggers a several-hundred-kilobyte download.
    peekPostHog()?.capture(name, props);
  } catch {
    /* ignore */
  }
  try {
    const paq = (window as unknown as { _paq?: unknown[] })._paq;
    if (paq) {
      const label = props && "label" in props ? String(props.label) : undefined;
      const value =
        props && typeof props.value === "number" ? props.value : undefined;
      paq.push(["trackEvent", "app", name, label, value]);
    }
  } catch {
    /* ignore */
  }
}
