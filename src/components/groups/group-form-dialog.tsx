"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveGroup, type GroupInput } from "@/app/(app)/groups/actions";
import { GROUP_TYPES, TYPE_LABEL, DAY_LABEL, type GroupType } from "@/components/groups/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

export type GroupFormValue = {
  id?: string;
  name: string;
  type: GroupType;
  description: string | null;
  leaderId: string | null;
  meetingDay: number | null;
  meetingTime: string | null;
  isActive: boolean;
};

type Candidate = { id: string; name: string };

const NONE = "__none__";

export function emptyGroup(): GroupFormValue {
  return {
    name: "",
    type: "ministry",
    description: null,
    leaderId: null,
    meetingDay: null,
    meetingTime: null,
    isActive: true,
  };
}

export function GroupFormDialog({
  open,
  onOpenChange,
  initial,
  candidates,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: GroupFormValue;
  candidates: Candidate[];
  onSaved?: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<GroupFormValue>(initial ?? emptyGroup());

  // Reset the form whenever the dialog is (re)opened.
  const [seen, setSeen] = useState(false);
  if (open && !seen) {
    setForm(initial ?? emptyGroup());
    setSeen(true);
  }
  if (!open && seen) setSeen(false);

  const set = (patch: Partial<GroupFormValue>) =>
    setForm((f) => ({ ...f, ...patch }));

  function save() {
    startTransition(async () => {
      const input: GroupInput = {
        id: form.id,
        name: form.name,
        type: form.type,
        description: form.description ?? "",
        leaderId: form.leaderId ?? "",
        meetingDay: form.meetingDay,
        meetingTime: form.meetingTime ?? "",
        isActive: form.isActive,
      };
      const res = await saveGroup(input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(form.id ? "Group updated" : "Group created");
      onOpenChange(false);
      router.refresh();
      onSaved?.(res.id);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit group" : "New group"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="g-name">Name</Label>
            <Input
              id="g-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. Choir, Ushering, Youth Cell"
              autoFocus
            />
          </div>

          <div className={form.id ? "" : "grid grid-cols-2 gap-3"}>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => set({ type: v as GroupType })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Only seed a single leader at creation; add more heads/leaders
                afterwards from the group's member list. */}
            {!form.id && (
              <div className="space-y-2">
                <Label>Leader / head</Label>
                <Select
                  value={form.leaderId ?? NONE}
                  onValueChange={(v) => set({ leaderId: v === NONE ? null : v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>No leader yet</SelectItem>
                    {candidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Meeting day</Label>
              <Select
                value={form.meetingDay === null ? NONE : String(form.meetingDay)}
                onValueChange={(v) =>
                  set({ meetingDay: v === NONE ? null : Number(v) })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No fixed day</SelectItem>
                  {DAY_LABEL.map((d, i) => (
                    <SelectItem key={d} value={String(i)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="g-time">Meeting time</Label>
              <Input
                id="g-time"
                type="time"
                value={form.meetingTime ?? ""}
                onChange={(e) => set({ meetingTime: e.target.value || null })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="g-desc">Description</Label>
            <Textarea
              id="g-desc"
              value={form.description ?? ""}
              onChange={(e) => set({ description: e.target.value || null })}
              placeholder="What this group does (optional)"
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-semibold">Active</p>
              <p className="text-muted-foreground text-xs">
                Inactive groups are hidden from quick pickers.
              </p>
            </div>
            <Switch
              checked={form.isActive}
              onCheckedChange={(c) => set({ isActive: c })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !form.name.trim()}>
            {pending && <Loader2 className="animate-spin" />}
            {form.id ? "Save changes" : "Create group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
