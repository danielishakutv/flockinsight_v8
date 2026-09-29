"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  sendNudgesNow,
  setNudgesEnabled,
} from "@/app/superadmin/activation-actions";
import type { NudgePlan } from "@/lib/activation-nudges";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

/**
 * What would go out, and the two controls that decide whether it does.
 *
 * The plan is shown before the switch on purpose. Turning automated mail on for
 * nine churches is not a settings change, it is a decision about nine real
 * people, and the only way to make it properly is to read the list first.
 */
export function NudgeControls({
  planned,
  enabled,
  suppressedRecent,
}: {
  planned: NudgePlan[];
  enabled: boolean;
  suppressedRecent: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(enabled);

  const toggle = (next: boolean) =>
    start(async () => {
      setOn(next);
      const res = await setNudgesEnabled(next);
      if (!res.ok) {
        setOn(!next);
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });

  const sendNow = () =>
    start(async () => {
      const res = await sendNudgesNow();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });

  return (
    <div className="mt-4 rounded-xl border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold">
            {planned.length === 0
              ? "Nothing due to send"
              : `${planned.length} ${planned.length === 1 ? "church is" : "churches are"} due a message`}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            {on
              ? "Automation is on — the daily run sends these."
              : "Automation is off. Nothing goes out until you turn it on or send by hand."}
            {suppressedRecent > 0 &&
              ` ${suppressedRecent} held back — messaged in the last few days.`}
          </p>
        </div>

        <label className="flex shrink-0 items-center gap-2 text-xs font-semibold">
          <Switch
            checked={on}
            disabled={pending}
            onCheckedChange={toggle}
            aria-label="Send activation emails automatically"
          />
          Automatic
        </label>
      </div>

      {planned.length > 0 && (
        <>
          <ul className="mt-3 space-y-1.5">
            {planned.map((p) => (
              <li
                key={p.churchId}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
              >
                <span className="bg-muted rounded px-1.5 py-0.5 font-bold">
                  Step {p.stage}
                </span>
                <span className="truncate font-semibold">{p.churchName}</span>
                <span className="text-muted-foreground wrap-anywhere">
                  {p.subject}
                </span>
              </li>
            ))}
          </ul>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={pending}
            onClick={sendNow}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            Send these now
          </Button>
        </>
      )}
    </div>
  );
}
