"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Loader2, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { saveDevotional } from "@/app/(app)/devotionals/actions";
import { ImageUpload } from "@/components/settings/image-upload";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

type State = {
  id: string;
  type: "devotional" | "newsletter";
  title: string;
  body: string;
  imageUrl: string | null;
  audience: "subscribers" | "members" | "both";
  status: "draft" | "scheduled" | "sent";
  scheduledAt: string | null;
  recipients: number;
  sentCount: number;
};

export function DevotionalEditor({ initial }: { initial: State }) {
  const router = useRouter();
  const [s, setS] = useState<State>(initial);
  const [busy, start] = useTransition();
  const [showSchedule, setShowSchedule] = useState(initial.status === "scheduled");
  const [when, setWhen] = useState(
    initial.scheduledAt ? toLocalInput(initial.scheduledAt) : "",
  );

  const sent = s.status === "sent";
  const noun = s.type === "newsletter" ? "Newsletter" : "Devotional";

  const set = (patch: Partial<State>) => setS((p) => ({ ...p, ...patch }));

  function payload() {
    return {
      id: s.id,
      type: s.type,
      title: s.title,
      body: s.body,
      imageUrl: s.imageUrl,
      audience: s.audience,
    };
  }

  function run(mode: "draft" | "schedule" | "send", scheduledAt?: string) {
    if (!s.title.trim()) return toast.error("Add a title.");
    if (!s.body.trim()) return toast.error("Write some content.");
    if (mode === "send" && !confirm("Send this now to the selected audience?"))
      return;
    start(async () => {
      const res = await saveDevotional(payload(), mode, scheduledAt);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (mode === "send")
        toast.success(`Sent to ${res.sent ?? 0} of ${res.recipients ?? 0} recipients.`);
      else if (mode === "schedule") toast.success("Scheduled.");
      else toast.success("Saved as draft.");
      router.push("/devotionals");
    });
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <BackBar />
        <Card>
          <CardContent className="space-y-4 py-6">
            <p className="text-success text-sm font-semibold">
              Sent · {s.sentCount} of {s.recipients} delivered
            </p>
            <h1 className="text-2xl font-extrabold">{s.title}</h1>
            {s.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.imageUrl} alt="" className="w-full rounded-xl" />
            )}
            <p className="whitespace-pre-wrap leading-relaxed">{s.body}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      <BackBar />

      <Card>
        <CardContent className="space-y-4 py-5">
          {/* Type switch */}
          <div className="flex gap-1.5">
            {(["devotional", "newsletter"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set({ type: t })}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                  s.type === t
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <Input
            value={s.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder={`${noun} title`}
            className="h-auto border-0 px-0 text-2xl font-extrabold shadow-none focus-visible:ring-0"
          />

          <ImageUpload
            value={s.imageUrl}
            onChange={(url) => set({ imageUrl: url })}
            kind="devotional"
            maxDim={1200}
            label="Cover image (optional)"
            aspect="wide"
          />

          <Textarea
            value={s.body}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="Write your message…"
            rows={12}
            className="leading-relaxed"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="space-y-1.5">
            <Label>Send to</Label>
            <Select
              value={s.audience}
              onValueChange={(v) => set({ audience: v as State["audience"] })}
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Members &amp; subscribers</SelectItem>
                <SelectItem value="members">Members only</SelectItem>
                <SelectItem value="subscribers">Subscribers only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {showSchedule && (
            <div className="space-y-1.5">
              <Label htmlFor="when">Schedule for</Label>
              <Input
                id="when"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="h-11 w-full sm:w-72"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sticky action bar */}
      <div className="bg-background/80 fixed inset-x-0 bottom-0 z-10 border-t p-3 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-end gap-2 px-1">
          <Button variant="ghost" disabled={busy} onClick={() => run("draft")}>
            <Save className="size-4" /> Save draft
          </Button>
          {showSchedule ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (!when) return toast.error("Pick a date and time.");
                run("schedule", new Date(when).toISOString());
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              <CalendarClock className="size-4" /> Schedule
            </Button>
          ) : (
            <Button variant="outline" disabled={busy} onClick={() => setShowSchedule(true)}>
              <CalendarClock className="size-4" /> Schedule…
            </Button>
          )}
          <Button disabled={busy} onClick={() => run("send")}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            <Send className="size-4" /> Send now
          </Button>
        </div>
      </div>
    </div>
  );
}

function BackBar() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href="/devotionals">
        <ArrowLeft className="size-4" /> Devotionals
      </Link>
    </Button>
  );
}

/** ISO → value for <input type="datetime-local"> in local time. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
