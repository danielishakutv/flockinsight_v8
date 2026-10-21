"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/components/i18n-provider";
import { setChurchAiAction } from "@/app/(app)/settings/ai/actions";

type Props = {
  enabled: boolean;
  /** "Turned on by … on …", already formatted on the server. */
  enabledLine: string | null;
  configured: boolean;
  isDemo: boolean;
  isActingAs: boolean;
  onPlan: boolean;
  monthCount: number;
};

/**
 * The owner's switch. Turning it ON asks first (the dialog portals to body,
 * so no blurred parent can trap it); turning it OFF happens at once, because
 * withdrawing consent must never be harder than giving it.
 */
export function AiSettings({ enabled, enabledLine, configured, isDemo, isActingAs, onPlan, monthCount }: Props) {
  const t = useT();
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Off is always allowed; on needs the plan.
  const locked = isDemo || isActingAs;
  const canTurnOn = !locked && onPlan;

  function save(next: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setChurchAiAction({ enabled: next });
      if (res.ok) {
        setOn(next);
        setConfirming(false);
        router.refresh();
      } else {
        // Translated where the cause is known; the plan refusal stays as sent.
        const msg = res.code ? t(`ai.${res.code}`) : res.error;
        setError(msg);
        toast.error(msg);
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="bg-card rounded-2xl border p-4">
        <div className="flex items-start justify-between gap-4">
          <label htmlFor="ai-summaries-switch" className="min-w-0">
            <span className="block font-semibold">{t("ai.toggle")}</span>
            {on && enabledLine && <span className="text-muted-foreground mt-0.5 block text-sm">{enabledLine}</span>}
          </label>
          <Switch
            id="ai-summaries-switch"
            checked={on}
            disabled={pending || locked || (!on && !canTurnOn)}
            onCheckedChange={(next) => (next ? setConfirming(true) : save(false))}
          />
        </div>
        {isDemo && <p className="text-muted-foreground mt-2 text-sm">{t("ai.demoOff")}</p>}
        {!isDemo && isActingAs && <p className="text-muted-foreground mt-2 text-sm">{t("ai.actingAs")}</p>}
        {on && !configured && <p className="text-muted-foreground mt-2 text-sm">{t("ai.dormantNote")}</p>}
        {error && (
          <p className="text-destructive mt-2 text-sm" role="alert">
            {error}
          </p>
        )}
        <p className="text-muted-foreground mt-3 text-xs">{t("ai.usage", { count: monthCount })}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="bg-card rounded-2xl border p-4">
          <p className="font-semibold">{t("ai.whatIsSent")}</p>
          <p className="text-muted-foreground mt-1 text-sm">{t("ai.whatIsSentBody")}</p>
        </div>
        <div className="bg-card rounded-2xl border p-4">
          <p className="font-semibold">{t("ai.neverSent")}</p>
          <p className="text-muted-foreground mt-1 text-sm">{t("ai.neverSentBody")}</p>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={(o) => !pending && setConfirming(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai.confirmOn")}</DialogTitle>
            <DialogDescription>{t("ai.confirmOnBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
              {t("ai.cancel")}
            </Button>
            <Button onClick={() => save(true)} disabled={pending} aria-busy={pending}>
              {t("ai.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
