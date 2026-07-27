"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  savePledgeReminderSettings,
  type PledgeReminderInput,
} from "@/app/(app)/settings/actions";
import { smsPages } from "@/lib/sms-pages";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

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
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function PledgeReminderSettings({
  initial,
  smsReady,
}: {
  initial: PledgeReminderInput;
  smsReady: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState<PledgeReminderInput>(initial);
  const [pending, start] = useTransition();
  const set = (patch: Partial<PledgeReminderInput>) =>
    setF((p) => ({ ...p, ...patch }));

  function save() {
    start(async () => {
      const res = await savePledgeReminderSettings(f);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Pledge reminder settings saved");
      router.refresh();
    });
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <BellRing className="text-primary size-5" /> Pledge reminders
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Gently remind members with an outstanding pledge — once each period
          (weekly / monthly / quarterly / yearly, per how they pledged) until
          it&apos;s paid off. Use <code>{"{name}"}</code>,{" "}
          <code>{"{project}"}</code>, <code>{"{amount}"}</code>,{" "}
          <code>{"{paid}"}</code>, <code>{"{outstanding}"}</code> and{" "}
          <code>{"{church}"}</code> in your messages.
        </p>

        <ToggleRow
          title="Send pledge reminders"
          desc="Only for members with contact details; one-time pledges aren't reminded."
          checked={f.enabled}
          onChange={(v) => set({ enabled: v })}
        />

        {f.enabled && (
          <>
            <ToggleRow
              title="Send by email"
              desc="Free — included in your plan's email allowance."
              checked={f.email}
              onChange={(v) => set({ email: v })}
            />
            <ToggleRow
              title="Send by SMS"
              desc={
                smsReady
                  ? "Costs one SMS from your wallet per reminder."
                  : "Needs an approved sender ID (Settings → SMS) before it can send."
              }
              checked={f.sms}
              onChange={(v) => set({ sms: v })}
            />
            <div className="space-y-2">
              <Label htmlFor="pr-subj">Email subject</Label>
              <Input
                id="pr-subj"
                value={f.emailSubject}
                onChange={(e) => set({ emailSubject: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-body">Email message</Label>
              <Textarea
                id="pr-body"
                rows={7}
                value={f.emailBody}
                onChange={(e) => set({ emailBody: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-sms">SMS message</Label>
              <Textarea
                id="pr-sms"
                rows={3}
                value={f.smsBody}
                onChange={(e) => set({ smsBody: e.target.value })}
              />
              <p className="text-muted-foreground text-xs">
                {f.smsBody.trim().length} characters · {smsPages(f.smsBody)} SMS
                page{smsPages(f.smsBody) === 1 ? "" : "s"} each.
              </p>
            </div>
          </>
        )}

        <div className="flex justify-end">
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save reminders
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
