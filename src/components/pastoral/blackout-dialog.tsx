"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { addClosure } from "@/app/(app)/appointments/actions";
import { CLOSURE_KINDS, type PastorClosureKind } from "@/lib/pastoral-shared";
import { wallInputToIso } from "@/lib/pastoral-slots";

/**
 * Days away: leave, travel, a conference. Whole days (the usual case) or a
 * stretch of one day. Times are the church's wall clock. Appointments already
 * in that time are counted and left alone; the pastor decides what to do.
 */
export function BlackoutDialog({
  pastorId,
  zone,
  today,
  open,
  onOpenChange,
}: {
  pastorId: string;
  zone: string;
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<PastorClosureKind>("leave");
  const [reason, setReason] = useState("");
  const [whole, setWhole] = useState(true);
  const [fromDay, setFromDay] = useState(today);
  const [toDay, setToDay] = useState(today);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await addClosure(
          pastorId,
          whole
            ? { kind, reason, fromDay, toDay }
            : { kind, reason, startsAt: wallInputToIso(starts, zone) ?? "", endsAt: wallInputToIso(ends, zone) ?? "" },
        );
        if (!res.ok) {
          setError(res.error);
          return;
        }
        toast.success(t("pastoral.done.closureSaved"));
        if (res.overlapping > 0) toast.warning(t("pastoral.done.closureOverlap", { count: res.overlapping }));
        onOpenChange(false);
        router.refresh();
      } catch (e) {
        console.error("[blackout-dialog] could not save", e);
        setError(t("pastoral.errors.network"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pastoral.blackout.title")}</DialogTitle>
          <DialogDescription>{t("pastoral.public.timesIn", { zone })}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("pastoral.blackout.kind")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as PastorClosureKind)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLOSURE_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {t(k.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bo-reason">{t("pastoral.blackout.reason")}</Label>
            <Input id="bo-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <p className="text-muted-foreground -mt-2 text-xs">{t("pastoral.blackout.reasonHint")}</p>

        <div className="bg-muted inline-flex w-full rounded-xl p-1">
          {([true, false] as const).map((w) => (
            <button
              key={String(w)}
              type="button"
              onClick={() => setWhole(w)}
              className={cn(
                "min-h-11 flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                whole === w ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              {w ? t("pastoral.blackout.wholeDays") : t("pastoral.blackout.partDay")}
            </button>
          ))}
        </div>

        {whole ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bo-from">{t("pastoral.blackout.firstDay")}</Label>
              <Input id="bo-from" type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bo-to">{t("pastoral.blackout.lastDay")}</Label>
              <Input id="bo-to" type="date" value={toDay} min={fromDay} onChange={(e) => setToDay(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bo-starts">{t("pastoral.blackout.starts")}</Label>
              <Input id="bo-starts" type="datetime-local" step={300} value={starts} onChange={(e) => setStarts(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bo-ends">{t("pastoral.blackout.ends")}</Label>
              <Input id="bo-ends" type="datetime-local" step={300} value={ends} onChange={(e) => setEnds(e.target.value)} />
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-3 py-2 text-sm">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={pending || reason.trim().length < 2} onClick={save}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
