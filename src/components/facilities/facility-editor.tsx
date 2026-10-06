"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveFacility, setFacilityActive } from "@/app/(app)/facilities/actions";
import { FACILITY_KINDS, FACILITY_RATES, type FacilityRate } from "@/lib/facility-shared";
import { currencySymbol } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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

type Editable = {
  id: string;
  name: string;
  kind: string;
  location: string | null;
  description: string | null;
  capacity: number | null;
  isActive: boolean;
  isBookable: boolean;
  requiresApproval: boolean;
  bufferMinutes: number;
  hireFee: number | null;
  rate: FacilityRate;
  notes: string | null;
};

const empty = {
  name: "",
  kind: "hall",
  location: "",
  description: "",
  capacity: "",
  isActive: true,
  isBookable: true,
  requiresApproval: true,
  bufferMinutes: "0",
  hireFee: "",
  rate: "free" as FacilityRate,
  notes: "",
};

export function FacilityEditor({
  facility,
  currency,
  open,
  onOpenChange,
}: {
  facility: Editable | null;
  currency: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /*
   * Seeded once from the facility being edited. No effect syncing props into
   * state: the parent keys this dialog by facility id, so editing a different
   * one remounts it rather than assigning over a form somebody may be typing
   * into.
   */
  const [form, setForm] = useState(() =>
    facility
      ? {
          name: facility.name,
          kind: facility.kind,
          location: facility.location ?? "",
          description: facility.description ?? "",
          capacity: facility.capacity != null ? String(facility.capacity) : "",
          isActive: facility.isActive,
          isBookable: facility.isBookable,
          requiresApproval: facility.requiresApproval,
          bufferMinutes: String(facility.bufferMinutes),
          hireFee: facility.hireFee != null ? String(facility.hireFee) : "",
          rate: facility.rate,
          notes: facility.notes ?? "",
        }
      : empty,
  );

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  function submit() {
    startTransition(async () => {
      const res = await saveFacility(
        {
          name: form.name,
          kind: form.kind as (typeof FACILITY_KINDS)[number]["value"],
          location: form.location || null,
          description: form.description || null,
          capacity: form.capacity ? Number(form.capacity) : null,
          isActive: form.isActive,
          isBookable: form.isBookable,
          requiresApproval: form.requiresApproval,
          bufferMinutes: Number(form.bufferMinutes || 0),
          hireFee: form.hireFee ? Number(form.hireFee) : null,
          rate: form.rate,
          notes: form.notes || null,
        },
        facility?.id,
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(facility ? "Saved." : `${form.name} is on the register.`);
      onOpenChange(false);
      router.refresh();
    });
  }

  function retire() {
    if (!facility) return;
    startTransition(async () => {
      const res = await setFacilityActive(facility.id, !facility.isActive);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(facility.isActive ? "Retired." : "Back on the register.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{facility ? "Edit" : "Add a place"}</DialogTitle>
          <DialogDescription>
            Anything the church owns and keeps track of — a hall, a classroom,
            the grounds, the bus, the canopies.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fe-name">Name</Label>
            <Input
              id="fe-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Main Auditorium"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>What is it?</Label>
              <Select value={form.kind} onValueChange={(v) => set({ kind: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FACILITY_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fe-cap">How many it holds</Label>
              <Input
                id="fe-cap"
                type="number"
                inputMode="numeric"
                min={0}
                value={form.capacity}
                onChange={(e) => set({ capacity: e.target.value })}
                placeholder="Leave blank if it does not apply"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fe-loc">Where is it?</Label>
            <Input
              id="fe-loc"
              value={form.location}
              onChange={(e) => set({ location: e.target.value })}
              placeholder="Ground floor, behind the main auditorium"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Hire charge</Label>
              <Select
                value={form.rate}
                onValueChange={(v) => set({ rate: v as FacilityRate })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FACILITY_RATES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.rate !== "free" && (
              <div className="space-y-1.5">
                <Label htmlFor="fe-fee">Amount ({currencySymbol(currency)})</Label>
                <Input
                  id="fe-fee"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={form.hireFee}
                  onChange={(e) => set({ hireFee: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fe-buffer">Turnaround (minutes)</Label>
            <Input
              id="fe-buffer"
              type="number"
              inputMode="numeric"
              min={0}
              max={1440}
              value={form.bufferMinutes}
              onChange={(e) => set({ bufferMinutes: e.target.value })}
            />
            <p className="text-muted-foreground text-xs">
              Kept free either side of every booking for setting up and clearing
              away. With 60 here, nothing can be booked within an hour of a
              wedding ending.
            </p>
          </div>

          <div className="space-y-2">
            {[
              ["isBookable", "Can be booked", "Off for something you list but nobody reserves."],
              ["requiresApproval", "Needs approving", "Off means a booking is confirmed the moment it is made."],
              ["isActive", "In use", "Off retires it, keeping its history."],
            ].map(([key, title, hint]) => (
              <div key={key} className="flex items-center justify-between rounded-xl border px-4 py-3">
                <div className="min-w-0 pr-3">
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="text-muted-foreground text-xs">{hint}</p>
                </div>
                <Switch
                  checked={form[key as "isBookable" | "requiresApproval" | "isActive"]}
                  onCheckedChange={(v) => set({ [key]: v } as Partial<typeof form>)}
                />
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fe-notes">Notes</Label>
            <Textarea
              id="fe-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="The generator does not cover this wing. Keys with the caretaker."
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          {facility && (
            <Button variant="ghost" onClick={retire} disabled={pending}>
              {facility.isActive ? "Retire" : "Bring back"}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || form.name.trim().length < 2}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {facility ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
