"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dayKeyIn, daysCovered } from "@/lib/calendar-days";
import type { CalendarEntry } from "@/lib/facilities";

/**
 * A month, with what is booked on each day.
 *
 * Deliberately a month grid and not a timetable. A church secretary asks "is
 * the hall free on the 14th?", which a month answers at a glance; an
 * hour-by-hour view answers a question almost nobody has and does not fit on a
 * phone.
 *
 * Also the pastoral diary's month view, through three optional props. With
 * none of them passed, Facilities renders exactly as it always has.
 */

export type CalendarTone = "held" | "pending" | "closed";

export type CalendarLabels = {
  /** Monday first, seven of them. */
  weekdays: string[];
  today: string;
  more: (n: number) => string;
  prev: string;
  next: string;
  legend: { held: string; pending: string; closed: string };
};

const DEFAULT_LABELS: CalendarLabels = {
  weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  today: "Today",
  more: (n) => `+${n} more`,
  prev: "Previous month",
  next: "Next month",
  legend: { held: "Booked", pending: "Awaiting approval", closed: "Closed" },
};

/** Today's rule: a closure is closed, an approved booking holds, anything else waits. */
function defaultTone(e: CalendarEntry): CalendarTone {
  if (e.kind === "closure") return "closed";
  return e.status === "approved" ? "held" : "pending";
}

const TONE_CLASS: Record<CalendarTone, string> = {
  closed: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  held: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const time = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone });

export function FacilityCalendar({
  entries,
  onPick,
  timeZone,
  tone = defaultTone,
  labels = DEFAULT_LABELS,
}: {
  entries: CalendarEntry[];
  /** Clicking a day offers to book it. */
  onPick?: (dayIso: string) => void;
  /** Bucket days, "today" and times in this zone. Default: the browser's. */
  timeZone?: string;
  /** Which colour an entry gets. */
  tone?: (e: CalendarEntry) => CalendarTone;
  /** Translated words. Default: the English Facilities has always shown. */
  labels?: CalendarLabels;
}) {
  // "Today" as a calendar date in the zone, held as a local Date for the grid.
  const zonedToday = () => {
    const [y, m, d] = dayKeyIn(new Date(), timeZone).split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const [cursor, setCursor] = useState(() => startOfMonth(zonedToday()));

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      for (const day of daysCovered(e.startsAt, e.endsAt, timeZone)) {
        const list = m.get(day);
        if (list) list.push(e);
        else m.set(day, [e]);
      }
    }
    return m;
  }, [entries, timeZone]);

  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    // Monday-first: a church week runs to Sunday, so Sunday belongs at the end
    // where the services are, not at the start.
    const lead = (first.getDay() + 6) % 7;
    const out: { date: Date; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(first);
      d.setDate(1 - lead + i);
      out.push({ date: d, inMonth: d.getMonth() === first.getMonth() });
    }
    return out;
  }, [cursor]);

  const todayIso = dayKeyIn(new Date(), timeZone);
  const monthLabel = cursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold tracking-tight">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label={labels.prev} onClick={() => setCursor((c) => addMonths(c, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(startOfMonth(zonedToday()))}>
            {labels.today}
          </Button>
          <Button variant="outline" size="icon" aria-label={labels.next} onClick={() => setCursor((c) => addMonths(c, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div className="bg-muted/50 grid grid-cols-7">
          {labels.weekdays.map((d) => (
            <div key={d} className="text-muted-foreground px-1 py-1.5 text-center text-[11px] font-bold">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map(({ date, inMonth }) => {
            const iso = ymd(date);
            const day = byDay.get(iso) ?? [];
            const isToday = iso === todayIso;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => onPick?.(iso)}
                className={cn(
                  "min-h-20 border-t border-r p-1 text-left align-top transition last:border-r-0",
                  !inMonth && "bg-muted/30",
                  onPick && "hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "inline-grid size-6 place-items-center rounded-full text-xs font-semibold",
                    !inMonth && "text-muted-foreground/60",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  {date.getDate()}
                </span>
                <span className="mt-0.5 flex flex-col gap-0.5">
                  {day.slice(0, 3).map((e) => (
                    <span
                      key={e.id + iso}
                      title={`${e.facilityName} · ${e.title} · ${time(e.startsAt, timeZone)}`}
                      className={cn(
                        "truncate rounded px-1 py-0.5 text-[10px] leading-tight font-medium",
                        TONE_CLASS[tone(e)],
                      )}
                    >
                      {e.kind === "closure" && <Lock className="mr-0.5 inline size-2.5" />}
                      {e.title}
                    </span>
                  ))}
                  {day.length > 3 && (
                    <span className="text-muted-foreground px-1 text-[10px] font-semibold">
                      {labels.more(day.length - 3)}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-emerald-500/40" /> {labels.legend.held}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-amber-500/40" /> {labels.legend.pending}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-slate-500/40" /> {labels.legend.closed}
        </span>
      </div>
    </div>
  );
}
