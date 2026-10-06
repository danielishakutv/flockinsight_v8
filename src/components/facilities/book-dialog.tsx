"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveBooking } from "@/app/(app)/facilities/actions";
import { feeFor, durationLabel, type FacilityRate } from "@/lib/facility-shared";
import { formatMoney } from "@/lib/money";
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

export type BookableFacility = {
  id: string;
  name: string;
  capacity: number | null;
  hireFee: number | null;
  rate: FacilityRate;
  requiresApproval: boolean;
  bufferMinutes: number;
};

export type MemberOption = { id: string; name: string };

/** "2026-11-07T10:00" — what a datetime-local input wants. */
function localValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function defaultsFor(dayIso?: string) {
  const base = dayIso ? new Date(`${dayIso}T09:00:00`) : new Date();
  if (!dayIso) {
    base.setMinutes(0, 0, 0);
    base.setHours(base.getHours() + 1);
  }
  const end = new Date(base.getTime() + 2 * 3_600_000);
  return { startsAt: localValue(base), endsAt: localValue(end) };
}

export function BookDialog({
  facilities,
  members,
  currency,
  open,
  onOpenChange,
  presetDay,
  presetFacilityId,
  canManage,
}: {
  facilities: BookableFacility[];
  members: MemberOption[];
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetDay?: string;
  presetFacilityId?: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [clashes, setClashes] = useState<{ label: string; reason: string }[]>([]);

  const [form, setForm] = useState(() => ({
    facilityId: presetFacilityId ?? facilities[0]?.id ?? "",
    title: "",
    purpose: "",
    ...defaultsFor(presetDay),
    memberId: "",
    requesterName: "",
    requesterPhone: "",
    isExternal: false,
    expectedAttendance: "",
    notes: "",
  }));

  /*
   * There is no effect here syncing state to props, deliberately.
   *
   * Clicking the 14th must not present yesterday's half-filled form, and the
   * React answer to that is a fresh component rather than an effect that
   * assigns over the old one. The parent gives this dialog a `key` built from
   * the day and the facility, so picking a different one remounts it and the
   * initialiser below runs again with the right defaults.
   */
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const chosen = facilities.find((f) => f.id === form.facilityId);

  /** What it will cost, worked out the same way the server will. */
  const quote = useMemo(() => {
    if (!chosen) return null;
    const s = new Date(form.startsAt);
    const e = new Date(form.endsAt);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return null;
    const fee = feeFor(chosen.rate, chosen.hireFee, { startsAt: s, endsAt: e });
    return { fee, duration: durationLabel({ startsAt: s, endsAt: e }) };
  }, [chosen, form.startsAt, form.endsAt]);

  function submit() {
    setClashes([]);
    startTransition(async () => {
      const res = await saveBooking({
        facilityId: form.facilityId,
        title: form.title,
        purpose: form.purpose || null,
        // A datetime-local value has no zone; the browser's own zone is the
        // church's, which is the right reading for a hall in one building.
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        memberId: form.memberId || null,
        requesterName: form.requesterName || null,
        requesterPhone: form.requesterPhone || null,
        isExternal: form.isExternal,
        expectedAttendance: form.expectedAttendance ? Number(form.expectedAttendance) : null,
        notes: form.notes || null,
      });

      if (!res.ok) {
        setClashes(res.clashes ?? []);
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Book a facility</DialogTitle>
          <DialogDescription>
            {chosen?.requiresApproval && !canManage
              ? "This goes in as a request. Someone who manages facilities will confirm it."
              : "Nothing can be booked over something already approved — the clash is refused, with what is in the way."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>What are you booking?</Label>
            <Select value={form.facilityId} onValueChange={(v) => set({ facilityId: v })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {facilities.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                    {f.capacity ? ` · seats ${f.capacity}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-title">What is it for?</Label>
            <Input
              id="fb-title"
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Ada and Emeka wedding"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fb-start">From</Label>
              <Input
                id="fb-start"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => set({ startsAt: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fb-end">Until</Label>
              <Input
                id="fb-end"
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => set({ endsAt: e.target.value })}
              />
            </div>
          </div>

          {quote && (
            <p className="text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 text-xs">
              {quote.duration}
              {quote.fee != null && (
                <>
                  {" · "}
                  <span className="text-foreground font-semibold">
                    {formatMoney(quote.fee, currency)}
                  </span>{" "}
                  to hire
                </>
              )}
              {chosen && chosen.bufferMinutes > 0 && (
                <> · {chosen.bufferMinutes} minutes are kept either side to set up and clear away</>
              )}
            </p>
          )}

          {clashes.length > 0 && (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/5 space-y-1.5 rounded-xl border px-4 py-3"
            >
              <p className="text-destructive flex items-center gap-1.5 text-sm font-semibold">
                <AlertTriangle className="size-4" /> Not free then
              </p>
              {clashes.map((c, i) => (
                <p key={i} className="text-muted-foreground text-xs">
                  {c.reason}
                </p>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl border px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Someone outside the church</p>
              <p className="text-muted-foreground text-xs">
                A hirer rather than one of your own groups.
              </p>
            </div>
            <Switch
              checked={form.isExternal}
              onCheckedChange={(v) => set({ isExternal: v, memberId: v ? "" : form.memberId })}
            />
          </div>

          {form.isExternal ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fb-name">Their name</Label>
                <Input
                  id="fb-name"
                  value={form.requesterName}
                  onChange={(e) => set({ requesterName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fb-phone">Phone</Label>
                <Input
                  id="fb-phone"
                  type="tel"
                  inputMode="tel"
                  value={form.requesterPhone}
                  onChange={(e) => set({ requesterPhone: e.target.value })}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="fb-member">Who is it for?</Label>
              <Input
                id="fb-member"
                list="fb-members"
                value={form.requesterName}
                onChange={(e) => {
                  const typed = e.target.value;
                  const match = members.find((m) => m.name === typed);
                  set({ requesterName: typed, memberId: match?.id ?? "" });
                }}
                placeholder="Start typing a member's name"
              />
              <datalist id="fb-members">
                {members.map((m) => (
                  <option key={m.id} value={m.name} />
                ))}
              </datalist>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fb-attend">People expected</Label>
              <Input
                id="fb-attend"
                type="number"
                inputMode="numeric"
                min={0}
                value={form.expectedAttendance}
                onChange={(e) => set({ expectedAttendance: e.target.value })}
                placeholder={chosen?.capacity ? `Seats ${chosen.capacity}` : ""}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-notes">Anything the team should know</Label>
            <Textarea
              id="fb-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Needs the PA, 200 chairs, access from 7am…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={pending || !form.facilityId || form.title.trim().length < 2}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
            {chosen?.requiresApproval && !canManage ? "Request it" : "Book it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
