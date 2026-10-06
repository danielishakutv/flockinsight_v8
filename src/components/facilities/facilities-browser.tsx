"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarDays,
  Check,
  Clock,
  Loader2,
  Lock,
  Plus,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { decideBooking, setFeePaid } from "@/app/(app)/facilities/actions";
import { kindLabel, statusMeta } from "@/lib/facility-shared";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CalendarEntry } from "@/lib/facilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FacilityCalendar } from "@/components/facilities/facility-calendar";
import {
  BookDialog,
  type BookableFacility,
  type MemberOption,
} from "@/components/facilities/book-dialog";
import { FacilityEditor } from "@/components/facilities/facility-editor";
import { CloseFacilityDialog } from "@/components/facilities/close-facility-dialog";

export type FacilityCard = BookableFacility & {
  kind: string;
  location: string | null;
  description: string | null;
  isActive: boolean;
  isBookable: boolean;
  notes: string | null;
  contactName: string | null;
};

export type BookingRow = {
  id: string;
  facilityId: string;
  facilityName: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  isExternal: boolean;
  who: string | null;
  expectedAttendance: number | null;
  fee: number | null;
  feePaid: boolean;
  notes: string | null;
  decisionNote: string | null;
};

export type ClosureRow = {
  id: string;
  facilityId: string;
  facilityName: string;
  kind: string;
  reason: string;
  startsAt: string;
  endsAt: string;
  cost: number | null;
};

const when = (startsAt: string, endsAt: string) => {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const sameDay = s.toDateString() === e.toDateString();
  const d = s.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const t = (x: Date) => x.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay
    ? `${d} · ${t(s)} – ${t(e)}`
    : `${d} ${t(s)} → ${e.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${t(e)}`;
};

