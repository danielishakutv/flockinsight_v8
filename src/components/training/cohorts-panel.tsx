"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteCohort,
  saveCohort,
  type CohortInput,
} from "@/app/(app)/training/actions";
import { COHORT_STATUSES, type CohortStatus } from "@/lib/training-shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CohortRowView = {
  id: string;
  name: string;
  status: CohortStatus;
  startDate: string | null;
  endDate: string | null;
  venue: string | null;
  meetingDay: number | null;
  meetingTime: string | null;
  capacity: number | null;
  notes: string | null;
  enrolled: number;
  completed: number;
};

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const STATUS_CLASS: Record<CohortStatus, string> = {
  upcoming: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  running: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  completed: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-slate-500/12 text-slate-600 dark:text-slate-400",
};

type FormState = {
  id?: string;
  name: string;
  status: CohortStatus;
  startDate: string;
  endDate: string;
  venue: string;
  meetingDay: string;
  meetingTime: string;
  capacity: string;
  notes: string;
};

const EMPTY: FormState = {
  name: "",
  status: "upcoming",
  startDate: "",
  endDate: "",
  venue: "",
  meetingDay: "",
  meetingTime: "",
  capacity: "",
  notes: "",
};

function fmt(d: string | null) {
  if (!d) return null;
  const parsed = new Date(`${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CohortsPanel({
  courseId,
  courseName,
  cohorts,
  canManage,
}: {
  courseId: string;
  courseName: string;
  cohorts: CohortRowView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function openNew() {
    // Most churches name a run by when it happens, so offer that as a start.
    const year = new Date().getFullYear();
    setForm({ ...EMPTY, name: `${courseName} ${year}` });
    setOpen(true);
  }

  function openEdit(c: CohortRowView) {
    setForm({
      id: c.id,
      name: c.name,
      status: c.status,
      startDate: c.startDate ?? "",
      endDate: c.endDate ?? "",
      venue: c.venue ?? "",
      meetingDay: c.meetingDay == null ? "" : String(c.meetingDay),
      meetingTime: c.meetingTime ?? "",
      capacity: c.capacity == null ? "" : String(c.capacity),
      notes: c.notes ?? "",
    });
    setOpen(true);
  }

  function save() {
    const payload: CohortInput = {
      id: form.id,
      courseId,
      name: form.name,
      status: form.status,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      venue: form.venue || null,
      meetingDay: form.meetingDay === "" ? null : Number(form.meetingDay),
      meetingTime: form.meetingTime || null,
      capacity: form.capacity === "" ? null : Number(form.capacity),
      notes: form.notes || null,
    };

    startTransition(async () => {
      const res = await saveCohort(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(form.id ? "Saved" : "Class created");
      setOpen(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteCohort(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Deleted");
      setConfirmId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold tracking-tight">Classes</h2>
        {canManage && (
          <Button size="sm" onClick={openNew}>
            <Plus className="size-4" /> New class
          </Button>
        )}
      </div>

      {cohorts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <CalendarDays className="text-muted-foreground/50 mx-auto size-8" />
            <p className="mt-2 font-bold">No classes yet</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm">
              A class is one running of this course — the January intake, the
              2026 set. Enrol people into a class, not the course itself.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {cohorts.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-start gap-3">
                <Link
                  href={`/training/cohorts/${c.id}`}
                  className="flex min-w-0 flex-1 items-start gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate font-bold">{c.name}</p>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-bold",
                          STATUS_CLASS[c.status],
                        )}
                      >
                        {
                          COHORT_STATUSES.find((s) => s.value === c.status)
                            ?.label
                        }
                      </span>
                    </div>

                    <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      {fmt(c.startDate) && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="size-3" />
                          {fmt(c.startDate)}
                          {fmt(c.endDate) && ` – ${fmt(c.endDate)}`}
                        </span>
                      )}
                      {c.meetingDay != null && (
                        <span>
                          {DAYS[c.meetingDay]}
                          {c.meetingTime && ` ${c.meetingTime}`}
                        </span>
                      )}
                      {c.venue && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" />
                          {c.venue}
                        </span>
                      )}
                    </div>

                    <p className="text-muted-foreground mt-1 text-[11px] font-semibold">
                      {c.enrolled} enrolled
                      {c.capacity != null && ` of ${c.capacity}`} ·{" "}
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {c.completed} completed
                      </span>
                    </p>
                  </div>
                  <ChevronRight className="text-muted-foreground/60 mt-1 size-4 shrink-0" />
                </Link>

                {canManage &&
                  (confirmId === c.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => remove(c.id)}
                        disabled={pending}
                      >
                        Delete
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        onClick={() => openEdit(c)}
                        aria-label={`Edit ${c.name}`}
                        className="hover:bg-accent text-muted-foreground rounded-md p-1.5"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(c.id)}
                        aria-label={`Delete ${c.name}`}
                        className="hover:bg-destructive/10 hover:text-destructive text-muted-foreground rounded-md p-1.5"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit class" : "New class"}</DialogTitle>
            <DialogDescription>
              One running of {courseName}. People enrol here.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ch-name">Name</Label>
              <Input
                id="ch-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    setForm({ ...form, status: v as CohortStatus })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COHORT_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ch-cap">Capacity</Label>
                <Input
                  id="ch-cap"
                  type="number"
                  min={1}
                  value={form.capacity}
                  onChange={(e) =>
                    setForm({ ...form, capacity: e.target.value })
                  }
                  placeholder="No limit"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ch-start">Starts</Label>
                <Input
                  id="ch-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ch-end">Ends</Label>
                <Input
                  id="ch-end"
                  type="date"
                  value={form.endDate}
                  onChange={(e) =>
                    setForm({ ...form, endDate: e.target.value })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label>Meets on</Label>
                <Select
                  value={form.meetingDay || "__none__"}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      meetingDay: v === "__none__" ? "" : v,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No fixed day" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No fixed day</SelectItem>
                    {DAYS.map((d, i) => (
                      <SelectItem key={d} value={String(i)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ch-time">Time</Label>
                <Input
                  id="ch-time"
                  type="time"
                  value={form.meetingTime}
                  onChange={(e) =>
                    setForm({ ...form, meetingTime: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ch-venue">Venue</Label>
              <Input
                id="ch-venue"
                value={form.venue}
                onChange={(e) => setForm({ ...form, venue: e.target.value })}
                placeholder="Main auditorium"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ch-notes">Notes</Label>
              <Textarea
                id="ch-notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !form.name.trim()}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              {form.id ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
