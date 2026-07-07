"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { createNotification } from "@/app/superadmin/notifications/actions";
import { PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ChurchOption = { id: string; name: string; plan: string; country: string };

const AUDIENCES = [
  { id: "all", label: "All churches" },
  { id: "plan", label: "By plan" },
  { id: "country", label: "By country" },
  { id: "churches", label: "Specific churches" },
] as const;

export function NotificationComposer({
  churches,
  countries,
}: {
  churches: ChurchOption[];
  countries: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [category, setCategory] = useState<"system" | "general">("general");
  const [audience, setAudience] = useState<
    "all" | "plan" | "country" | "churches"
  >("all");
  const [targetPlan, setTargetPlan] = useState("growth");
  const [targetCountry, setTargetCountry] = useState(countries[0] ?? "Nigeria");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [inApp, setInApp] = useState(true);
  const [email, setEmail] = useState(false);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");

  const filteredChurches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return churches;
    return churches.filter((c) => c.name.toLowerCase().includes(q));
  }, [churches, query]);

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const reach = useMemo(() => {
    if (audience === "all") return churches.length;
    if (audience === "plan")
      return churches.filter((c) => c.plan === targetPlan).length;
    if (audience === "country")
      return churches.filter((c) => c.country === targetCountry).length;
    return picked.size;
  }, [audience, churches, targetPlan, targetCountry, picked]);

  function submit() {
    if (!title.trim() || !body.trim())
      return toast.error("Add a title and message.");
    if (!inApp && !email)
      return toast.error("Pick at least one channel (in-app or email).");
    if (scheduleMode && !scheduledAt)
      return toast.error("Pick a date and time to schedule.");
    startTransition(async () => {
      const res = await createNotification({
        title,
        body,
        category,
        audience,
        targetPlan: audience === "plan" ? targetPlan : "",
        targetCountry: audience === "country" ? targetCountry : "",
        churchIds: audience === "churches" ? [...picked] : [],
        linkUrl,
        inApp,
        email,
        scheduledAt: scheduleMode && scheduledAt ? new Date(scheduledAt).toISOString() : null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.scheduled) {
        toast.success("Broadcast scheduled.");
      } else {
        const extras = [
          res.pushSent ? `${res.pushSent} push` : "",
          res.emailSent ? `${res.emailSent} email` : "",
        ].filter(Boolean);
        toast.success(
          `Broadcast sent${extras.length ? ` · ${extras.join(", ")}` : ""}.`,
        );
      }
      setTitle("");
      setBody("");
      setLinkUrl("");
      setPicked(new Set());
      setScheduleMode(false);
      setScheduledAt("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Send a notification</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as "system" | "general")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Audience</Label>
            <Select
              value={audience}
              onValueChange={(v) => setAudience(v as typeof audience)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUDIENCES.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {audience === "plan" && (
          <div className="space-y-2">
            <Label>Plan</Label>
            <Select value={targetPlan} onValueChange={setTargetPlan}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLANS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {audience === "country" && (
          <div className="space-y-2">
            <Label>Country</Label>
            <Select value={targetCountry} onValueChange={setTargetCountry}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {countries.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {audience === "churches" && (
          <div className="space-y-2">
            <Label>Churches ({picked.size} selected)</Label>
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search churches"
                className="pl-9"
              />
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
              {filteredChurches.map((c) => {
                const on = picked.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => togglePick(c.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md p-2 text-left text-sm transition-colors",
                      on ? "bg-primary/10 text-primary" : "hover:bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded border",
                        on
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    <span className="truncate">{c.name}</span>
                    <span className="text-muted-foreground ml-auto text-xs capitalize">
                      {c.plan}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="n-title">Title</Label>
          <Input
            id="n-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. New feature: Giving statements"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="n-body">Message</Label>
          <Textarea
            id="n-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your announcement…"
            rows={4}
          />
          <p className="text-muted-foreground text-xs">
            Tip: use <code className="bg-muted rounded px-1">{"{name}"}</code> to
            greet each person by their first name in emails (in-app/push use a
            neutral greeting).
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="n-link">Link (optional)</Label>
          <Input
            id="n-link"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="/giving or https://…"
          />
        </div>

        {/* Channels */}
        <div className="space-y-2">
          <Label>Channels</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-semibold">In-app + push</p>
                <p className="text-muted-foreground text-xs">
                  Notification centre + device push.
                </p>
              </div>
              <Switch checked={inApp} onCheckedChange={setInApp} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-semibold">Email</p>
                <p className="text-muted-foreground text-xs">
                  Emails members of targeted churches.
                </p>
              </div>
              <Switch checked={email} onCheckedChange={setEmail} />
            </div>
          </div>
        </div>

        {/* Schedule */}
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Schedule for later</p>
              <p className="text-muted-foreground text-xs">
                Off = send now. On = pick a date & time.
              </p>
            </div>
            <Switch checked={scheduleMode} onCheckedChange={setScheduleMode} />
          </div>
          {scheduleMode && (
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="h-11"
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            Reaches{" "}
            <span className="text-foreground font-bold">{reach}</span> church
            {reach === 1 ? "" : "es"}
          </p>
          <Button onClick={submit} disabled={pending} size="lg">
            {pending ? <Loader2 className="animate-spin" /> : <Send className="size-4" />}
            {scheduleMode ? "Schedule" : "Send now"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