export function FacilitiesBrowser({
  facilities,
  bookings,
  closures,
  calendar,
  members,
  currency,
  canManage,
}: {
  facilities: FacilityCard[];
  bookings: BookingRow[];
  closures: ClosureRow[];
  calendar: CalendarEntry[];
  members: MemberOption[];
  currency: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"calendar" | "places" | "bookings">("calendar");
  const [booking, setBooking] = useState<{ day?: string; facilityId?: string } | null>(null);
  const [editing, setEditing] = useState<FacilityCard | null | "new">(null);
  const [closing, setClosing] = useState<FacilityCard | null>(null);
  const [declining, setDeclining] = useState<BookingRow | null>(null);
  const [reason, setReason] = useState("");

  const bookable = facilities.filter((f) => f.isActive && f.isBookable);
  const pendingBookings = bookings.filter((b) => b.status === "requested");
  const upcoming = bookings
    .filter((b) => b.status === "approved" && new Date(b.endsAt) >= new Date())
    .slice(0, 50);

  function decide(id: string, decision: "approved" | "declined" | "cancelled", note?: string) {
    startTransition(async () => {
      const res = await decideBooking(id, decision, note);
      if (!res.ok) {
        toast.error(res.error);
        res.clashes?.forEach((c) => toast.error(c.reason));
        return;
      }
      toast.success(res.message);
      setDeclining(null);
      setReason("");
      router.refresh();
    });
  }

  function togglePaid(b: BookingRow) {
    startTransition(async () => {
      const res = await setFeePaid(b.id, !b.feePaid);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-muted inline-flex rounded-xl p-1">
          {([
            ["calendar", "Calendar", CalendarDays],
            ["places", `Places (${facilities.length})`, Building2],
            ["bookings", `Bookings (${bookings.length})`, Clock],
          ] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                tab === k ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          {bookable.length > 0 && (
            <Button size="sm" onClick={() => setBooking({})}>
              <Plus className="size-4" /> Book
            </Button>
          )}
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
              <Building2 className="size-4" /> Add a place
            </Button>
          )}
        </div>
      </div>

      {canManage && pendingBookings.length > 0 && (
        <Card className="border-amber-500/40">
          <CardContent className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-bold">
              <Clock className="size-4" />
              {pendingBookings.length} request
              {pendingBookings.length === 1 ? "" : "s"} waiting on you
            </p>
            <ul className="divide-y">
              {pendingBookings.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{b.title}</p>
                    <p className="text-muted-foreground text-xs">
                      {b.facilityName} · {when(b.startsAt, b.endsAt)}
                      {b.who ? ` · ${b.who}` : ""}
                      {b.isExternal ? " · outside hirer" : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={pending} onClick={() => decide(b.id, "approved")}>
                      <Check className="size-3.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => setDeclining(b)}
                    >
                      <X className="size-3.5" /> Decline
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {tab === "calendar" && (
        <FacilityCalendar
          entries={calendar}
          onPick={bookable.length > 0 ? (day) => setBooking({ day }) : undefined}
        />
      )}

      {tab === "places" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {facilities.length === 0 ? (
            <p className="text-muted-foreground col-span-full rounded-xl border border-dashed px-4 py-12 text-center text-sm">
              Nothing on the register yet. Add the auditorium, the fellowship hall,
              the classrooms — anything the church lends out or keeps track of.
            </p>
          ) : (
            facilities.map((f) => (
              <Card key={f.id} className={cn(!f.isActive && "opacity-60")}>
                <CardContent className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold">{f.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {kindLabel(f.kind)}
                        {f.location ? ` · ${f.location}` : ""}
                      </p>
                    </div>
                    {!f.isActive && <Badge variant="secondary">Retired</Badge>}
                  </div>

                  <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {f.capacity != null && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3" /> {f.capacity}
                      </span>
                    )}
                    {f.rate !== "free" && f.hireFee != null && (
                      <span className="font-semibold">
                        {formatMoney(f.hireFee, currency)}
                        {f.rate === "hour" ? "/hr" : f.rate === "day" ? "/day" : " per booking"}
                      </span>
                    )}
                    {f.bufferMinutes > 0 && <span>{f.bufferMinutes}m turnaround</span>}
                    {!f.isBookable && <span>Not bookable</span>}
                  </div>

                  {f.contactName && (
                    <p className="text-muted-foreground text-xs">Ask {f.contactName}</p>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {f.isActive && f.isBookable && (
                      <Button size="sm" variant="outline" onClick={() => setBooking({ facilityId: f.id })}>
                        Book
                      </Button>
                    )}
                    {canManage && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(f)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setClosing(f)}>
                          <Wrench className="size-3.5" /> Close
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === "bookings" && (
        <div className="space-y-5">
          <section>
            <h2 className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
              Coming up · {upcoming.length}
            </h2>
            {upcoming.length === 0 ? (
              <p className="text-muted-foreground mt-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm">
                Nothing booked yet.
              </p>
            ) : (
              <ul className="mt-1 divide-y rounded-xl border">
                {upcoming.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{b.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {b.facilityName} · {when(b.startsAt, b.endsAt)}
                        {b.who ? ` · ${b.who}` : ""}
                      </p>
                    </div>
                    {b.fee != null && b.fee > 0 && (
                      <button
                        type="button"
                        disabled={!canManage || pending}
                        onClick={() => canManage && togglePaid(b)}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-bold",
                          b.feePaid
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                        )}
                      >
                        {formatMoney(b.fee, currency)} {b.feePaid ? "paid" : "due"}
                      </button>
                    )}
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => decide(b.id, "cancelled")}
                      >
                        Cancel
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {closures.length > 0 && (
            <section>
              <h2 className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
                Closed for work · {closures.length}
              </h2>
              <ul className="mt-1 divide-y rounded-xl border">
                {closures.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Lock className="text-muted-foreground size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{c.reason}</p>
                      <p className="text-muted-foreground text-xs">
                        {c.facilityName} · {when(c.startsAt, c.endsAt)}
                      </p>
                    </div>
                    {c.cost != null && c.cost > 0 && (
                      <span className="text-muted-foreground text-xs font-semibold">
                        {formatMoney(c.cost, currency)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
              Everything · {bookings.length}
            </h2>
            <ul className="mt-1 divide-y rounded-xl border">
              {bookings.map((b) => {
                const meta = statusMeta(b.status);
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{b.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {b.facilityName} · {when(b.startsAt, b.endsAt)}
                      </p>
                      {b.decisionNote && (
                        <p className="text-muted-foreground text-xs italic">{b.decisionNote}</p>
                      )}
                    </div>
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", meta.className)}>
                      {meta.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}

      <BookDialog
        key={`${booking?.day ?? ""}-${booking?.facilityId ?? ""}`}
        facilities={bookable}
        members={members}
        currency={currency}
        open={!!booking}
        onOpenChange={(o) => !o && setBooking(null)}
        presetDay={booking?.day}
        presetFacilityId={booking?.facilityId}
        canManage={canManage}
      />

      {canManage && (
        <>
          {/*
            Keyed, so picking a different place gives a FRESH form rather than
            one assigned over by an effect. The key changes, React remounts,
            and the initialiser runs with the right values.
          */}
          <FacilityEditor
            key={editing === "new" ? "new" : (editing?.id ?? "none")}
            facility={editing === "new" ? null : editing}
            currency={currency}
            open={editing !== null}
            onOpenChange={(o) => !o && setEditing(null)}
          />
          <CloseFacilityDialog
            key={closing?.id ?? "none"}
            facility={closing}
            open={!!closing}
            onOpenChange={(o) => !o && setClosing(null)}
          />
        </>
      )}

      <Dialog open={!!declining} onOpenChange={(o) => !o && setDeclining(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline &ldquo;{declining?.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              Say why. Whoever asked will see it, and a refusal nobody can explain
              is the thing that sends people back to asking in the corridor.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="The hall is being repainted that week."
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclining(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => declining && decide(declining.id, "declined", reason)}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
