"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeartHandshake, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  saveGivingReceiptSettings,
  type GivingReceiptInput,
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

export function GivingReceiptSettings({
  initial,
  smsReady,
}: {
  initial: GivingReceiptInput;
  smsReady: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState<GivingReceiptInput>(initial);
  const [pending, start] = useTransition();
  const set = (patch: Partial<GivingReceiptInput>) =>
    setF((p) => ({ ...p, ...patch }));

  function save() {
    start(async () => {
      const res = await saveGivingReceiptSettings(f);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Giving receipt settings saved");
      router.refresh();
    });
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <HeartHandshake className="text-primary size-5" /> Giving receipts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          When you record a gift for a member, automatically thank them and speak
          a blessing over them. Use <code>{"{name}"}</code>,{" "}
          <code>{"{amount}"}</code>, <code>{"{category}"}</code>,{" "}
          <code>{"{date}"}</code> and <code>{"{church}"}</code> in your messages.
        </p>

        <ToggleRow
          title="Send giving receipts"
          desc="Only sent for gifts recorded against a member who has contact details."
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
                  ? "Costs one SMS from your wallet per receipt."
                  : "Needs an approved sender ID (Settings → SMS) before it can send."
              }
              checked={f.sms}
              onChange={(v) => set({ sms: v })}
            />

            <div className="space-y-2">
              <Label htmlFor="rs-subj">Email subject</Label>
              <Input
                id="rs-subj"
                value={f.emailSubject}
                onChange={(e) => set({ emailSubject: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rs-body">Email message</Label>
              <Textarea
                id="rs-body"
                rows={7}
                value={f.emailBody}
                onChange={(e) => set({ emailBody: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rs-sms">SMS message</Label>
              <Textarea
                id="rs-sms"
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
            Save receipts
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
