"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  Building2,
  CalendarClock,
  Check,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Pencil,
  Phone,
  Send,
  StickyNote,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  logTouch,
  messageLead,
  setFollowUp,
  setLeadStatus,
} from "@/app/superadmin/growth/actions";
import {
  ACTIVITY_KINDS,
  LEAD_STATUSES,
  followUpLabel,
  leadStatusMeta,
  whatsappLink,
  type LeadActivityKind,
  type LeadStatus,
  type ManualActivityKind,
} from "@/lib/growth-shared";
import { smsPages } from "@/lib/sms-pages";
import { cn } from "@/lib/utils";
import { LeadDialog, type LeadFormValues } from "@/components/superadmin/lead-dialog";
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

type Lead = {
  id: string;
  churchName: string;
  contactName: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  country: string;
  state: string | null;
  city: string | null;
  denomination: string | null;
  size: number | null;
  status: LeadStatus;
  source: string;
  notes: string | null;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  convertedChurchId: string | null;
  convertedChurchName: string | null;
  convertedAt: string | null;
  createdAt: string;
};

type Activity = {
  id: string;
  kind: LeadActivityKind;
  body: string;
  actorName: string | null;
  createdAt: string;
};

const ACTIVITY_ICON: Record<LeadActivityKind, typeof Phone> = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  sms: MessageSquare,
  whatsapp: MessageCircle,
  meeting: Users,
  status: Check,
};

const NO_CHURCH = "__none__";

