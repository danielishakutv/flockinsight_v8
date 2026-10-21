"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, CalendarClock, Check, Loader2, Lock, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  addBookerToRegister,
  cancelAppointment,
  confirmAppointment,
  declineAppointment,
  listSlotsForStaff,
  rescheduleAppointment,
} from "@/app/(app)/appointments/actions";
import {
  describeDelivery,
  holdsTheSlot,
  locationKey,
  statusMeta,
} from "@/lib/pastoral-shared";
import { wallInputToIso } from "@/lib/pastoral-slots";
import { SlotPicker } from "@/components/pastoral/slot-picker";
import type { AppointmentItem } from "@/components/pastoral/appointments-browser";

type Mode = "view" | "decline" | "cancel" | "move";

/**
 * One appointment, and everything that can be done to it.
 *
 * A Radix dialog, so it portals to <body>. What it is about shows only when
 * the server sent it (the pastor or a manager); anybody else sees that there
 * is something private, never what. What happened to each message is shown
 * in words, so a confirmation that never arrived is visible here.
 */
export function AppointmentSheet({
  appointment: a,
  zone,
  today,
  canAct,
  canManage,
  canAddToRegister,
  onClose,
}: {
  appointment: AppointmentItem | null;
  zone: string;
  today: string;
  canAct: boolean;
  canManage: boolean;
  canAddToRegister: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("view");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newStart, setNewStart] = useState<string | null>(null);
  const [ignoreHours, setIgnoreHours] = useState(false);
  const [manual, setManual] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const reset = () => {
    setMode("view");
    setNote("");
    setError(null);
    setNewStart(null);
    setIgnoreHours(false);
    setManual("");
  };

  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(t.intl, { timeZone: zone, ...opts }).format(new Date(iso));
  const whenFull = (iso: string) =>
    fmt(iso, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
  const timeOnly = (iso: string) => fmt(iso, { hour: "numeric", minute: "2-digit" });

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string; taken?: boolean }>, done: string) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          setError(res.error);
          if (res.taken) setReloadKey((k) => k + 1);
          return;
        }
        toast.success(done);
        reset();
        router.refresh();
      } catch (e) {
        console.error("[appointment-sheet] action failed", e);
        setError(t("pastoral.errors.network"));
      }
    });
  }

  function addToRegister() {
    if (!a) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await addBookerToRegister(a.id);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        toast.success(res.message);
        router.refresh();
      } catch (e) {
        console.error("[appointment-sheet] add to register failed", e);
        setError(t("pastoral.errors.network"));
      }
    });
  }

  const meta = a ? statusMeta(a.status) : null;
  const live = a ? holdsTheSlot(a.status) : false;
  const future = a ? new Date(a.endsAt).getTime() > new Date().getTime() : false;
  const deliveryLines = (outcome: string | null) =>
    describeDelivery(outcome, (iso) => fmt(iso, { weekday: "short", hour: "numeric", minute: "2-digit" }));

  return (
    <Dialog
      open={!!a}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        {a && meta && (
          <>
            <DialogHeader>
              <DialogTitle>
                {a.typeName} · {a.bookerName}
              </DialogTitle>
              <DialogDescription>
                <span className={cn("mr-2 rounded-md px-2 py-0.5 text-xs font-semibold", meta.className)}>
                  {t(meta.labelKey)}
                </span>
                {t(
                  a.source === "members"
                    ? "pastoral.sheet.source.members"
                    : a.source === "public"
                      ? "pastoral.sheet.source.public"
                      : "pastoral.sheet.source.staff",
                )}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("pastoral.sheet.when")}</dt>
              <dd className="font-semibold">
                {whenFull(a.startsAt)} – {timeOnly(a.endsAt)}
                {a.outsideHours && live && (
                  <Badge variant="outline" className="ml-2">
                    {t("pastoral.sheet.outsideHours")}
                  </Badge>
                )}
              </dd>
              <dt className="text-muted-foreground">{t("pastoral.sheet.with")}</dt>
              <dd>{a.pastorName}</dd>
              <dt className="text-muted-foreground">{t("pastoral.sheet.where")}</dt>
              <dd>{t(locationKey(a.location))}</dd>
              {a.address && (
                <>
                  <dt className="text-muted-foreground">{t("pastoral.sheet.address")}</dt>
                  <dd className="break-words">{a.address}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{t("pastoral.sheet.contact")}</dt>
              <dd className="space-y-0.5 break-words">
                {a.bookerPhone && (
                  <a className="block underline" href={`tel:${a.bookerPhone}`}>
                    {a.bookerPhone}
                  </a>
                )}
                {a.bookerEmail && (
                  <a className="block underline" href={`mailto:${a.bookerEmail}`}>
                    {a.bookerEmail}
                  </a>
                )}
                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                  {a.memberId ? (
                    a.identityVerified ? (
                      <>
                        <BadgeCheck className="size-3.5" /> {t("pastoral.sheet.verified")}
                      </>
                    ) : (
                      t("pastoral.sheet.matchedNotVerified", { name: a.memberName ?? a.bookerName })
                    )
                  ) : (
                    t("pastoral.sheet.notLinked")
                  )}
                </span>
              </dd>
              <dt className="text-muted-foreground">{t("pastoral.sheet.topic")}</dt>
              <dd className="break-words whitespace-pre-wrap">
                {a.topic ? (
                  a.topic
                ) : a.topicHidden ? (
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Lock className="size-3.5" /> {t("pastoral.sheet.topicHidden")}
                  </span>
                ) : (
                  "—"
                )}
              </dd>
              {a.decisionNote && (
                <>
                  <dt className="text-muted-foreground">{t("pastoral.sheet.note")}</dt>
                  <dd className="break-words whitespace-pre-wrap">{a.decisionNote}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{t("pastoral.sheet.confirmation")}</dt>
              <dd className="space-y-0.5">
                {deliveryLines(a.confirmationOutcome).length === 0
                  ? "—"
                  : deliveryLines(a.confirmationOutcome).map((l, i) => (
                      <span key={i} className="block">
                        {t(l.channel === "email" ? "pastoral.sheet.channelEmail" : "pastoral.sheet.channelSms")}:{" "}
                        {t(l.key, l.vars)}
                      </span>
                    ))}
              </dd>
              <dt className="text-muted-foreground">{t("pastoral.sheet.reminder")}</dt>
              <dd className="space-y-0.5">
                {a.reminderOutcome
                  ? deliveryLines(a.reminderOutcome).map((l, i) => (
                      <span key={i} className="block">
                        {t(l.channel === "email" ? "pastoral.sheet.channelEmail" : "pastoral.sheet.channelSms")}:{" "}
                        {t(l.key, l.vars)}
                      </span>
                    ))
                  : a.remindAt && !a.reminderSentAt
                    ? t("pastoral.sheet.reminderDue", { time: fmt(a.remindAt, { weekday: "short", hour: "numeric", minute: "2-digit" }) })
                    : t("pastoral.sheet.noReminder")}
              </dd>
              {a.rescheduledFrom && (
                <>
                  <dt className="text-muted-foreground">
                    <CalendarClock className="inline size-3.5" />
                  </dt>
                  <dd>{t("pastoral.sheet.movedFrom", { when: whenFull(a.rescheduledFrom) })}</dd>
                </>
              )}
            </dl>

            {error && (
              <p role="alert" className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-3 py-2 text-sm">
                {error}
              </p>
            )}

            {canAct && mode === "view" && (
              <div className="flex flex-wrap gap-2">
                {a.status === "pending" && (
                  <Button
                    disabled={pending}
                    onClick={() => run(() => confirmAppointment(a.id), t("pastoral.done.confirmed"))}
                  >
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    {t("pastoral.actions.confirm")}
                  </Button>
                )}
                {a.status === "pending" && (
                  <Button variant="outline" disabled={pending} onClick={() => setMode("decline")}>
                    <X className="size-4" /> {t("pastoral.actions.decline")}
                  </Button>
                )}
                {live && future && a.pastorId && (
                  <Button variant="outline" disabled={pending} onClick={() => setMode("move")}>
                    <CalendarClock className="size-4" /> {t("pastoral.actions.reschedule")}
                  </Button>
                )}
                {live && (
                  <Button variant="ghost" disabled={pending} onClick={() => setMode("cancel")}>
                    {t("pastoral.actions.cancel")}
                  </Button>
                )}
              </div>
            )}

            {canAddToRegister && !a.memberId && mode === "view" && (
              <Button variant="outline" className="w-full sm:w-auto" disabled={pending} onClick={addToRegister}>
                <UserPlus className="size-4" /> {t("pastoral.actions.addToRegister")}
              </Button>
            )}

            {mode === "decline" && (
              <div className="space-y-2">
                <Label htmlFor="ap-decline">{t("pastoral.sheet.declineNote")}</Label>
                <Textarea id="ap-decline" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={pending || note.trim().length < 2}
                    onClick={() => run(() => declineAppointment(a.id, note), t("pastoral.done.declined"))}
                  >
                    {pending && <Loader2 className="size-4 animate-spin" />}
                    {t("pastoral.actions.decline")}
                  </Button>
                  <Button variant="ghost" onClick={reset}>
                    {t("common.back")}
                  </Button>
                </div>
              </div>
            )}

            {mode === "cancel" && (
              <div className="space-y-2">
                <Label htmlFor="ap-cancel">{t("pastoral.sheet.cancelNote")}</Label>
                <Textarea id="ap-cancel" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="destructive"
                    disabled={pending}
                    onClick={() => run(() => cancelAppointment(a.id, note), t("pastoral.done.cancelled"))}
                  >
                    {pending && <Loader2 className="size-4 animate-spin" />}
                    {t("pastoral.actions.cancel")}
                  </Button>
                  <Button variant="ghost" onClick={reset}>
                    {t("common.back")}
                  </Button>
                </div>
              </div>
            )}

            {mode === "move" && a.pastorId && (
              <div className="space-y-3">
                {canManage && (
                  <div className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold">{t("pastoral.behalf.ignoreHours")}</p>
                      <p className="text-muted-foreground text-xs">{t("pastoral.behalf.ignoreHoursHint")}</p>
                    </div>
                    <Switch checked={ignoreHours} onCheckedChange={setIgnoreHours} aria-label={t("pastoral.behalf.ignoreHours")} />
                  </div>
                )}
                {ignoreHours ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="ap-manual">{t("pastoral.behalf.startTime")}</Label>
                    <Input id="ap-manual" type="datetime-local" step={300} value={manual} onChange={(e) => setManual(e.target.value)} />
                  </div>
                ) : (
                  <SlotPicker
                    load={(from) => listSlotsForStaff(a.pastorId as string, null, from, a.id)}
                    initialFromDay={today}
                    value={newStart}
                    onChange={setNewStart}
                    emptyText={t("pastoral.public.noTimes", { days: 14 })}
                    reloadKey={reloadKey}
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={pending || (ignoreHours ? !wallInputToIso(manual, zone) : !newStart)}
                    onClick={() => {
                      const at = ignoreHours ? wallInputToIso(manual, zone) : newStart;
                      if (at) run(() => rescheduleAppointment(a.id, at, ignoreHours), t("pastoral.done.moved"));
                    }}
                  >
                    {pending && <Loader2 className="size-4 animate-spin" />}
                    {t("pastoral.actions.reschedule")}
                  </Button>
                  <Button variant="ghost" onClick={reset}>
                    {t("common.back")}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
