"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Cake, Heart, Loader2, PartyPopper, Send } from "lucide-react";
import { toast } from "sonner";
import {
  saveCelebrations,
  sendTestCelebration,
  type CelebrationInput,
} from "@/app/(app)/settings/celebrations/actions";
import type { QueueItem } from "@/lib/celebrations";
import {
  BIRTHDAY_PRESETS,
  ANNIVERSARY_PRESETS,
  type CelebrationPreset,
} from "@/lib/celebration-templates";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type State = CelebrationInput;

const PLACEHOLDERS = ["{name}", "{church}", "{occasion}", "{years}"];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors " +
        (checked ? "bg-primary" : "bg-muted-foreground/30")
      }
      aria-pressed={checked}
    >
      <span
        className={
          "inline-block size-5 transform rounded-full bg-white shadow transition-transform " +
          (checked ? "translate-x-5" : "translate-x-0.5")
        }
      />
    </button>
  );
}

function ToggleRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground text-xs">{desc}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

/** A row of preset templates the church can apply to fill the fields below. */
function PresetRow({
  presets,
  onApply,
}: {
  presets: CelebrationPreset[];
  onApply: (p: CelebrationPreset) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground text-xs font-medium">Templates:</span>
      {presets.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onApply(p)}
          className="hover:bg-primary/10 hover:text-primary hover:border-primary/40 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

export function CelebrationsForm({
  initial,
  timezone,
  smsApproved,
  queue,
}: {
  initial: State;
  timezone: string;
  smsApproved: boolean;
  queue: QueueItem[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();
  const [f, setF] = useState<State>(initial);
  const set = (patch: Partial<State>) => setF((p) => ({ ...p, ...patch }));

  function save() {
    start(async () => {
      const res = await saveCelebrations(f);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Celebration settings saved");
      router.refresh();
    });
  }
  function test() {
    startTest(async () => {
      const res = await sendTestCelebration(f);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Test email sent to you");
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <PartyPopper className="text-primary size-5" /> Birthdays & anniversaries
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            title="Send automatic wishes"
            desc="Email/SMS members on their birthday & anniversaries."
            checked={f.enabled}
            onChange={(v) => set({ enabled: v })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ToggleRow
              title="Email"
              desc="Free, to members with an email."
              checked={f.email}
              onChange={(v) => set({ email: v })}
            />
            <ToggleRow
              title="SMS"
              desc="Uses your SMS wallet."
              checked={f.sms}
              onChange={(v) => set({ sms: v })}
            />
          </div>
          {f.sms && !smsApproved && (
            <p className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-xs font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-4 shrink-0" />
              Your SMS sender ID isn&apos;t approved yet — apply in Settings → SMS.
            </p>
          )}
          <div className="max-w-xs space-y-2">
            <Label htmlFor="sendTime">Send at</Label>
            <Input
              id="sendTime"
              type="time"
              value={f.sendTime}
              onChange={(e) => set({ sendTime: e.target.value })}
              className="h-11"
            />
            <p className="text-muted-foreground text-xs">Your timezone ({timezone}).</p>
          </div>
        </CardContent>
      </Card>

      {/* Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Messages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {PLACEHOLDERS.map((p) => (
              <code key={p} className="bg-muted rounded px-1.5 py-0.5 text-xs font-semibold">
                {p}
              </code>
            ))}
            <span className="text-muted-foreground text-xs">
              auto-fill. {"{occasion}"} & {"{years}"} apply to anniversaries.
            </span>
          </div>

          <div className="space-y-3 rounded-xl border p-3">
            <p className="flex items-center gap-2 text-sm font-bold">
              <Cake className="text-primary size-4" /> Birthday
            </p>
            <PresetRow
              presets={BIRTHDAY_PRESETS}
              onApply={(p) =>
                set({
                  birthdayEmailSubject: p.emailSubject,
                  birthdayEmailBody: p.emailBody,
                  birthdaySms: p.sms,
                })
              }
            />
            {f.email && (
              <>
                <Input
                  value={f.birthdayEmailSubject}
                  onChange={(e) => set({ birthdayEmailSubject: e.target.value })}
                  placeholder="Email subject"
                />
                <Textarea
                  rows={4}
                  value={f.birthdayEmailBody}
                  onChange={(e) => set({ birthdayEmailBody: e.target.value })}
                  placeholder="Email body"
                />
              </>
            )}
            {f.sms && (
              <Textarea
                rows={2}
                value={f.birthdaySms}
                onChange={(e) => set({ birthdaySms: e.target.value })}
                placeholder="SMS text"
              />
            )}
          </div>

          <div className="space-y-3 rounded-xl border p-3">
            <p className="flex items-center gap-2 text-sm font-bold">
              <Heart className="text-primary size-4" /> Anniversaries (wedding, baptism, custom)
            </p>
            <PresetRow
              presets={ANNIVERSARY_PRESETS}
              onApply={(p) =>
                set({
                  anniversaryEmailSubject: p.emailSubject,
                  anniversaryEmailBody: p.emailBody,
                  anniversarySms: p.sms,
                })
              }
            />
            {f.email && (
              <>
                <Input
                  value={f.anniversaryEmailSubject}
                  onChange={(e) => set({ anniversaryEmailSubject: e.target.value })}
                  placeholder="Email subject"
                />
                <Textarea
                  rows={4}
                  value={f.anniversaryEmailBody}
                  onChange={(e) => set({ anniversaryEmailBody: e.target.value })}
                  placeholder="Email body"
                />
              </>
            )}
            {f.sms && (
              <Textarea
                rows={2}
                value={f.anniversarySms}
                onChange={(e) => set({ anniversarySms: e.target.value })}
                placeholder="SMS text"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Queue */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Coming up (next 14 days)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {queue.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No birthdays or anniversaries in the next two weeks.
            </p>
          ) : (
            queue.map((q) => (
              <div key={q.id} className="flex items-center gap-3 text-sm">
                {q.kind === "birthday" ? (
                  <Cake className="text-primary size-4 shrink-0" />
                ) : (
                  <Heart className="text-primary size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{q.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {q.label}
                  {q.years ? ` · ${q.years} yr${q.years === 1 ? "" : "s"}` : ""}
                </span>
                <span
                  className={
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold " +
                    (q.offset === 0
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground")
                  }
                >
                  {q.dateLabel}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={test} disabled={testing || !f.email}>
          {testing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Email me a test
        </Button>
        <Button onClick={save} disabled={pending} size="lg">
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}
