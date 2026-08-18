"use client";

import { useSyncExternalStore } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/** The clock only needs to be right to the minute; check four times a minute. */
const TICK_MS = 15_000;

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, TICK_MS);
  return () => clearInterval(timer);
}

/**
 * The current time, bucketed to the tick. Returning a number (rather than a
 * fresh Date) keeps the snapshot stable between ticks, which is what
 * useSyncExternalStore needs to avoid re-rendering on every check.
 */
const getBucket = () => Math.floor(Date.now() / TICK_MS);

/** Live local date + time. Renders a placeholder until hydrated (avoids drift). */
export function DateTime({ className }: { className?: string }) {
  const bucket = useSyncExternalStore(subscribe, getBucket, () => null);
  if (bucket === null) return <div className="h-5" aria-hidden />;

  const now = new Date(bucket * TICK_MS);
  const date = now.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const time = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Clock className="text-muted-foreground size-4 shrink-0" />
      <span className="text-sm font-semibold">
        {date}
        <span className="text-muted-foreground font-normal"> · {time}</span>
      </span>
    </div>
  );
}
