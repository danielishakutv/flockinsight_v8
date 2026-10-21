"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarPlus, Loader2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelByToken, listSlotsForToken, rescheduleByToken } from "@/app/appointment/[token]/actions";
import { SlotPicker } from "@/components/pastoral/slot-picker";
import { downloadIcs } from "@/components/pastoral/public-booking-flow";

type Mode = "view" | "cancel" | "move" | "cancelled";

/**
 * Cancel or move one's own appointment from the link in the confirmation.
 *
 * Every refusal is said in words: too close to the time (with the church's
 * number), moved too often, or changed by somebody else meanwhile. After a
 * move the page replaces its own URL with the new link, because the old one
 * has just stopped working.
 */
export function ManageAppointment({
  token,
  zone,
  today,
  status,
  typeName,
  pastorName,
  when,
  where,
  refusal,
  canMove,
  ics,
}: {
  token: string;
  zone: string;
  today: string;
  status: "pending" | "confirmed";
  typeName: string;
  pastorName: string;
  when: string;
  where: string;
  refusal: string | null;
  canMove: boolean;
  ics: { uid: string; sequence: number; startsAt: string; endsAt: string; summary: string; location: string };
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("view");
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const guarded = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        console.error("[manage-appointment] request failed", e);
        setError(t("pastoral.errors.network"));
      }
    });
  };

  if (mode === "cancelled") {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-extrabold">{t("pastoral.manage.title")}</h1>
        <p className="text-sm">{t("pastoral.manage.cancelledDone")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold">{t("pastoral.manage.title")}</h1>
      {notice && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm">{notice}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("pastoral.public.whenLabel")}</dt>
        <dd className="font-semibold">{when}</dd>
        <dt className="text-muted-foreground">{t("pastoral.public.withLabel")}</dt>
        <dd>
          {typeName} · {pastorName}
        </dd>
        <dt className="text-muted-foreground">{t("pastoral.public.whereLabel")}</dt>
        <dd className="break-words">{where}</dd>
      </dl>
      <p className="text-muted-foreground text-xs">{t("pastoral.public.timesIn", { zone })}</p>
      {status === "pending" && (
        <p className="text-sm text-amber-700 dark:text-amber-300">{t("pastoral.manage.pendingNote", { pastor: pastorName })}</p>
      )}

      {error && (
        <p role="alert" className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {refusal ? (
        <p className="rounded-xl border px-3 py-2 text-sm">{refusal}</p>
      ) : (
        <>
          {mode === "view" && (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button variant="outline" className="min-h-11" onClick={() => downloadIcs(ics)}>
                <CalendarPlus className="size-4" /> {t("pastoral.public.addToCalendar")}
              </Button>
              {canMove ? (
                <Button variant="outline" className="min-h-11" onClick={() => setMode("move")}>
                  <CalendarClock className="size-4" /> {t("pastoral.manage.move")}
                </Button>
              ) : (
                <p className="text-muted-foreground text-sm">{t("pastoral.manage.movedLimit")}</p>
              )}
              <Button variant="ghost" className="min-h-11" onClick={() => setMode("cancel")}>
                {t("pastoral.manage.cancel")}
              </Button>
            </div>
          )}

          {mode === "cancel" && (
            <div className="space-y-2">
              <Label htmlFor="mg-reason">{t("pastoral.manage.cancelReason")}</Label>
              <Textarea id="mg-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="destructive"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() =>
                    guarded(async () => {
                      const res = await cancelByToken(token, reason);
                      if (!res.ok) {
                        setError(res.error);
                        return;
                      }
                      setMode("cancelled");
                    })
                  }
                >
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  {t("pastoral.manage.cancelConfirm")}
                </Button>
                <Button variant="ghost" className="min-h-11" onClick={() => setMode("view")}>
                  {t("pastoral.manage.keep")}
                </Button>
              </div>
            </div>
          )}

          {mode === "move" && (
            <div className="space-y-3">
              <SlotPicker
                load={(from) => listSlotsForToken(token, from)}
                initialFromDay={today}
                value={startsAt}
                onChange={setStartsAt}
                emptyText={t("pastoral.public.noTimes", { days: 14 })}
                reloadKey={reloadKey}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="min-h-11"
                  disabled={pending || !startsAt}
                  onClick={() =>
                    guarded(async () => {
                      if (!startsAt) return;
                      const res = await rescheduleByToken(token, startsAt);
                      if (!res.ok) {
                        setError(res.error);
                        if (res.taken) {
                          setStartsAt(null);
                          setReloadKey((k) => k + 1);
                        }
                        return;
                      }
                      setNotice(t("pastoral.manage.movedDone"));
                      setMode("view");
                      // The old link has just stopped working; this page moves to the new one.
                      router.replace(new URL(res.manageUrl).pathname);
                    })
                  }
                >
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  {t("pastoral.manage.move")}
                </Button>
                <Button variant="ghost" className="min-h-11" onClick={() => setMode("view")}>
                  {t("common.back")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
