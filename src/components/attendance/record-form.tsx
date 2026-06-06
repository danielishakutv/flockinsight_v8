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
  const [men, setMen] = useState(initial?.maleCount ?? 0);
  const [women, setWomen] = useState(initial?.femaleCount ?? 0);
  const [children, setChildren] = useState(initial?.childrenCount ?? 0);
  const [firstTimers, setFirstTimers] = useState(initial?.firstTimerCount ?? 0);
  const [newConverts, setNewConverts] = useState(initial?.newConvertCount ?? 0);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [showNotes, setShowNotes] = useState(!!initial?.notes);

  const total = men + women + children;
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
        maleCount: men,
        femaleCount: women,
        childrenCount: children,
        firstTimerCount: firstTimers,
        newConvertCount: newConverts,
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
                Men + Women + Children
              </div>
            </div>
          </div>
          <div className="text-4xl font-extrabold tabular-nums sm:text-5xl">
            {total}
          </div>
        </CardContent>
      </Card>

      {/* Headcount */}
      <section className="space-y-2">
        <h2 className="text-muted-foreground px-1 text-xs font-bold uppercase tracking-wider">
          Headcount
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <Stepper label="Men" value={men} onChange={setMen} accent />
          <Stepper label="Women" value={women} onChange={setWomen} accent />
          <div className="col-span-2">
            <Stepper
              label="Children"
              value={children}
              onChange={setChildren}
              accent
            />
          </div>
        </div>
      </section>

      {/* Highlights */}
      <section className="space-y-2">
        <h2 className="text-muted-foreground px-1 text-xs font-bold uppercase tracking-wider">
          First-timers &amp; converts
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <Stepper
            label="First-timers"
            hint="incl. above"
            value={firstTimers}
            onChange={setFirstTimers}
          />
          <Stepper
            label="New converts"
            hint="incl. above"
            value={newConverts}
            onChange={setNewConverts}
          />
        </div>
      </section>

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
