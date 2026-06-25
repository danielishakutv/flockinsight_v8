"use client";

import { useEffect, useState } from "react";
import { NotificationBell } from "@/components/notifications/notification-bell";

/** Bell that keeps its unread badge live by polling — no page refresh needed. */
export function LiveNotificationBell({
  initial = 0,
  className,
}: {
  initial?: number;
  className?: string;
}) {
  const [count, setCount] = useState(initial);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const r = await fetch("/api/notifications/unread", {
          cache: "no-store",
        });
        if (!r.ok) return;
        const d = await r.json();
        if (active && typeof d.count === "number") setCount(d.count);
      } catch {
        /* ignore transient errors */
      }
    }
    const id = setInterval(poll, 20_000);
    const onFocus = () => poll();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    poll();
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return <NotificationBell unread={count} className={className} />;
}
