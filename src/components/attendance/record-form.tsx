"use client";

import { useMemo, useState, useTransition } from "react";
import type { BandDefinition, BandKey } from "@/lib/attendance-bands";
import { useRouter } from "next/navigation";
import { Loader2, StickyNote, Users } from "lucide-react";
import { toast } from "sonner";
import {
  recordAttendance,
  type RecordAttendanceInput,
} from "@/app/(app)/attendance/actions";
import { CountGroup } from "@/components/attendance/count-group";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/i18n-provider";

export type ServiceOption = { id: string; name: string };

const ADHOC = "__adhoc__";

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

type Initial = Partial<RecordAttendanceInput> & { id?: string };

export function RecordForm({
  services,
  initial,
  bands,
}: {
  services: ServiceOption[];
  initial?: Initial;
  /**
   * The bands this church counts, in reading order, already filtered to the
   * enabled ones and carrying the church's own words for each.
   */
  bands: BandDefinition[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [serviceKey, setServiceKey] = useState<string>(
    initial?.serviceId ?? services[0]?.id ?? ADHOC,
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.date ?? todayStr());

  // Adults (historically "Men"/"Women").
  const [adultM, setAdultM] = useState(initial?.maleCount ?? 0);
  const [adultF, setAdultF] = useState(initial?.femaleCount ?? 0);
  // Teens.
  const [teenM, setTeenM] = useState(initial?.teenMaleCount ?? 0);
  const [teenF, setTeenF] = useState(initial?.teenFemaleCount ?? 0);
  // Youths and senior members: optional, and off until a church turns them on.
  const [youthM, setYouthM] = useState(initial?.youthMaleCount ?? 0);
  const [youthF, setYouthF] = useState(initial?.youthFemaleCount ?? 0);
  const [seniorM, setSeniorM] = useState(initial?.seniorMaleCount ?? 0);
  const [seniorF, setSeniorF] = useState(initial?.seniorFemaleCount ?? 0);
  // Children / first-timers / converts by gender.
  const [childM, setChildM] = useState(initial?.childMaleCount ?? 0);
  const [childF, setChildF] = useState(initial?.childFemaleCount ?? 0);
  const [ftM, setFtM] = useState(initial?.firstTimerMaleCount ?? 0);
  const [ftF, setFtF] = useState(initial?.firstTimerFemaleCount ?? 0);
  const [ncM, setNcM] = useState(initial?.newConvertMaleCount ?? 0);
  const [ncF, setNcF] = useState(initial?.newConvertFemaleCount ?? 0);

  /*
   * One group open at a time, identified by key.
   *
   * A new sheet opens on Adults: it is the one band that can never be
   * switched off and the one every church fills in, so the first number an
   * usher has is already asked for with nothing tapped. Editing an existing
   * sheet opens nothing — somebody who came back to fix one figure wants to
   * see all of them first, and every row carries its own subtotal.
   */
  const [openGroup, setOpenGroup] = useState<string | null>(() =>
    initial?.id ? null : (bands.find((b) => b.key === "adults")?.key ?? bands[0]?.key ?? null),
  );
  const toggleGroup = (key: string) =>
    setOpenGroup((current) => (current === key ? null : key));

  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [showNotes, setShowNotes] = useState(!!initial?.notes);

  // Records saved before the gender split only carry totals. Keep those
  // totals until the user actually enters a split.
  const legacyChildren =
    (initial?.childMaleCount ?? 0) + (initial?.childFemaleCount ?? 0) === 0
      ? (initial?.childrenCount ?? 0)
      : 0;
  const legacyFirstTimers =
    (initial?.firstTimerMaleCount ?? 0) + (initial?.firstTimerFemaleCount ?? 0) === 0
      ? (initial?.firstTimerCount ?? 0)
      : 0;
  const legacyNewConverts =
    (initial?.newConvertMaleCount ?? 0) + (initial?.newConvertFemaleCount ?? 0) === 0
      ? (initial?.newConvertCount ?? 0)
      : 0;

  const childrenTotal = childM + childF > 0 ? childM + childF : legacyChildren;
  const firstTimerTotal = ftM + ftF > 0 ? ftM + ftF : legacyFirstTimers;
  const newConvertTotal = ncM + ncF > 0 ? ncM + ncF : legacyNewConverts;

  /*
   * Only the bands this church counts.
   *
   * Children keep their legacy fallback: rows recorded before the gender split
   * have a total and no breakdown, and dropping those people out of the sum
   * would make an old session's figure change the moment somebody opened it.
   */
  const perBand: Record<BandKey, number> = {
    adults: adultM + adultF,
    teens: teenM + teenF,
    youths: youthM + youthF,
    children: childrenTotal,
    seniors: seniorM + seniorF,
  };
  const total = bands.reduce((sum, b) => sum + (perBand[b.key] ?? 0), 0);
  const isAdhoc = serviceKey === ADHOC;

  const canSave = useMemo(() => {
    if (isAdhoc && !title.trim()) return false;
    return date.length === 10;
  }, [isAdhoc, title, date]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await recordAttendance({
        id: initial?.id,
        serviceId: isAdhoc ? null : serviceKey,
        title: isAdhoc ? title.trim() : undefined,
        date,
        maleCount: adultM,
        femaleCount: adultF,
        teenMaleCount: teenM,
        teenFemaleCount: teenF,
        youthMaleCount: youthM,
        youthFemaleCount: youthF,
        seniorMaleCount: seniorM,
        seniorFemaleCount: seniorF,
        childMaleCount: childM,
        childFemaleCount: childF,
        childrenCount: childrenTotal,
        firstTimerMaleCount: ftM,
        firstTimerFemaleCount: ftF,
        firstTimerCount: firstTimerTotal,
        newConvertMaleCount: ncM,
        newConvertFemaleCount: ncF,
        newConvertCount: newConvertTotal,
        notes: notes.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Attendance saved — ${total} present`);
      router.push("/attendance");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Service + date */}
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="service">{t("attendance.service")}</Label>
            <Select value={serviceKey} onValueChange={setServiceKey}>
              <SelectTrigger id="service" size="lg" className="w-full">
                <SelectValue placeholder={t("attendance.chooseAService")} />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
                <SelectItem value={ADHOC}>{t("attendance.otherOneOffEvent")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">{t("attendance.date")}</Label>
            <Input
              id="date"
              type="date"
              value={date}
              max={todayStr()}
              onChange={(e) => setDate(e.target.value)}
              className="h-11"
            />
          </div>
          {isAdhoc && (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="title">{t("attendance.eventName")}</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("attendance.eGCrusadeVigilSpecial")}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Total banner */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-center justify-between gap-3 py-1">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary/15 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
              <Users className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight">
                Total attendance
              </div>
              <div className="text-muted-foreground text-xs leading-tight">
                {bands.map((b) => b.label).join(" + ")}
              </div>
            </div>
          </div>
          <div className="text-4xl font-extrabold tabular-nums sm:text-5xl">
            {total}
          </div>
        </CardContent>
      </Card>

      {/*
        Headcount, in the church's own words, only the bands it counts, and
        oldest first — Senior members down to Children, the order an usher's
        sheet runs in. A church with no youth fellowship never sees a Youths
        box to leave at zero, which is the difference between a form that fits
        and one that has to be worked around every Sunday.

        One group is open at a time. Closing the previous one keeps every band
        on a single screen, so the next number is always a tap away rather
        than a scroll, and each closed row still shows its own subtotal.
      */}
      <div className="space-y-2">
        {bands.map((b) => {
          const state = {
            adults: { male: adultM, female: adultF, onMale: setAdultM, onFemale: setAdultF },
            teens: { male: teenM, female: teenF, onMale: setTeenM, onFemale: setTeenF },
            youths: { male: youthM, female: youthF, onMale: setYouthM, onFemale: setYouthF },
            children: { male: childM, female: childF, onMale: setChildM, onFemale: setChildF },
            seniors: { male: seniorM, female: seniorF, onMale: setSeniorM, onFemale: setSeniorF },
          }[b.key];

          return (
            <CountGroup
              key={b.key}
              id={`band-${b.key}`}
              title={b.label}
              male={state.male}
              female={state.female}
              onMale={state.onMale}
              onFemale={state.onFemale}
              open={openGroup === b.key}
              onToggle={() => toggleGroup(b.key)}
              carried={b.key === "children" ? legacyChildren : 0}
              note={
                b.key === "children" && legacyChildren > 0 && childM + childF === 0
                  ? `${legacyChildren} children were recorded without a gender split — that number stays in the total until you enter one.`
                  : undefined
              }
            />
          );
        })}
      </div>

      {/*
        Highlights. Same rows, but visually quieter and under a heading that
        says why their numbers are not added on: these people are already
        among the counts above, and adding them counts somebody twice.
      */}
      <div className="space-y-2">
        <h3 className="text-muted-foreground px-1 text-xs font-bold uppercase tracking-wider">
          Also among the above
        </h3>
        <CountGroup
          id="first-timers"
          title={t("attendance.firstTimers")}
          subtitle="Already counted above"
          muted
          male={ftM}
          female={ftF}
          onMale={setFtM}
          onFemale={setFtF}
          open={openGroup === "first-timers"}
          onToggle={() => toggleGroup("first-timers")}
          carried={legacyFirstTimers}
          note={
            legacyFirstTimers > 0 && ftM + ftF === 0
              ? `${legacyFirstTimers} first-timer${legacyFirstTimers === 1 ? " was" : "s were"} recorded without a gender split.`
              : undefined
          }
        />
        <CountGroup
          id="new-converts"
          title={t("attendance.newConverts")}
          subtitle="Already counted above"
          muted
          male={ncM}
          female={ncF}
          onMale={setNcM}
          onFemale={setNcF}
          open={openGroup === "new-converts"}
          onToggle={() => toggleGroup("new-converts")}
          carried={legacyNewConverts}
          note={
            legacyNewConverts > 0 && ncM + ncF === 0
              ? `${legacyNewConverts} new convert${legacyNewConverts === 1 ? " was" : "s were"} recorded without a gender split.`
              : undefined
          }
        />
      </div>

      {/* Notes (collapsed by default) */}
      {showNotes ? (
        <div className="space-y-2">
          <Label htmlFor="notes">{t("attendance.note")}</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("attendance.anythingNotableAboutThisService")}
            autoFocus
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowNotes(true)}
          className="text-muted-foreground hover:text-foreground hover:border-primary/40 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-sm font-medium transition-colors"
        >
          <StickyNote className="size-4" />
          Add a note
        </button>
      )}

      <div className="sticky bottom-20 z-10 lg:bottom-4">
        <Button
          type="submit"
          size="xl"
          className="w-full shadow-lg"
          disabled={!canSave || pending}
        >
          {pending && <Loader2 className="animate-spin" />}
          {initial?.id ? "Update attendance" : "Save attendance"}
        </Button>
      </div>
    </form>
  );
}
