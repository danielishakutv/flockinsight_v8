"use client";

import { useEffect, useState } from "react";

/**
 * Poll the church's form response counts so views update live (no reload).
 * Polls every `intervalMs`, pauses while the tab is hidden, and refreshes
 * immediately when the tab regains focus. Seeded with server-rendered counts
 * so the first paint is correct.
 */
export function useLiveCounts(
  initial: Record<string, number>,
  intervalMs = 5000,
): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>(initial);

  useEffect(() => {
    let active = true;

    async function poll() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/forms/counts", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { counts?: Record<string, number> };
        if (active && data?.counts) {
          // Merge so a form missing from the response keeps its seeded value.
          setCounts((prev) => ({ ...prev, ...data.counts }));
        }
      } catch {
        /* transient network error — try again next tick */
      }
    }

    const timer = setInterval(poll, intervalMs);
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    // Kick off one poll shortly after mount for a near-instant first update.
    const kick = setTimeout(poll, 1500);

    return () => {
      active = false;
      clearInterval(timer);
      clearTimeout(kick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [intervalMs]);

  return counts;
}

/** Live count for a single form, seeded with its server-rendered value. */
export function useLiveCount(id: string, initial: number, intervalMs = 5000): number {
  const counts = useLiveCounts({ [id]: initial }, intervalMs);
  return counts[id] ?? initial;
}
