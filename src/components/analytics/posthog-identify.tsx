"use client";

import { useEffect } from "react";
import { loadPostHog } from "@/lib/posthog-lazy";

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
    if (typeof window === "undefined") return;
    // Resolves to null when PostHog is off, and downloads nothing.
    void loadPostHog().then((ph) => {
      if (!ph) return;
      ph.identify(userId, { plan, role });
      ph.group("church", churchId, { name: churchName, plan });
    });
    // Tie Matomo visits to the same user for cross-tool consistency.
    const paq = (window as unknown as { _paq?: unknown[] })._paq;
    if (paq) paq.push(["setUserId", userId]);
  }, [userId, churchId, churchName, plan, role]);

  return null;
}
