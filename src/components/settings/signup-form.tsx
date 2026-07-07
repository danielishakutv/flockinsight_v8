"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import {
  saveSignupSettings,
  regenerateSlug,
  type SignupSettingsInput,
} from "@/app/(app)/settings/signup/actions";
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

export function SignupForm({
  initial,
  url: initialUrl,
}: {
  initial: SignupSettingsInput;
  url: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [regen, startRegen] = useTransition();
  const [f, setF] = useState<SignupSettingsInput>(initial);
  const [url, setUrl] = useState(initialUrl);
  const [copied, setCopied] = useState(false);
  const set = (patch: Partial<SignupSettingsInput>) =>
    setF((p) => ({ ...p, ...patch }));

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — long-press the link to copy it.");
    }
  }

  function save() {
    start(async () => {
      const res = await saveSignupSettings(f);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Sign-up link settings saved");
      router.refresh();
    });
  }

  function newLink() {
    if (
      !confirm(
        "Generate a new link? The current link will stop working and anyone with it will need the new one.",
      )
    )
      return;
    startRegen(async () => {
      const res = await regenerateSlug();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setUrl(url.replace(/\/join\/.*$/, `/join/${res.slug}`));
      toast.success("New link generated");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserPlus className="text-primary size-5" /> Public sign-up link
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Share this link so people can add themselves to your church — no
            account needed. New people are added instantly; anyone who already
            exists must confirm a one-time code before their record is updated.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="bg-muted flex min-w-0 flex-1 items-center rounded-xl border px-3 py-2 font-mono text-sm">
              <span className="truncate">{url}</span>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                Copy
              </Button>
              <Button type="button" variant="outline" asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" /> Open
                </a>
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <ToggleRow
              title="Link is active"
              desc="Turn off to temporarily stop new sign-ups."
              checked={f.enabled}
              onChange={(v) => set({ enabled: v })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={newLink}
            disabled={regen}
            className="text-muted-foreground"
          >
            {regen ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Generate a new link
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Page content</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Heading</Label>
            <Input
              id="title"
              value={f.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="intro">Intro text</Label>
            <Textarea
              id="intro"
              rows={3}
              value={f.intro}
              onChange={(e) => set({ intro: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="success">Thank-you message</Label>
            <Textarea
              id="success"
              rows={2}
              value={f.successMessage}
              onChange={(e) => set({ successMessage: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">What to collect</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            title="Date of birth"
            desc="So you can celebrate their birthday."
            checked={f.collectBirthday}
            onChange={(v) => set({ collectBirthday: v })}
          />
          <ToggleRow
            title="Wedding anniversary"
            desc="So you can celebrate their milestones."
            checked={f.collectAnniversary}
            onChange={(v) => set({ collectAnniversary: v })}
          />
          <ToggleRow
            title="Home address"
            desc="Address, city and state."
            checked={f.collectAddress}
            onChange={(v) => set({ collectAddress: v })}
          />
          <ToggleRow
            title="Ministries & groups"
            desc="Let people pick the groups they belong to."
            checked={f.allowGroupSelect}
            onChange={(v) => set({ allowGroupSelect: v })}
          />
          <div className="space-y-2 rounded-xl border p-3">
            <Label htmlFor="status">Add new people as</Label>
            <Select
              value={f.newMemberStatus}
              onValueChange={(v) =>
                set({ newMemberStatus: v as SignupSettingsInput["newMemberStatus"] })
              }
            >
              <SelectTrigger id="status" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active member</SelectItem>
                <SelectItem value="visitor">Visitor</SelectItem>
                <SelectItem value="new_convert">New convert</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Existing visitors who confirm via this link become active members
              automatically.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            title="Notify in the app"
            desc="Alert your managers when someone signs up or updates their details."
            checked={f.notifyInApp}
            onChange={(v) => set({ notifyInApp: v })}
          />
          <ToggleRow
            title="Email the church"
            desc="Also email your public church email address (set in Settings → Public page)."
            checked={f.notifyEmail}
            onChange={(v) => set({ notifyEmail: v })}
          />
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