export function LeadDetail({
  lead,
  activities,
  churches,
}: {
  lead: Lead;
  activities: Activity[];
  churches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [touchKind, setTouchKind] = useState<ManualActivityKind>("call");
  const [touchBody, setTouchBody] = useState("");
  const [touchNext, setTouchNext] = useState("");

  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [convertTo, setConvertTo] = useState(lead.convertedChurchId ?? NO_CHURCH);

  const meta = leadStatusMeta(lead.status);
  const due = followUpLabel(lead.nextFollowUpAt);
  const wa = whatsappLink(lead.whatsapp || lead.phone);

  const editValues: LeadFormValues = {
    id: lead.id,
    churchName: lead.churchName,
    contactName: lead.contactName ?? "",
    role: lead.role ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    whatsapp: lead.whatsapp ?? "",
    country: lead.country,
    state: lead.state ?? "",
    city: lead.city ?? "",
    denomination: lead.denomination ?? "",
    size: lead.size ? String(lead.size) : "",
    source: lead.source,
    notes: lead.notes ?? "",
    nextFollowUpAt: lead.nextFollowUpAt ? lead.nextFollowUpAt.slice(0, 10) : "",
  };

  function changeStatus(status: LeadStatus) {
    startTransition(async () => {
      const res = await setLeadStatus({
        id: lead.id,
        status,
        churchId:
          status === "converted" && convertTo !== NO_CHURCH ? convertTo : null,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Moved to ${leadStatusMeta(status).label}.`);
      router.refresh();
    });
  }

  function saveTouch() {
    if (!touchBody.trim()) return toast.error("Write what happened.");
    startTransition(async () => {
      const res = await logTouch({
        id: lead.id,
        kind: touchKind,
        body: touchBody,
        nextFollowUpAt: touchNext ? new Date(touchNext).toISOString() : "",
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Logged.");
      setTouchBody("");
      setTouchNext("");
      router.refresh();
    });
  }

  function send() {
    if (!body.trim()) return toast.error("Write a message.");
    if (channel === "email" && !subject.trim())
      return toast.error("An email needs a subject.");
    startTransition(async () => {
      const res = await messageLead({
        id: lead.id,
        channel,
        subject,
        body,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(channel === "email" ? "Email sent." : "SMS sent.");
      setBody("");
      setSubject("");
      router.refresh();
    });
  }

  function snooze(days: number) {
    startTransition(async () => {
      const res = await setFollowUp({
        id: lead.id,
        nextFollowUpAt: new Date(Date.now() + days * 86_400_000).toISOString(),
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Follow up in ${days} day${days === 1 ? "" : "s"}.`);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* ---------- left: who they are ---------- */}
      <div className="space-y-5 lg:col-span-1">
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-lg font-semibold tracking-tight">
                  {lead.churchName}
                </h1>
                <p className="text-muted-foreground text-sm">
                  {[lead.contactName, lead.role].filter(Boolean).join(" · ") ||
                    "No contact person yet"}
                </p>
              </div>
              <LeadDialog
                initial={editValues}
                trigger={
                  <Button variant="ghost" size="sm" aria-label="Edit lead">
                    <Pencil className="size-4" />
                  </Button>
                }
              />
            </div>

            <span
              className={cn(
                "inline-block rounded-full px-2.5 py-1 text-xs font-bold",
                meta.tone,
              )}
            >
              {meta.label}
            </span>

            <div className="space-y-2 text-sm">
              {lead.phone && (
                <a
                  href={`tel:${lead.phone}`}
                  className="hover:text-primary flex items-center gap-2"
                >
                  <Phone className="text-muted-foreground size-4" /> {lead.phone}
                </a>
              )}
              {lead.email && (
                <a
                  href={`mailto:${lead.email}`}
                  className="hover:text-primary flex items-center gap-2 break-all"
                >
                  <Mail className="text-muted-foreground size-4" /> {lead.email}
                </a>
              )}
              {(lead.city || lead.state) && (
                <p className="flex items-center gap-2">
                  <MapPin className="text-muted-foreground size-4" />
                  {[lead.city, lead.state, lead.country].filter(Boolean).join(", ")}
                </p>
              )}
              {lead.size != null && (
                <p className="flex items-center gap-2">
                  <Users className="text-muted-foreground size-4" /> about{" "}
                  {lead.size} members
                </p>
              )}
              {lead.denomination && (
                <p className="flex items-center gap-2">
                  <Building2 className="text-muted-foreground size-4" />{" "}
                  {lead.denomination}
                </p>
              )}
            </div>

            {wa && (
              <Button variant="outline" className="w-full" asChild>
                <a href={wa} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="size-4" /> Open WhatsApp
                </a>
              </Button>
            )}

            {lead.notes && (
              <p className="text-muted-foreground bg-muted/50 rounded-lg p-3 text-sm whitespace-pre-wrap">
                {lead.notes}
              </p>
            )}

            <div className="text-muted-foreground space-y-1 border-t pt-3 text-xs">
              <p>
                From <span className="capitalize">{lead.source}</span> · added{" "}
                {format(new Date(lead.createdAt), "d MMM yyyy")}
              </p>
              {lead.lastContactedAt && (
                <p>
                  Last contacted{" "}
                  {format(new Date(lead.lastContactedAt), "d MMM yyyy")}
                </p>
              )}
              {lead.convertedAt && (
                <p className="text-emerald-600 dark:text-emerald-400">
                  Converted {format(new Date(lead.convertedAt), "d MMM yyyy")}
                  {lead.convertedChurchName ? ` · ${lead.convertedChurchName}` : ""}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ---------- stage ---------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {LEAD_STATUSES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={pending}
                  onClick={() => changeStatus(s.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-bold transition-colors",
                    s.id === lead.status
                      ? s.tone
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <Label>Link to the church account (when converted)</Label>
              <Select value={convertTo} onValueChange={setConvertTo}>
                <SelectTrigger className="w-full" aria-label="Church account">
                  <SelectValue placeholder="Not linked" />
                </SelectTrigger>
                <SelectContent searchPlaceholder="Search churches…">
                  <SelectItem value={NO_CHURCH}>Not linked</SelectItem>
                  {churches.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Pick the church they signed up as, then press “Converted”.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ---------- follow-up ---------- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4" /> Next follow-up
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {due ? (
              <p
                className={cn(
                  "text-sm font-semibold",
                  due.overdue
                    ? "text-destructive"
                    : due.dueToday
                      ? "text-amber-600 dark:text-amber-400"
                      : "",
                )}
              >
                {due.text} ·{" "}
                {format(new Date(lead.nextFollowUpAt as string), "d MMM yyyy")}
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                No date set — this lead won&rsquo;t appear in “Due now”.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => snooze(1)}>
                Tomorrow
              </Button>
              <Button size="sm" variant="outline" onClick={() => snooze(3)}>
                In 3 days
              </Button>
              <Button size="sm" variant="outline" onClick={() => snooze(7)}>
                Next week
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---------- right: doing the work ---------- */}
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Send them a message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              {(["email", "sms"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                    channel === c
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {c === "email" ? (
                    <Mail className="size-4" />
                  ) : (
                    <MessageSquare className="size-4" />
                  )}
                  {c === "email" ? "Email" : "SMS"}
                </button>
              ))}
            </div>

            {channel === "email" ? (
              !lead.email && (
                <p className="text-destructive text-sm">
                  No email address on file for this lead.
                </p>
              )
            ) : !lead.phone ? (
              <p className="text-destructive text-sm">
                No phone number on file for this lead.
              </p>
            ) : null}

            {channel === "email" && (
              <div className="space-y-2">
                <Label htmlFor="subj">Subject</Label>
                <Input
                  id="subj"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="A simpler way to run {church}'s attendance"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="msg">Message</Label>
              <Textarea
                id="msg"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={channel === "email" ? 7 : 4}
                placeholder={
                  channel === "email"
                    ? "Hello {name},\n\nWe met at…"
                    : "Hi {name}, this is Daniel from FlockInsight…"
                }
              />
              <p className="text-muted-foreground text-xs">
                {"{name}"} and {"{church}"} are filled in automatically.
                {channel === "sms" && body
                  ? ` · ${smsPages(body)} SMS page${smsPages(body) === 1 ? "" : "s"}`
                  : ""}
              </p>
            </div>

            <Button onClick={send} disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Send
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log a follow-up</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>What happened</Label>
                <Select
                  value={touchKind}
                  onValueChange={(v) => setTouchKind(v as ManualActivityKind)}
                >
                  <SelectTrigger className="w-full" aria-label="Kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_KINDS.map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="next">Then follow up on</Label>
                <Input
                  id="next"
                  type="date"
                  value={touchNext}
                  onChange={(e) => setTouchNext(e.target.value)}
                />
              </div>
            </div>
            <Textarea
              value={touchBody}
              onChange={(e) => setTouchBody(e.target.value)}
              rows={3}
              placeholder="Spoke to the pastor. Wants a demo after Sunday service."
            />
            <Button variant="secondary" onClick={saveTouch} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save to timeline
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Timeline ({activities.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activities.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing logged yet. Every call, message and stage change shows up
                here.
              </p>
            ) : (
              <ol className="space-y-3">
                {activities.map((a) => {
                  const Icon = ACTIVITY_ICON[a.kind] ?? StickyNote;
                  return (
                    <li key={a.id} className="flex gap-3">
                      <div className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-lg">
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1 border-b pb-3 last:border-0">
                        <p className="text-sm whitespace-pre-wrap">{a.body}</p>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {format(new Date(a.createdAt), "d MMM yyyy · h:mm a")}
                          {a.actorName ? ` · ${a.actorName}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
