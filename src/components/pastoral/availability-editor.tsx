"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { weekdayNames } from "@/lib/i18n/formatting";
import { removeClosure, saveHours, savePastorRules } from "@/app/(app)/appointments/actions";
import {
  closureKey,
  hhmmToMinutes,
  minutesToHHMM,
  validateWeeklyHours,
  type WeeklyWindow,
} from "@/lib/pastoral-shared";
import { BlackoutDialog } from "@/components/pastoral/blackout-dialog";
import { PastorRoster } from "@/components/pastoral/pastor-roster";
import type { ClosureItem, PastorItem, TeamOption, TypeItem } from "@/components/pastoral/appointments-browser";

type Row = { key: number; weekday: number; start: string; end: string };

/** Monday first on screen, as the month grid is; stored Sunday = 0. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * A pastor's weekly hours, booking rules and days away.
 *
 * A pastor edits their own; a manager picks anybody. Hours are wall-clock
 * times in the church's zone (said above the grid), checked as they are typed
 * by the same rule the server applies, so an overlap is named before Save.
 */
export function AvailabilityEditor({
  pastors,
  defaultPastorId,
  closures,
  zone,
  today,
  canManage,
  team,
  types,
}: {
  pastors: PastorItem[];
  defaultPastorId: string | null;
  closures: ClosureItem[];
  zone: string;
  today: string;
  canManage: boolean;
  team: TeamOption[];
  types: TypeItem[];
}) {
  const t = useT();
  const [pastorId, setPastorId] = useState<string | null>(
    defaultPastorId && pastors.some((p) => p.id === defaultPastorId) ? defaultPastorId : (pastors[0]?.id ?? null),
  );
  const pastor = pastors.find((p) => p.id === pastorId) ?? null;

  return (
    <div className="space-y-5">
      {pastors.length > 1 && (
        <div className="max-w-xs space-y-1.5">
          <Label>{t("pastoral.availability.forPastor")}</Label>
          <Select value={pastorId ?? ""} onValueChange={setPastorId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pastors.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {pastor ? (
        <PastorAvailability
          key={pastor.id}
          pastor={pastor}
          closures={closures.filter((c) => c.pastorId === pastor.id && c.endsAt >= new Date().toISOString())}
          zone={zone}
          today={today}
        />
      ) : (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-10 text-center text-sm">
          {t("pastoral.empty.noPastors")}
        </p>
      )}

      {canManage && <PastorRoster pastors={pastors} team={team} types={types} />}
    </div>
  );
}

function PastorAvailability({
  pastor,
  closures,
  zone,
  today,
}: {
  pastor: PastorItem;
  closures: ClosureItem[];
  zone: string;
  today: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const days = weekdayNames(t.locale, "long");
  const [seq, setSeq] = useState(pastor.hours.length);
  const [rows, setRows] = useState<Row[]>(() =>
    pastor.hours.map((h, i) => ({
      key: i,
      weekday: h.weekday,
      start: minutesToHHMM(h.startMinute),
      // A time input cannot say 24:00; midnight at the end reads 00:00.
      end: h.endMinute === 1440 ? "00:00" : minutesToHHMM(h.endMinute),
    })),
  );
  const [rules, setRules] = useState({
    slotMinutes: String(pastor.slotMinutes),
    bufferMinutes: String(pastor.bufferMinutes),
    minNoticeHours: String(pastor.minNoticeHours),
    maxAdvanceDays: String(pastor.maxAdvanceDays),
  });
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [blackout, setBlackout] = useState(false);

  // An input left blank or half-typed reads as "not a time" and is refused here.
  const windows: (WeeklyWindow | null)[] = rows.map((r) => {
    const s = hhmmToMinutes(r.start);
    const e = r.end === "00:00" ? 1440 : hhmmToMinutes(r.end);
    return s === null || e === null ? null : { weekday: r.weekday, startMinute: s, endMinute: e };
  });
  const complete = windows.every((w): w is WeeklyWindow => w !== null);
  const live = complete ? validateWeeklyHours(windows as WeeklyWindow[], days) : null;
  const inlineError = !complete
    ? t("pastoral.errors.hoursStep", { day: days[rows[windows.findIndex((w) => w === null)]?.weekday ?? 0] })
    : live && !live.ok
      ? t(live.error.key, live.error.vars)
      : null;

  const addRow = (weekday: number) => {
    setRows((r) => [...r, { key: seq, weekday, start: "09:00", end: "12:00" }]);
    setSeq((n) => n + 1);
  };

  function saveTheHours() {
    if (!live?.ok) return;
    setHoursError(null);
    startTransition(async () => {
      try {
        const res = await saveHours(pastor.id, live.value);
        if (!res.ok) {
          setHoursError(res.error);
          return;
        }
        toast.success(t("pastoral.done.hoursSaved"));
        if (res.outside > 0) toast.warning(t("pastoral.done.hoursOutside", { count: res.outside }));
        router.refresh();
      } catch (e) {
        console.error("[availability] could not save hours", e);
        setHoursError(t("pastoral.errors.network"));
      }
    });
  }

  function saveTheRules() {
    setRulesError(null);
    startTransition(async () => {
      try {
        const res = await savePastorRules(pastor.id, rules);
        if (!res.ok) {
          setRulesError(res.error);
          return;
        }
        toast.success(t("pastoral.done.saved"));
        router.refresh();
      } catch (e) {
        console.error("[availability] could not save rules", e);
        setRulesError(t("pastoral.errors.network"));
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      try {
        const res = await removeClosure(id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        router.refresh();
      } catch (e) {
        console.error("[availability] could not remove days away", e);
        toast.error(t("pastoral.errors.network"));
      }
    });
  }

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(t.intl, {
      timeZone: zone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("pastoral.hours.title")}</CardTitle>
          <p className="text-muted-foreground text-sm">{t("pastoral.hours.hint", { zone })}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {DISPLAY_ORDER.map((wd) => {
            const dayRows = rows.filter((r) => r.weekday === wd);
            return (
              <div key={wd} className="space-y-1.5 border-b pb-3 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{days[wd]}</p>
                  <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => addRow(wd)}>
                    <Plus className="size-3.5" /> {t("pastoral.hours.addWindow")}
                  </Button>
                </div>
                {dayRows.length === 0 && (
                  <p className="text-muted-foreground text-xs">{t("pastoral.availability.notWorking")}</p>
                )}
                {dayRows.map((r) => (
                  <div key={r.key} className="flex flex-wrap items-center gap-2">
                    <Input
                      type="time"
                      step={300}
                      value={r.start}
                      aria-label={`${days[wd]} ${t("pastoral.availability.from")}`}
                      className="w-32"
                      onChange={(e) =>
                        setRows((all) => all.map((x) => (x.key === r.key ? { ...x, start: e.target.value } : x)))
                      }
                    />
                    <span className="text-muted-foreground text-sm">–</span>
                    <Input
                      type="time"
                      step={300}
                      value={r.end}
                      aria-label={`${days[wd]} ${t("pastoral.availability.to")}`}
                      className="w-32"
                      onChange={(e) =>
                        setRows((all) => all.map((x) => (x.key === r.key ? { ...x, end: e.target.value } : x)))
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={t("pastoral.availability.removeWindow")}
                      onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            );
          })}

          {(inlineError || hoursError) && (
            <p role="alert" className="text-destructive text-sm">
              {inlineError ?? hoursError}
            </p>
          )}
          <Button disabled={pending || !live?.ok} onClick={saveTheHours}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("pastoral.availability.saveHours")}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("pastoral.availability.rulesTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["slotMinutes", "pastoral.availability.slotMinutes", 10, 240],
                  ["bufferMinutes", "pastoral.availability.bufferMinutes", 0, 240],
                  ["minNoticeHours", "pastoral.availability.minNoticeHours", 0, 720],
                  ["maxAdvanceDays", "pastoral.availability.maxAdvanceDays", 1, 365],
                ] as const
              ).map(([k, label, min, max]) => (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={`rule-${k}`}>{t(label)}</Label>
                  <Input
                    id={`rule-${k}`}
                    type="number"
                    inputMode="numeric"
                    min={min}
                    max={max}
                    value={rules[k]}
                    onChange={(e) => setRules((r) => ({ ...r, [k]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            {rulesError && (
              <p role="alert" className="text-destructive text-sm">
                {rulesError}
              </p>
            )}
            <Button variant="outline" disabled={pending} onClick={saveTheRules}>
              {t("pastoral.availability.saveRules")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarOff className="size-4" /> {t("pastoral.availability.closuresTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {closures.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("pastoral.availability.noClosures")}</p>
            ) : (
              <ul className="divide-y">
                {closures.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold">{t(closureKey(c.kind))}</span> · {c.reason}
                      <span className="text-muted-foreground block text-xs">
                        {fmt(c.startsAt)} → {fmt(c.endsAt)}
                      </span>
                    </span>
                    <Button variant="ghost" size="sm" className="min-h-11" disabled={pending} onClick={() => remove(c.id)}>
                      {t("pastoral.availability.removeClosure")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" onClick={() => setBlackout(true)}>
              <Plus className="size-4" /> {t("pastoral.availability.addClosure")}
            </Button>
          </CardContent>
        </Card>
      </div>

      {blackout && (
        <BlackoutDialog pastorId={pastor.id} zone={zone} today={today} open onOpenChange={setBlackout} />
      )}
    </div>
  );
}
