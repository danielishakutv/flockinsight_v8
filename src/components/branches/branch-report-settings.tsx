"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Loader2, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { saveReportSetting } from "@/app/(app)/branches/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function BranchReportSettings({
  initial,
}: {
  initial: {
    enabled: boolean;
    frequency: "weekly" | "monthly";
    recipients: string[];
    lastSentAt: string | null;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [frequency, setFrequency] = useState(initial.frequency);
  const [recipients, setRecipients] = useState<string[]>(initial.recipients);
  const [draft, setDraft] = useState("");

  function addRecipient() {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (!EMAIL_RE.test(value)) return toast.error("Check that email address.");
    if (recipients.includes(value)) return setDraft("");
    if (recipients.length >= 10) return toast.error("Ten addresses is the limit.");
    setRecipients([...recipients, value]);
    setDraft("");
  }

  function save() {
    startTransition(async () => {
      const res = await saveReportSetting({ enabled, frequency, recipients });
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        enabled
          ? `Roll-up report will be emailed ${frequency}.`
          : "Automatic reports turned off.",
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="size-4" /> Automatic reports
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">
              Email me the branch roll-up
            </p>
            <p className="text-muted-foreground text-sm">
              One email with every branch&rsquo;s attendance, new members and
              giving — no logging in to check.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Enable automatic reports"
          />
        </div>

        {enabled && (
          <>
            <div className="space-y-2">
              <Label>How often</Label>
              <Select
                value={frequency}
                onValueChange={(v) => setFrequency(v as "weekly" | "monthly")}
              >
                <SelectTrigger className="w-48" aria-label="Frequency" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Every week (Monday)</SelectItem>
                  <SelectItem value="monthly">Every month</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="r-email">Also send to</Label>
              <div className="flex gap-2">
                <Input
                  id="r-email"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRecipient();
                    }
                  }}
                  placeholder="bishop@church.org"
                  type="email"
                  className="h-9"
                />
                <Button size="sm" variant="outline" onClick={addRecipient}>
                  Add
                </Button>
              </div>
              {recipients.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {recipients.map((r) => (
                    <span
                      key={r}
                      className="bg-muted inline-flex items-center gap-1 rounded-full py-1 pl-2.5 pr-1 text-xs font-medium"
                    >
                      {r}
                      <button
                        type="button"
                        onClick={() => setRecipients(recipients.filter((x) => x !== r))}
                        aria-label={`Remove ${r}`}
                        className="hover:bg-accent rounded-full p-0.5"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-muted-foreground text-xs">
                Everyone with a login at this church gets it anyway. These are
                extra addresses — a bishop, a board, an overseer.
              </p>
            </div>
          </>
        )}

        <div className="flex items-center gap-3 border-t pt-3">
          <Button size="sm" onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
          {initial.lastSentAt && (
            <p className="text-muted-foreground text-xs">
              Last sent {format(new Date(initial.lastSentAt), "d MMM yyyy")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
