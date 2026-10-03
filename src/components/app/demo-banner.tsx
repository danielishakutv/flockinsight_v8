"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { requestDemoCode } from "@/app/(app)/demo-actions";
import { DEMO_RESET_HOURS } from "@/lib/demo-shared";
import { Button } from "@/components/ui/button";

/**
 * The band across the top of the demonstration church.
 *
 * Unmissable on purpose. Somebody evaluating the product has to know at every
 * moment that these are not real people and nothing they do here matters —
 * and somebody who has arrived here by accident, from a link in a WhatsApp
 * group, has to know their own church is somewhere else entirely.
 *
 * It also carries the countdown. An unverified visitor has fifteen minutes,
 * and finding that out when the door shuts is the wrong way to learn it.
 */
/** Whole minutes from now until `iso`, never negative. */
function minutesUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 60_000));
}

export function DemoBanner({
  expiresAt,
  verified,
}: {
  /** When the unverified visit runs out. Null once verified. */
  expiresAt: string | null;
  verified: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Derived from the server's deadline, not stored as a count. A tab left open
  // over lunch then shows the truth instead of whatever it last decremented to.
  const [left, setLeft] = useState(() => minutesUntil(expiresAt));

  /*
   * The tick is cosmetic — what actually closes the door is the layout
   * refusing to render on the next request. So on reaching zero this asks for
   * a fresh render rather than deciding anything itself.
   */
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => {
      const next = minutesUntil(expiresAt);
      setLeft(next);
      if (next !== null && next <= 0) router.refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [expiresAt, router]);

  function askForCode() {
    start(async () => {
      const res = await requestDemoCode();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Code sent to ${res.masked}. Enter it when we ask, and the clock stops.`,
      );
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-500 px-3 py-2 text-center text-sm font-semibold text-amber-950">
      <span className="inline-flex items-center gap-1.5">
        <FlaskConical className="size-4 shrink-0" />
        <span className="rounded bg-amber-950/15 px-1.5 py-0.5 text-xs font-extrabold tracking-wider uppercase">
          Demo
        </span>
        Nothing here is real — everything resets every {DEMO_RESET_HOURS} hours.
      </span>
      {!verified && left !== null && (
        <span className="inline-flex items-center gap-1.5 font-bold">
          <Clock className="size-4 shrink-0" />
          {left} {left === 1 ? "minute" : "minutes"} left
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-amber-950 underline"
            onClick={askForCode}
            disabled={pending}
          >
            {pending && <Loader2 className="size-3 animate-spin" />}
            Confirm your email to keep going
          </Button>
        </span>
      )}
    </div>
  );
}
