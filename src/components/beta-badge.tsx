"use client";

import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

/**
 * "Beta" — said plainly, wherever the feature is.
 *
 * Not a tiny grey whisper. Somebody is about to run a service, a board meeting
 * or a counselling session through this, and they are entitled to know it is
 * newer than the rest of the platform before they do — in the menu, on the
 * module's own page, and inside the room where the people who never saw the
 * menu are. The `title` carries the sentence; the pill carries the word.
 *
 * `inline` is for sitting beside a heading, `dark` for the meeting room and the
 * join screen, which are white-on-near-black whatever the church's theme is.
 */
export function BetaBadge({
  className,
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  const t = useT();
  return (
    <span
      title={t("common.betaNote")}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide uppercase",
        tone === "dark"
          ? "bg-amber-400/20 text-amber-300 ring-1 ring-amber-300/30"
          : "bg-amber-500/15 text-amber-700 ring-1 ring-amber-600/25 dark:text-amber-400 dark:ring-amber-400/30",
        className,
      )}
    >
      {t("common.beta")}
    </span>
  );
}
