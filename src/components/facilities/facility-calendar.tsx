"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CalendarEntry } from "@/lib/facilities";

/**
 * A month, with what is booked on each day.
 *
 * Deliberately a month grid and not a timetable. A church secretary asks "is
 * the hall free on the 14th?", which a month answers at a glance; an
 * hour-by-hour view answers a question almost nobody has and does not fit on a
 * phone.
 */

const DAY_MS = 86_400_000;

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Every day an entry touches, so a three-day booking shows on all three. */
function daysCovered(startsAt: string, endsAt: string): string[] {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const out: string[] = [];
  const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  // The end is exclusive at midnight: a booking ending 09:00 Tuesday covers
  // Tuesday, but one ending exactly at midnight does not spill into it.
  const last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  const endsAtMidnight =
    e.getHours() === 0 && e.getMinutes() === 0 && e.getSeconds() === 0;
  while (cur.getTime() <= last.getTime()) {
    if (!(endsAtMidnight && cur.getTime() === last.getTime() && out.length > 0)) {
      out.push(ymd(cur));
    }
    cur.setTime(cur.getTime() + DAY_MS);
  }
  return out.length ? out : [ymd(s)];
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function FacilityCalendar({
  entries,
  onPick,
}: {
  entries: CalendarEntry[];
  /** Clicking a day offers to book it. */
  onPick?: (dayIso: string) => void;
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      for (const day of daysCovered(e.startsAt, e.endsAt)) {
        const list = m.get(day);
        if (list) list.push(e);
        else m.set(day, [e]);
      }
    }
    return m;
  }, [entries]);

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

  const todayIso = ymd(new Date());
  const monthLabel = cursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold tracking-tight">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setCursor((c) => addMonths(c, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>
            Today
          </Button>
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setCursor((c) => addMonths(c, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div className="bg-muted/50 grid grid-cols-7">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
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
                      title={`${e.facilityName} · ${e.title} · ${time(e.startsAt)}`}
                      className={cn(
                        "truncate rounded px-1 py-0.5 text-[10px] leading-tight font-medium",
                        e.kind === "closure"
                          ? "bg-slate-500/15 text-slate-700 dark:text-slate-300"
                          : e.status === "approved"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {e.kind === "closure" && <Lock className="mr-0.5 inline size-2.5" />}
                      {e.title}
                    </span>
                  ))}
                  {day.length > 3 && (
                    <span className="text-muted-foreground px-1 text-[10px] font-semibold">
                      +{day.length - 3} more
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
          <span className="size-2.5 rounded-sm bg-emerald-500/40" /> Booked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-amber-500/40" /> Awaiting approval
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-slate-500/40" /> Closed
        </span>
      </div>
    </div>
  );
}
