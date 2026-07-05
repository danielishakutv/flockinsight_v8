"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, StickyNote, Users } from "lucide-react";
import { toast } from "sonner";
import {
  recordAttendance,
  type RecordAttendanceInput,
} from "@/app/(app)/attendance/actions";
import { Stepper } from "@/components/attendance/stepper";
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

export type ServiceOption = { id: string; name: string };

const ADHOC = "__adhoc__";

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

type Initial = Partial<RecordAttendanceInput> & { id?: string };

/** A "Male / Female" stepper pair with a group heading. */
function GenderGroup({
  title,
  male,
  female,
  onMale,
  onFemale,
  accent,
  hint,
  legacyNote,
}: {
  title: string;
  male: number;
  female: number;
  onMale: (n: number) => void;
  onFemale: (n: number) => void;
  accent?: boolean;
  hint?: string;
  legacyNote?: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-muted-foreground px-1 text-xs font-bold uppercase tracking-wider">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <Stepper
          label="Male"
          hint={hint}
          value={male}
          onChange={onMale}
          accent={accent}
        />
        <Stepper
          label="Female"
          hint={hint}
          value={female}
          onChange={onFemale}
          accent={accent}
        />
      </div>
      {legacyNote && (
        <p className="text-muted-foreground px-1 text-xs">{legacyNote}</p>
      )}
    </div>
  );
}

export function RecordForm({
  services,
  initial,
}: {
  services: ServiceOption[];
  initial?: Initial;
}) {
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
  // Children / first-timers / converts by gender.
  const [childM, setChildM] = useState(initial?.childMaleCount ?? 0);
  const [childF, setChildF] = useState(initial?.childFemaleCount ?? 0);
  const [ftM, setFtM] = useState(initial?.firstTimerMaleCount ?? 0);
  const [ftF, setFtF] = useState(initial?.firstTimerFemaleCount ?? 0);
  const [ncM, setNcM] = useState(initial?.newConvertMaleCount ?? 0);
  const [ncF, setNcF] = useState(initial?.newConvertFemaleCount ?? 0);

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

  const total = adultM + adultF + teenM + teenF + childrenTotal;
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
            <Label htmlFor="service">Service</Label>
            <Select value={serviceKey} onValueChange={setServiceKey}>
              <SelectTrigger id="service" size="lg" className="w-full">
                <SelectValue placeholder="Choose a service" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
                <SelectItem value={ADHOC}>Other / one-off event</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
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
              <Label htmlFor="title">Event name</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Crusade, Vigil, Special Program"
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
                Adults + Teens + Children
              </div>
            </div>
          </div>
          <div className="text-4xl font-extrabold tabular-nums sm:text-5xl">
            {total}
          </div>
        </CardContent>
      </Card>

      {/* Headcount */}
      <GenderGroup
        title="Adults"
        male={adultM}
        female={adultF}
        onMale={setAdultM}
        onFemale={setAdultF}
        accent
      />
      <GenderGroup
        title="Teens"
        male={teenM}
        female={teenF}
        onMale={setTeenM}
        onFemale={setTeenF}
        accent
      />
      <GenderGroup
        title="Children"
        male={childM}
        female={childF}
        onMale={setChildM}
        onFemale={setChildF}
        accent
        legacyNote={
          legacyChildren > 0 && childM + childF === 0
            ? `${legacyChildren} children were recorded without a gender split — that number stays in the total until you enter one.`
            : undefined
        }
      />

      {/* Highlights */}
      <GenderGroup
        title="First-timers"
        male={ftM}
        female={ftF}
        onMale={setFtM}
        onFemale={setFtF}
        hint="incl. above"
        legacyNote={
          legacyFirstTimers > 0 && ftM + ftF === 0
            ? `${legacyFirstTimers} first-timer${legacyFirstTimers === 1 ? " was" : "s were"} recorded without a gender split.`
            : undefined
        }
      />
      <GenderGroup
        title="New converts"
        male={ncM}
        female={ncF}
        onMale={setNcM}
        onFemale={setNcF}
        hint="incl. above"
        legacyNote={
          legacyNewConverts > 0 && ncM + ncF === 0
            ? `${legacyNewConverts} new convert${legacyNewConverts === 1 ? " was" : "s were"} recorded without a gender split.`
            : undefined
        }
      />

      {/* Notes (collapsed by default) */}
      {showNotes ? (
        <div className="space-y-2">
          <Label htmlFor="notes">Note</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything notable about this service…"
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
