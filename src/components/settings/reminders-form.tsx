"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bell, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  saveReminders,
  sendTestReminder,
  type ReminderInput,
} from "@/app/(app)/settings/reminders/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type State = ReminderInput;

const PLACEHOLDERS = ["{name}", "{church}", "{service}", "{day}", "{time}"];

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
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

export function RemindersForm({
  initial,
  serviceCount,
  timezone,
  smsApproved,
  smsBalance,
}: {
  initial: State;
  serviceCount: number;
  timezone: string;
  smsApproved: boolean;
  smsBalance: number;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();
  const [f, setF] = useState<State>(initial);
  const set = (patch: Partial<State>) => setF((p) => ({ ...p, ...patch }));

  const smsLen = f.smsTemplate.length;
  const smsPages = smsLen <= 160 ? 1 : Math.ceil(smsLen / 153);

  function save() {
    start(async () => {
      const res = await saveReminders(f);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("settings.reminderSettingsSaved"));
      router.refresh();
    });
  }

  function test() {
    startTest(async () => {
      const res = await sendTestReminder(f);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("settings.testEmailSentToYou"));
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bell className="text-primary size-5" /> Automatic reminders
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            title={t("settings.sendServiceReminders")}
            desc="Automatically remind members about your services."
            checked={f.enabled}
            onChange={(v) => set({ enabled: v })}
          />

          {f.enabled && serviceCount === 0 && (
            <p className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-xs font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-4 shrink-0" />
              You have no active services yet. Add them in Settings → Services so
              reminders know when to send.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Channels */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("settings.channels")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            title={t("settings.email")}
            desc="Free. Sent to members who have an email address."
            checked={f.email}
            onChange={(v) => set({ email: v })}
          />
          <ToggleRow
            title="SMS"
            desc="Uses your SMS wallet. Sent to members who have a phone number."
            checked={f.sms}
            onChange={(v) => set({ sms: v })}
          />
          {f.sms && !smsApproved && (
            <p className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-xs font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-4 shrink-0" />
              Your SMS sender ID isn&apos;t approved yet — apply in Settings →
              SMS. Email reminders still work.
            </p>
          )}
          {f.sms && smsApproved && (
            <p className="text-muted-foreground text-xs">
              SMS wallet balance: <b>{smsBalance.toFixed(2)}</b>. Reminders pause
              if the balance runs out.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Timing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("settings.whenToSend")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            title={t("settings.sendTheDayBefore")}
            desc="On for a day-ahead heads-up; off to remind on the service day."
            checked={f.dayBefore}
            onChange={(v) => set({ dayBefore: v })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sendTime">{t("settings.timeOfDay")}</Label>
              <Input
                id="sendTime"
                type="time"
                value={f.sendTime}
                onChange={(e) => set({ sendTime: e.target.value })}
                className="h-11"
              />
              <p className="text-muted-foreground text-xs">
                Your timezone ({timezone}).
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="audience">{t("settings.sendTo")}</Label>
              <Select
                value={f.audience}
                onValueChange={(v) => set({ audience: v as "active" | "all" })}
              >
                <SelectTrigger id="audience" className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("settings.activeMembers")}</SelectItem>
                  <SelectItem value="all">{t("settings.allMembers")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("settings.messageTemplates")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {PLACEHOLDERS.map((p) => (
              <code
                key={p}
                className="bg-muted rounded px-1.5 py-0.5 text-xs font-semibold"
              >
                {p}
              </code>
            ))}
            <span className="text-muted-foreground text-xs">
              are replaced automatically.
            </span>
          </div>

          {f.email && (
            <div className="space-y-3 rounded-xl border p-3">
              <p className="text-sm font-bold">{t("settings.email")}</p>
              <div className="space-y-2">
                <Label htmlFor="emailSubject">{t("settings.subject")}</Label>
                <Input
                  id="emailSubject"
                  value={f.emailSubject}
                  onChange={(e) => set({ emailSubject: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emailTemplate">{t("settings.body")}</Label>
                <Textarea
                  id="emailTemplate"
                  rows={5}
                  value={f.emailTemplate}
                  onChange={(e) => set({ emailTemplate: e.target.value })}
                />
              </div>
            </div>
          )}

          {f.sms && (
            <div className="space-y-2 rounded-xl border p-3">
              <p className="text-sm font-bold">SMS</p>
              <Textarea
                rows={3}
                value={f.smsTemplate}
                onChange={(e) => set({ smsTemplate: e.target.value })}
              />
              <p className="text-muted-foreground text-xs">
                {smsLen} chars · {smsPages} page{smsPages === 1 ? "" : "s"} per
                member.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={test}
          disabled={testing || !f.email}
        >
          {testing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Email me a test
        </Button>
        <Button onClick={save} disabled={pending} size="lg">
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save reminders
        </Button>
      </div>
    </div>
  );
}
