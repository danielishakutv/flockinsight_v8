"use client";

import { Lock, Plus } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { closureKey, statusMeta } from "@/lib/pastoral-shared";
import type { AppointmentItem, ClosureItem, PastorItem } from "@/components/pastoral/appointments-browser";

/**
 * One day of the diary, in time order, read on the church's clock.
 *
 * Opened from a day in the month grid. Appointments booked before the
 * pastor's hours changed are tagged rather than hidden or moved: they were
 * promised, and the pastor decides.
 */
export function DayAgenda({
  day,
  zone,
  appointments,
  closures,
  pastors,
  onClose,
  onOpen,
  onBook,
}: {
  day: string | null;
  zone: string;
  appointments: AppointmentItem[];
  closures: ClosureItem[];
  pastors: PastorItem[];
  onClose: () => void;
  onOpen: (id: string) => void;
  onBook?: () => void;
}) {
  const t = useT();
  const time = (iso: string) =>
    new Intl.DateTimeFormat(t.intl, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const title = day
    ? (() => {
        const [y, m, d] = day.split("-").map(Number);
        return new Intl.DateTimeFormat(t.intl, {
          timeZone: "UTC",
          weekday: "long",
          day: "numeric",
          month: "long",
        }).format(new Date(Date.UTC(y, m - 1, d, 12)));
      })()
    : "";
  const sorted = [...appointments].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const pastorName = (id: string) => pastors.find((p) => p.id === id)?.displayName ?? "";

  return (
    <Dialog open={!!day} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("pastoral.public.timesIn", { zone })}</DialogDescription>
        </DialogHeader>

        {closures.length > 0 && (
          <ul className="space-y-1.5">
            {closures.map((c) => (
              <li key={c.id} className="flex items-start gap-2 rounded-lg bg-slate-500/10 px-3 py-2 text-sm">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0">
                  <span className="font-semibold">{pastorName(c.pastorId)}</span>{" "}
                  {t("pastoral.agenda.away", { reason: `${t(closureKey(c.kind))} · ${c.reason}` })}
                </span>
              </li>
            ))}
          </ul>
        )}

        {sorted.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">{t("pastoral.agenda.empty")}</p>
        ) : (
          <ul className="divide-y">
            {sorted.map((a) => {
              const meta = statusMeta(a.status);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(a.id)}
                    className="hover:bg-muted/60 flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 text-left"
                  >
                    <span className="w-24 shrink-0 text-sm font-bold tabular-nums">
                      {time(a.startsAt)}–{time(a.endsAt)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {a.typeName} · {a.bookerName}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">{a.pastorName}</span>
                    </span>
                    <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", meta.className)}>
                      {t(meta.labelKey)}
                    </span>
                    {a.outsideHours && <Badge variant="outline">{t("pastoral.sheet.outsideHours")}</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
          {onBook && (
            <Button onClick={onBook}>
              <Plus className="size-4" /> {t("pastoral.agenda.book")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
