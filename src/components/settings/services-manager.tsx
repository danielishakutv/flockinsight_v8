"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createService,
  updateService,
  deleteService,
} from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
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

export type ServiceRow = {
  id: string;
  name: string;
  dayOfWeek: number | null;
  startTime: string | null;
  isActive: boolean;
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
const NO_DAY = "none";

function dayTimeLabel(s: ServiceRow) {
  const parts: string[] = [];
  if (s.dayOfWeek !== null) parts.push(DAYS[s.dayOfWeek]);
  if (s.startTime) parts.push(s.startTime);
  return parts.join(" · ") || "No fixed schedule";
}

export function ServicesManager({ services }: { services: ServiceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // form state
  const [name, setName] = useState("");
  const [day, setDay] = useState<string>(NO_DAY);
  const [time, setTime] = useState("");

  function openAdd() {
    setEditing(null);
    setName("");
    setDay(NO_DAY);
    setTime("");
    setOpen(true);
  }
  function openEdit(s: ServiceRow) {
    setEditing(s);
    setName(s.name);
    setDay(s.dayOfWeek === null ? NO_DAY : String(s.dayOfWeek));
    setTime(s.startTime ?? "");
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const payload = {
        name: name.trim(),
        dayOfWeek: day === NO_DAY ? null : Number(day),
        startTime: time || null,
      };
      const res = editing
        ? await updateService({
            id: editing.id,
            ...payload,
            isActive: editing.isActive,
          })
        : await createService(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "Service updated" : "Service added");
      setOpen(false);
      router.refresh();
    });
  }

  function toggleActive(s: ServiceRow, next: boolean) {
    startTransition(async () => {
      const res = await updateService({
        id: s.id,
        name: s.name,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        isActive: next,
      });
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteService(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Service deleted");
      setConfirmId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Services appear as options when recording attendance.
        </p>
        <Button onClick={openAdd} size="lg">
          <Plus className="size-5" />
          Add service
        </Button>
      </div>

      {services.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl">
              <Clock className="size-7" />
            </div>
            <p className="text-muted-foreground">
              No services yet. Add your first one to start recording.
            </p>
            <Button onClick={openAdd}>
              <Plus className="size-5" /> Add service
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {services.map((s) => (
            <div
              key={s.id}
              className="bg-card flex items-center gap-3 rounded-2xl border p-3 shadow-sm sm:p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{s.name}</p>
                <p className="text-muted-foreground text-xs">
                  {dayTimeLabel(s)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <div className="mr-1 flex items-center gap-2">
                  <Switch
                    checked={s.isActive}
                    onCheckedChange={(v) => toggleActive(s, v)}
                    aria-label="Active"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit"
                  onClick={() => openEdit(s)}
                >
                  <Pencil className="size-4" />
                </Button>
                {confirmId === s.id ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => remove(s.id)}
                    disabled={pending}
                  >
                    {pending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      "Confirm"
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete"
                    onClick={() => setConfirmId(s.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit service" : "Add service"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="svc-name">Name</Label>
              <Input
                id="svc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sunday First Service"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="svc-day">Day</Label>
                <Select value={day} onValueChange={setDay}>
                  <SelectTrigger id="svc-day" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DAY}>No fixed day</SelectItem>
                    {DAYS.map((d, i) => (
                      <SelectItem key={d} value={String(i)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="svc-time">Start time</Label>
                <Input
                  id="svc-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="h-11"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !name.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              {editing ? "Save" : "Add service"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
