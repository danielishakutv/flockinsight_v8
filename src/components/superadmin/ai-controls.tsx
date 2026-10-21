"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AiFeature } from "@/db/schema";
import { saveAiLimitsAction, setKillSwitchAction } from "@/app/superadmin/ai/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const FEATURES: { key: AiFeature; label: string }[] = [
  { key: "analytics", label: "Analytics summaries" },
  { key: "chat", label: "Help assistant" },
  { key: "blog", label: "Blog drafting" },
];

/** The kill switch, the monthly ceilings, and pausing one feature. English-only. */
export function AiControls({
  killed,
  platformUsd,
  churchUsd,
  paused,
}: {
  killed: boolean;
  platformUsd: number;
  churchUsd: number;
  paused: AiFeature[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<null | boolean>(null);
  const [platform, setPlatform] = useState(String(platformUsd));
  const [share, setShare] = useState(String(churchUsd));
  const [pausedSet, setPausedSet] = useState<AiFeature[]>(paused);
  const [error, setError] = useState<string | null>(null);

  function applyKill(on: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setKillSwitchAction({ on });
      if (res.ok) {
        toast.success(on ? "Every AI feature is stopped." : "AI features resumed.");
        setConfirm(null);
        router.refresh();
      } else {
        setError(res.error);
        toast.error(res.error);
      }
    });
  }

  function saveLimits() {
    setError(null);
    const p = Number(platform);
    const c = Number(share);
    if (!Number.isFinite(p) || !Number.isFinite(c)) {
      setError("Both ceilings must be numbers, in US dollars.");
      return;
    }
    startTransition(async () => {
      const res = await saveAiLimitsAction({ platformUsd: p, churchUsd: c, paused: pausedSet });
      if (res.ok) {
        toast.success("AI limits saved.");
        router.refresh();
      } else {
        setError(res.error);
        toast.error(res.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="ai-kill" className="font-semibold">
              Kill switch
            </Label>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Stops every new AI call on the next request. A call already in flight finishes within its timeout
              (60 s for analytics and chat, up to 3 minutes for blog).
            </p>
          </div>
          <Switch id="ai-kill" checked={killed} disabled={pending} onCheckedChange={(on) => setConfirm(on)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ai-platform-usd">Platform ceiling per month (USD)</Label>
            <Input
              id="ai-platform-usd"
              type="number"
              inputMode="decimal"
              min={0}
              max={20}
              step="0.01"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">At most $20. The $20 hard stop is set in code.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ai-church-usd">Each church&apos;s share per month (USD)</Label>
            <Input
              id="ai-church-usd"
              type="number"
              inputMode="decimal"
              min={0}
              max={5}
              step="0.01"
              value={share}
              onChange={(e) => setShare(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">At most $5.</p>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Pause a single feature</legend>
          {FEATURES.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={pausedSet.includes(f.key)}
                onChange={(e) =>
                  setPausedSet((s) => (e.target.checked ? [...s, f.key] : s.filter((x) => x !== f.key)))
                }
              />
              {f.label}
            </label>
          ))}
        </fieldset>

        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        <Button onClick={saveLimits} disabled={pending} className="w-full sm:w-auto">
          Save limits
        </Button>
      </CardContent>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && !pending && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm ? "Stop every AI feature?" : "Resume AI features?"}</DialogTitle>
            <DialogDescription>
              {confirm
                ? "New AI calls are refused from the next request, for every church and the platform. Calls already in flight finish within their timeout: 60 s for analytics and chat, up to 3 minutes for blog."
                : "AI calls are allowed again, within the monthly ceilings and each church's own consent."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={confirm ? "destructive" : "default"}
              onClick={() => confirm !== null && applyKill(confirm)}
              disabled={pending}
            >
              {confirm ? "Stop AI" : "Resume AI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
