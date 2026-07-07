"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { APP_VERSION } from "@/lib/version";

const KEY = "fi_seen_version";

/**
 * A dismissible "there's a new update" banner. Shows once after a deploy bumps
 * the app version — compared against the last version this browser acknowledged.
 * Brand-new users (no stored version) are not nagged. No DB, no network.
 */
export function WhatsNewBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(KEY);
      if (!seen) {
        // First visit on this device — record silently, don't nag.
        localStorage.setItem(KEY, APP_VERSION);
        return;
      }
      if (seen !== APP_VERSION) setShow(true);
    } catch {
      /* localStorage unavailable — skip */
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(KEY, APP_VERSION);
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 lg:px-8">
      <div className="border-primary/30 from-primary/10 flex items-center gap-3 rounded-2xl border bg-gradient-to-r to-transparent px-4 py-3">
        <div className="bg-primary/15 text-primary grid size-9 shrink-0 place-items-center rounded-xl">
          <Sparkles className="size-5" />
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">FlockInsight just got an update. </span>
          <span className="text-muted-foreground">
            Member self-registration, first-timer follow-up, a Celebrations page &amp;
            more.
          </span>{" "}
          <Link
            href="/changelog"
            onClick={dismiss}
            className="text-primary font-semibold underline whitespace-nowrap"
          >
            See what&apos;s new
          </Link>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
