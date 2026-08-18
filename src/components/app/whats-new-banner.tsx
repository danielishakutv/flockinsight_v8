"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { useStoredValue, writeStoredValue } from "@/lib/client-state";

const KEY = "fi_seen_version";

/**
 * A dismissible "there's a new update" banner. Shows once after a deploy bumps
 * the app version — compared against the last version this browser acknowledged.
 * Brand-new users (no stored version) are not nagged. No DB, no network.
 */
export function WhatsNewBanner() {
  const seen = useStoredValue(KEY);

  // First visit on this device: record the version silently rather than
  // greeting a brand-new user with "there's an update".
  useEffect(() => {
    if (seen === null) writeStoredValue(KEY, APP_VERSION);
  }, [seen]);

  function dismiss() {
    writeStoredValue(KEY, APP_VERSION);
  }

  // `null` means either SSR or a first visit — neither should show the banner.
  if (seen === null || seen === APP_VERSION) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 lg:px-8">
      <div className="border-primary/30 from-primary/10 flex items-center gap-3 rounded-2xl border bg-gradient-to-r to-transparent px-4 py-3">
        <div className="bg-primary/15 text-primary grid size-9 shrink-0 place-items-center rounded-xl">
          <Sparkles className="size-5" />
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">FlockInsight just got an update. </span>
          <span className="text-muted-foreground">
            Branches for churches that run several campuses, and a search box
            in every long dropdown.
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
