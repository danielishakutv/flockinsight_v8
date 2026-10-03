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
import {
  describeRepeat,
  MEETING_REPEATS,
  type MeetingRepeat,
} from "@/lib/meeting-recurrence";
import { useT } from "@/components/i18n-provider";
import type { TKey } from "@/lib/i18n/translate";

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
  repeat: MeetingRepeat;
  /** A local date, "2027-03-31", or blank for a series with no end. */
  repeatUntil: string;
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
  repeat: "none",
  repeatUntil: "",
};

/** What each rule is called in the picker. */
const REPEAT_LABEL: Record<MeetingRepeat, TKey> = {
  none: "meetings.repeatNone",
  daily: "meetings.repeatDaily",
  weekly: "meetings.repeatWeekly",
  fortnightly: "meetings.repeatFortnightly",
  monthly: "meetings.repeatMonthly",
  "monthly-weekday": "meetings.repeatMonthlyWeekday",
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
  const t = useT();
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

  /*
   * "Every Wednesday", from the date that was typed.
   *
   * Shown back rather than left for the person to work out, because the rule is
   * derived from the date and a picker that says "Every week" cannot tell you
   * that you picked a Tuesday by mistake.
   *
   * The datetime-local value is a wall clock with no zone, which is exactly what
   * the church's clock means by it — so it is read as such rather than parsed as
   * the browser's local time.
   */
  const repeatSummary = (() => {
    if (values.repeat === "none" || !values.scheduledFor) return null;
    const [date, time] = values.scheduledFor.split("T");
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = (time ?? "00:00").split(":").map(Number);
    if (!year || !month || !day) return null;
    return describeRepeat(
      values.repeat,
      new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0)),
      "UTC",
    );
  })();

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
              placeholder={t("meetings.midweekPrayer")}
              maxLength={160}
              required
              autoFocus
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block">{t("meetings.kind")}</Label>
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
              onChange={(e) => {
                const when = e.target.value;
                setValues((prev) => ({
                  ...prev,
                  scheduledFor: when,
                  // A repeat is read off this date, so clearing the date clears
                  // the rule rather than leaving "Every week" showing in a
                  // disabled picker over nothing to repeat from.
                  repeat: when ? prev.repeat : "none",
                  repeatUntil: when ? prev.repeatUntil : "",
                }));
              }}
            />
          </div>

          {/*
            Repeating. Below "When" because it is read off it, and it says so
            rather than being quietly ignored when there is no date — a rule
            with nothing to repeat from is the one way this could silently do
            nothing.
          */}
          <div>
            <Label className="mb-1.5 block" htmlFor="m-repeat">
              {t("meetings.repeats")}
            </Label>
            <Select
              value={values.repeat}
              onValueChange={(v) => set("repeat", v as MeetingRepeat)}
              disabled={!values.scheduledFor}
            >
              <SelectTrigger id="m-repeat" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEETING_REPEATS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(REPEAT_LABEL[r])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {!values.scheduledFor ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {t("meetings.repeatNeedsADate")}
              </p>
            ) : (
              values.repeat !== "none" && (
                <div className="mt-2 space-y-2 rounded-xl border p-3">
                  <p className="text-sm font-medium">
                    {repeatSummary ?? t(REPEAT_LABEL[values.repeat])}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t("meetings.repeatHowItWorks")}
                  </p>
                  <div>
                    <Label htmlFor="m-repeat-until" className="mb-1.5 block text-xs">
                      {t("meetings.repeatUntil")}
                    </Label>
                    <Input
                      id="m-repeat-until"
                      type="date"
                      value={values.repeatUntil}
                      min={values.scheduledFor.slice(0, 10)}
                      onChange={(e) => set("repeatUntil", e.target.value)}
                    />
                  </div>
                </div>
              )
            )}
          </div>

          <div>
            <Label className="mb-1.5 block">{t("meetings.whoCanJoin")}</Label>
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
            label={t("meetings.lowDataModeByDefault")}
            hint={t("meetings.everyoneStartsAudioOnlyThe")}
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
                  placeholder={t("meetings.whatThisMeetingIsFor")}
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
                label={t("meetings.waitInALobby")}
                hint={t("meetings.youLetEachPersonIn")}
                checked={values.lobby}
                onChange={(v) => set("lobby", v)}
              />
              <Toggle
                label={t("meetings.mutePeopleAsTheyArrive")}
                checked={values.muteOnEntry}
                onChange={(v) => set("muteOnEntry", v)}
              />
              <Toggle
                label={t("meetings.camerasOffAsTheyArrive")}
                checked={values.cameraOffOnEntry}
                onChange={(v) => set("cameraOffOnEntry", v)}
              />
              <Toggle
                label={t("meetings.allowChat")}
                checked={values.allowChat}
                onChange={(v) => set("allowChat", v)}
              />
              <Toggle
                label={t("meetings.allowReactions")}
                checked={values.allowReactions}
                onChange={(v) => set("allowReactions", v)}
              />
              <Toggle
                label={t("meetings.letAnyoneShareTheirScreen")}
                hint={t("meetings.hostsAlwaysCan")}
                checked={values.allowScreenShare}
                onChange={(v) => set("allowScreenShare", v)}
              />
              <Toggle
                label={t("meetings.allowRecording")}
                hint={t("meetings.onlyAHostCanStart")}
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
