"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

/**
 * Ties PostHog events to the signed-in user and their church, so behaviour can
 * be segmented per church/plan (PostHog "group analytics"). No personal names/
 * emails are sent — only ids and non-PII attributes. Inert without a key.
 */
export function PostHogIdentify({
  userId,
  churchId,
  churchName,
  plan,
  role,
}: {
  userId: string;
  churchId: string;
  churchName: string;
  plan: string;
  role: string;
}) {
  useEffect(() => {
    if (!KEY || typeof window === "undefined") return;
    // Only identify once posthog.init has run (set by the provider).
    if (!(posthog as unknown as { __loaded?: boolean }).__loaded) return;
    posthog.identify(userId, { plan, role });
    posthog.group("church", churchId, { name: churchName, plan });
  }, [userId, churchId, churchName, plan, role]);

  return null;
}
