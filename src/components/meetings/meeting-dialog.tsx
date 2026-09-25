"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveMeeting, type MeetingInput } from "@/app/(app)/meetings/actions";
import {
  MEETING_ACCESS_LABEL,
  MEETING_KIND_LABEL,
  MEETING_KINDS,
  type MeetingAccess,
  type MeetingKind,
} from "@/lib/meetings-shared";

export type MeetingFormValues = {
  id?: string;
  title: string;
  description: string;
  kind: MeetingKind;
  scheduledFor: string;
  durationMin: number;
  access: MeetingAccess;
  lobby: boolean;
  maxParticipants: number;
  muteOnEntry: boolean;
  cameraOffOnEntry: boolean;
  allowChat: boolean;
  allowReactions: boolean;
  allowScreenShare: boolean;
  allowRecording: boolean;
  lowDataDefault: boolean;
};

export const BLANK_MEETING: MeetingFormValues = {
  title: "",
  description: "",
  kind: "meeting",
  scheduledFor: "",
  durationMin: 60,
  access: "open",
  lobby: false,
  maxParticipants: 12,
  muteOnEntry: true,
  cameraOffOnEntry: false,
  allowChat: true,
  allowReactions: true,
  allowScreenShare: true,
  allowRecording: true,
  lowDataDefault: false,
};

/**
 * Create or edit a meeting.
 *
 * Deliberately short. Everything that has a sensible answer already has one,
 * and the advanced settings are behind a disclosure — a pastor scheduling
 * Wednesday prayer should be able to type a name and press the button.
 */
export function MeetingDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: MeetingFormValues;
  onSaved?: (result: { id: string; code: string }) => void;
}) {
  const [values, setValues] = useState<MeetingFormValues>(initial);
  const [advanced, setAdvanced] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const editing = !!initial.id;

  // Re-seed whenever the dialog is opened on a different meeting.
  const [seed, setSeed] = useState(initial.id ?? "new");
  if (open && seed !== (initial.id ?? "new")) {
    setSeed(initial.id ?? "new");
    setValues(initial);
  }

  const set = <K extends keyof MeetingFormValues>(key: K, v: MeetingFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveMeeting({ ...values, id: initial.id } as MeetingInput);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "Meeting updated." : "Meeting created.");
      onOpenChange(false);
      if (res.id && res.code) onSaved?.({ id: res.id, code: res.code });
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit meeting" : "New meeting"}</DialogTitle>
          <DialogDescription>
            Everyone joins from one link — no app, no account needed.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="m-title" className="mb-1.5 block">
              What is it?
            </Label>
            <Input
              id="m-title"
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Midweek prayer"
              maxLength={160}
              required
              autoFocus
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block">Kind</Label>
              <Select value={values.kind} onValueChange={(v) => set("kind", v as MeetingKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEETING_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {MEETING_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="m-duration" className="mb-1.5 block">
                How long (minutes)
              </Label>
              <Input
                id="m-duration"
                type="number"
                min={5}
                max={600}
                value={values.durationMin}
                onChange={(e) => set("durationMin", Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="m-when" className="mb-1.5 block">
              When <span className="text-muted-foreground">(leave blank to start now)</span>
            </Label>
            <Input
              id="m-when"
              type="datetime-local"
              value={values.scheduledFor}
              onChange={(e) => set("scheduledFor", e.target.value)}
            />
          </div>

          <div>
            <Label className="mb-1.5 block">Who can join</Label>
            <Select
              value={values.access}
              onValueChange={(v) => set("access", v as MeetingAccess)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MEETING_ACCESS_LABEL) as MeetingAccess[]).map((a) => (
                  <SelectItem key={a} value={a}>
                    {MEETING_ACCESS_LABEL[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {values.access === "passcode" && (
              <p className="text-muted-foreground mt-1 text-xs">
                We&apos;ll generate a 6-digit passcode you can read out.
              </p>
            )}
          </div>

          <Toggle
            label="Low data mode by default"
            hint="Everyone starts audio-only. The right setting for a prayer meeting people join on mobile data."
            checked={values.lowDataDefault}
            onChange={(v) => set("lowDataDefault", v)}
          />

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="text-muted-foreground hover:text-foreground text-sm font-medium underline-offset-2 hover:underline"
          >
            {advanced ? "Hide" : "Show"} more settings
          </button>

          {advanced && (
            <div className="space-y-3 rounded-xl border p-3">
              <div>
                <Label htmlFor="m-desc" className="mb-1.5 block">
                  Description
                </Label>
                <Textarea
                  id="m-desc"
                  value={values.description}
                  onChange={(e) => set("description", e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="What this meeting is for."
                />
              </div>

              <div>
                <Label htmlFor="m-max" className="mb-1.5 block">
                  Most people at once
                </Label>
                <Input
                  id="m-max"
                  type="number"
                  min={2}
                  max={30}
                  value={values.maxParticipants}
                  onChange={(e) => set("maxParticipants", Number(e.target.value))}
                />
                <p className="text-muted-foreground mt-1 text-xs">
                  Everyone&apos;s video goes to everyone else, so quality falls as
                  the room grows. Twelve is comfortable; beyond about sixteen, a
                  livestream is the better tool.
                </p>
              </div>

              <Toggle
                label="Wait in a lobby"
                hint="You let each person in. Worth it for counselling or a board meeting."
                checked={values.lobby}
                onChange={(v) => set("lobby", v)}
              />
              <Toggle
                label="Mute people as they arrive"
                checked={values.muteOnEntry}
                onChange={(v) => set("muteOnEntry", v)}
              />
              <Toggle
                label="Cameras off as they arrive"
                checked={values.cameraOffOnEntry}
                onChange={(v) => set("cameraOffOnEntry", v)}
              />
              <Toggle
                label="Allow chat"
                checked={values.allowChat}
                onChange={(v) => set("allowChat", v)}
              />
              <Toggle
                label="Allow reactions"
                checked={values.allowReactions}
                onChange={(v) => set("allowReactions", v)}
              />
              <Toggle
                label="Let anyone share their screen"
                hint="Hosts always can."
                checked={values.allowScreenShare}
                onChange={(v) => set("allowScreenShare", v)}
              />
              <Toggle
                label="Allow recording"
                hint="Only a host can start one, and everyone is told when they do."
                checked={values.allowRecording}
                onChange={(v) => set("allowRecording", v)}
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !values.title.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              {editing ? "Save changes" : "Create meeting"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="text-muted-foreground mt-0.5 block text-xs">{hint}</span>}
      </span>
    </label>
  );
}
