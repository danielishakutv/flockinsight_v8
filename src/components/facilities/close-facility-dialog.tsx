"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveClosure } from "@/app/(app)/facilities/actions";
import { CLOSURE_KINDS } from "@/lib/facility-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function localValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Shutting something, and recording what it cost.
 *
 * One row does both jobs: the calendar reads it as "unavailable" and the
 * facility's history reads it as the maintenance record. A church that
 * repainted the hall in March should be able to see that it happened, what it
 * cost, and why nothing could be booked that week — without three screens.
 */
export function CloseFacilityDialog({
  facility,
  open,
  onOpenChange,
}: {
  facility: { id: string; name: string } | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [clashes, setClashes] = useState<{ label: string; reason: string }[]>([]);
  const [form, setForm] = useState(() => {
    const start = new Date();
    start.setHours(8, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);
    return {
      kind: "maintenance",
      reason: "",
      startsAt: localValue(start),
      endsAt: localValue(end),
      cost: "",
    };
  });

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  function submit() {
    if (!facility) return;
    setClashes([]);
    startTransition(async () => {
      const res = await saveClosure({
        facilityId: facility.id,
        kind: form.kind as (typeof CLOSURE_KINDS)[number]["value"],
        reason: form.reason,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        cost: form.cost ? Number(form.cost) : null,
      });
      if (!res.ok) {
        setClashes(res.clashes ?? []);
        toast.error(res.error);
        return;
      }
      toast.success(`${facility.name} is closed for that period.`);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close {facility?.name}</DialogTitle>
          <DialogDescription>
            Nothing can be booked while it is closed. The cost you put here is
            the maintenance record.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Why?</Label>
            <Select value={form.kind} onValueChange={(v) => set({ kind: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLOSURE_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fc-reason">In a few words</Label>
            <Input
              id="fc-reason"
              value={form.reason}
              onChange={(e) => set({ reason: e.target.value })}
              placeholder="Repainting and new ceiling fans"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fc-start">From</Label>
              <Input
                id="fc-start"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => set({ startsAt: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fc-end">Until</Label>
              <Input
                id="fc-end"
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => set({ endsAt: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fc-cost">What it cost (optional)</Label>
            <Input
              id="fc-cost"
              type="number"
              inputMode="decimal"
              min={0}
              value={form.cost}
              onChange={(e) => set({ cost: e.target.value })}
            />
          </div>

          {clashes.length > 0 && (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/5 space-y-1.5 rounded-xl border px-4 py-3"
            >
              <p className="text-destructive flex items-center gap-1.5 text-sm font-semibold">
                <AlertTriangle className="size-4" /> There are bookings in the way
              </p>
              {clashes.map((c, i) => (
                <p key={i} className="text-muted-foreground text-xs">
                  {c.reason}
                </p>
              ))}
              <p className="text-muted-foreground text-xs">
                Somebody is expecting it. Cancel or move those first — closing it
                under them would be worse than the clash.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || form.reason.trim().length < 2}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Close it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
