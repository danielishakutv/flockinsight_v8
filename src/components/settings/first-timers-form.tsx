"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, HeartHandshake, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  saveFirstTimers,
  type FirstTimerInput,
} from "@/app/(app)/settings/first-timers/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type State = {
  enabled: boolean;
  sms: boolean;
  email: boolean;
  welcomeDelayDays: number;
  inviteDelayDays: number;
  welcomeSms: string;
  welcomeEmailSubject: string;
  welcomeEmailBody: string;
  inviteSms: string;
  inviteEmailSubject: string;
  inviteEmailBody: string;
};

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

export function FirstTimersForm({
  initial,
  timezone,
  smsApproved,
}: {
  initial: State;
  timezone: string;
  smsApproved: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState<State>(initial);
  const set = (patch: Partial<State>) => setF((p) => ({ ...p, ...patch }));

  function save() {
    start(async () => {
      const res = await saveFirstTimers(f as unknown as FirstTimerInput);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("First-timer settings saved");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <HeartHandshake className="text-primary size-5" /> First-timer follow-up
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            title="Automate first-timer messages"
            desc="Thank new visitors, then invite them to become members — automatically."
            checked={f.enabled}
            onChange={(v) => set({ enabled: v })}
          />
          <p className="text-muted-foreground text-xs">
            Applies to members with a <b>Visitor</b> or <b>New convert</b> status.
            Once they become a member, the invite stops. Sent around your local
            timezone ({timezone}).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            title="Email"
            desc="Free. Sent to first-timers who gave an email address."
            checked={f.email}
            onChange={(v) => set({ email: v })}
          />
          <ToggleRow
            title="SMS"
            desc="Uses your SMS wallet. Sent to those who gave a phone number."
            checked={f.sms}
            onChange={(v) => set({ sms: v })}
          />
          {f.sms && !smsApproved && (
            <p className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-xs font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-4 shrink-0" />
              Your SMS sender ID isn&apos;t approved yet — apply in Settings →
              SMS. Email still works.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Timing</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="welcomeDelay">Send welcome after (days)</Label>
            <Input
              id="welcomeDelay"
              type="number"
              min={0}
              max={30}
              value={f.welcomeDelayDays}
              onChange={(e) => set({ welcomeDelayDays: Number(e.target.value) })}
              className="h-11"
            />
            <p className="text-muted-foreground text-xs">
              0 = same day, 1 = the next day.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="inviteDelay">Send membership invite after (days)</Label>
            <Input
              id="inviteDelay"
              type="number"
              min={1}
              max={90}
              value={f.inviteDelayDays}
              onChange={(e) => set({ inviteDelayDays: Number(e.target.value) })}
              className="h-11"
            />
            <p className="text-muted-foreground text-xs">Typically around 2 weeks.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Message templates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {["{name}", "{church}", "{link}"].map((p) => (
              <code
                key={p}
                className="bg-muted rounded px-1.5 py-0.5 text-xs font-semibold"
              >
                {p}
              </code>
            ))}
            <span className="text-muted-foreground text-xs">
              are replaced automatically. <b>{"{link}"}</b> (the membership link)
              only applies to the invite.
            </span>
          </div>

          <div className="space-y-3 rounded-xl border p-3">
            <p className="text-sm font-bold">Welcome message</p>
            {f.email && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="wsub">Email subject</Label>
                  <Input
                    id="wsub"
                    value={f.welcomeEmailSubject}
                    onChange={(e) => set({ welcomeEmailSubject: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wbody">Email body</Label>
                  <Textarea
                    id="wbody"
                    rows={5}
                    value={f.welcomeEmailBody}
                    onChange={(e) => set({ welcomeEmailBody: e.target.value })}
                  />
                </div>
              </>
            )}
            {f.sms && (
              <div className="space-y-2">
                <Label htmlFor="wsms">SMS</Label>
                <Textarea
                  id="wsms"
                  rows={3}
                  value={f.welcomeSms}
                  onChange={(e) => set({ welcomeSms: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-xl border p-3">
            <p className="text-sm font-bold">Membership invite</p>
            {f.email && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="isub">Email subject</Label>
                  <Input
                    id="isub"
                    value={f.inviteEmailSubject}
                    onChange={(e) => set({ inviteEmailSubject: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ibody">Email body</Label>
                  <Textarea
                    id="ibody"
                    rows={6}
                    value={f.inviteEmailBody}
                    onChange={(e) => set({ inviteEmailBody: e.target.value })}
                  />
                </div>
              </>
            )}
            {f.sms && (
              <div className="space-y-2">
                <Label htmlFor="isms">SMS</Label>
                <Textarea
                  id="isms"
                  rows={3}
                  value={f.inviteSms}
                  onChange={(e) => set({ inviteSms: e.target.value })}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end">
        <Button onClick={save} disabled={pending} size="lg">
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save settings
        </Button>
      </div>
    </div>
  );
}
