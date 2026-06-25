"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bell, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  isPushSubscribed,
  pushSupported,
  subscribeToPush,
} from "@/lib/push-client";
import { Button } from "@/components/ui/button";

export type Notice = {
  id: string;
  title: string;
  body: string;
  cta?: { label: string; href: string };
};

const KEY = "fi-dismissed-notices";

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function SetupNotices({ notices = [] }: { notices?: Notice[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showPush, setShowPush] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDismissed(loadDismissed());
    (async () => {
      if (pushSupported() && !(await isPushSubscribed())) setShowPush(true);
      setReady(true);
    })();
  }, []);

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
    if (id === "push") setShowPush(false);
  }

  async function enablePush() {
    setEnabling(true);
    const res = await subscribeToPush();
    setEnabling(false);
    if (!res.ok) {
      toast.error(res.error || "Could not enable notifications.");
      return;
    }
    toast.success("Push notifications enabled on this device.");
    setShowPush(false);
  }

  if (!ready) return null;

  const visible = notices.filter((n) => !dismissed.has(n.id));
  const pushVisible = showPush && !dismissed.has("push");
  if (visible.length === 0 && !pushVisible) return null;

  return (
    <div className="mb-4 space-y-2">
      {pushVisible && (
        <div className="from-primary/10 flex items-start gap-3 rounded-2xl border bg-gradient-to-r to-violet-500/10 p-3 sm:p-4">
          <div className="bg-primary/15 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
            <Bell className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold">Enable notifications for your church</p>
            <p className="text-muted-foreground text-sm">
              Get push alerts for announcements and updates on this device.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={enablePush} disabled={enabling}>
                {enabling ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Bell className="size-4" />
                )}
                Enable
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dismiss("push")}>
                Not now
              </Button>
            </div>
          </div>
          <button
            onClick={() => dismiss("push")}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground p-1"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {visible.map((n) => (
        <div
          key={n.id}
          className="bg-card flex items-start gap-3 rounded-2xl border p-3 shadow-sm sm:p-4"
        >
          <div className="min-w-0 flex-1">
            <p className="font-bold">{n.title}</p>
            <p className="text-muted-foreground text-sm">{n.body}</p>
            {n.cta && (
              <Button asChild size="sm" variant="outline" className="mt-2">
                <Link href={n.cta.href}>
                  {n.cta.label} <ArrowRight className="size-4" />
                </Link>
              </Button>
            )}
          </div>
          <button
            onClick={() => dismiss(n.id)}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground p-1"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
