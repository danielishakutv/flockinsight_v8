"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  Check,
  History,
  Loader2,
  Mail,
  MessageSquare,
  Search,
  Send,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  notifyStaff,
  sendCommunication,
} from "@/app/(app)/communication/actions";
import { COMM_TEMPLATES } from "@/lib/comm-templates";
import { smsPages } from "@/lib/sms-pages";
import { formatMoney } from "@/lib/money";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

export type CommMember = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};
type LogRow = {
  id: string;
  channel: "sms" | "email" | "notification";
  audience: string;
  subject: string | null;
  body: string;
  recipients: number;
  sent: number;
  failed: number;
  units: number;
  cost: number;
  createdAt: string;
};

const CHANNEL_ICON = { sms: MessageSquare, email: Mail, notification: Users };

/** Split pasted text on commas / semicolons / whitespace into contact entries. */
function splitContacts(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function CommunicationClient({
  canManage,
  members,
  groups,
  staffCount,
  currency,
  smsPrice,
  smsBalance,
  senderApproved,
  smsAvailable = true,
  recent,
}: {
  canManage: boolean;
  members: CommMember[];
  groups: { id: string; name: string }[];
  staffCount: number;
  currency: string;
  smsPrice: number;
  smsBalance: number;
  senderApproved: boolean;
  smsAvailable?: boolean;
  recent: LogRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [channel, setChannel] = useState<"sms" | "email" | "staff">("sms");
  const [audience, setAudience] = useState<
    "all" | "group" | "selected" | "contacts"
  >("all");
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  // Hand-typed recipients who aren't members yet.
  const [contacts, setContacts] = useState<string[]>([]);
  const [contactDraft, setContactDraft] = useState("");
  // Staff notice
  const [staffTitle, setStaffTitle] = useState("");
  const [alsoEmail, setAlsoEmail] = useState(true);

  const contactKey = channel === "sms" ? "phone" : "email";

  const reach = useMemo(() => {
    if (channel === "staff") return staffCount;
    if (audience === "all")
      return members.filter((m) => m[contactKey]).length;
    if (audience === "selected")
      return members.filter((m) => selected.has(m.id) && m[contactKey]).length;
    if (audience === "contacts") return contacts.length;
    return null; // group reach computed on send
  }, [channel, audience, members, selected, contactKey, staffCount, contacts]);

  /** Commit whatever is in the contact input (plus anything pasted with it). */
  function addContacts(raw: string) {
    const parts = splitContacts(raw);
    if (parts.length === 0) return;
    setContacts((prev) => [...new Set([...prev, ...parts])].slice(0, 200));
    setContactDraft("");
  }

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members;
  }, [members, query]);

  const pages = smsPages(body);
  const estCost = reach !== null ? smsPrice * pages * reach : null;

  function applyTemplate(id: string) {
    const t = COMM_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setBody(t.body);
    if (channel === "email" && t.subject !== undefined) setSubject(t.subject);
  }

  function audienceLabel() {
    if (audience === "all") return "All members";
    if (audience === "group")
      return `Group: ${groups.find((g) => g.id === groupId)?.name ?? ""}`;
    if (audience === "contacts")
      return contacts.length === 1
        ? `New contact: ${contacts[0]}`
        : `${contacts.length} new contacts`;
    return `${selected.size} selected`;
  }

  function send() {
    if (channel === "staff") {
      if (!staffTitle.trim() || !body.trim())
        return toast.error("Add a title and message.");
      startTransition(async () => {
        const res = await notifyStaff({ title: staffTitle, body, alsoEmail });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(
          `Sent to ${res.staff} staff${res.pushSent ? ` · ${res.pushSent} push` : ""}${res.emailSent ? ` · ${res.emailSent} email` : ""}.`,
        );
        track("staff.notice.sent", { value: res.staff });
        setStaffTitle("");
        setBody("");
        router.refresh();
      });
      return;
    }

    // Typing a contact and hitting Send straight away should still include it.
    const typed = audience === "contacts" ? splitContacts(contactDraft) : [];
    const allContacts = [...new Set([...contacts, ...typed])];

    if (!body.trim()) return toast.error("Write a message.");
    if (audience === "group" && !groupId) return toast.error("Pick a group.");
    if (audience === "selected" && selected.size === 0)
      return toast.error("Choose at least one member.");
    if (audience === "contacts" && allContacts.length === 0)
      return toast.error(
        channel === "sms"
          ? "Add at least one phone number."
          : "Add at least one email address.",
      );
    if (channel === "sms" && !smsAvailable)
      return toast.error("SMS isn't available in your country yet.");
    if (channel === "sms" && !senderApproved)
      return toast.error("Your SMS sender ID isn't approved yet (Settings → SMS).");

    startTransition(async () => {
      const res = await sendCommunication({
        channel,
        audience,
        groupId: audience === "group" ? groupId : "",
        memberIds: audience === "selected" ? [...selected] : [],
        contacts: audience === "contacts" ? allContacts : [],
        subject: channel === "email" ? subject : undefined,
        body,
        audienceLabel:
          audience === "contacts"
            ? allContacts.length === 1
              ? `New contact: ${allContacts[0]}`
              : `${allContacts.length} new contacts`
            : audienceLabel(),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const cost = res.cost ? ` · ${formatMoney(res.cost, currency)}` : "";
      toast.success(
        `Sent to ${res.sent}${res.failed ? `, ${res.failed} failed` : ""}${cost}.`,
      );
      track(channel === "sms" ? "sms.sent" : "email.sent", { value: res.sent });
      // Reset the composer so the page is ready for the next message.
      setBody("");
      setSubject("");
      setSelected(new Set());
      setQuery("");
      setContacts([]);
      setContactDraft("");
      router.refresh();
    });
  }

  /** Load a past message back into the composer to send again. */
  function reuse(r: LogRow) {
    if (r.channel === "notification") {
      setChannel("staff");
      setStaffTitle(r.subject ?? "");
      setBody(r.body);
    } else {
      setChannel(r.channel);
      setBody(r.body);
      if (r.channel === "email") setSubject(r.subject ?? "");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const channels = [
    { id: "sms", label: "SMS", icon: MessageSquare },
    { id: "email", label: "Email", icon: Mail },
    { id: "staff", label: "Staff notice", icon: Users },
  ] as const;

  const templates = COMM_TEMPLATES.filter(
    (t) => t.channel === "both" || t.channel === channel,
  );

  return (
    <div className="space-y-4">
      {!canManage && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          You can view communication history but don&apos;t have permission to
          send.
        </div>
      )}

      {/* Channel tabs */}
      <div className="flex flex-wrap gap-2">
        {channels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => {
              setChannel(ch.id);
              // Phone numbers aren't email addresses — start the list over.
              setContacts([]);
              setContactDraft("");
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
              channel === ch.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            <ch.icon className="size-4" />
            {ch.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-4 py-5">
          {channel === "sms" && !smsAvailable && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              SMS isn&apos;t available in your country yet — we&apos;re working on
              it and it&apos;s coming soon. Email still works.
            </div>
          )}
          {channel === "staff" ? (
            <>
              <p className="text-muted-foreground text-sm">
                Sends an in-app notification (and optional email) to all{" "}
                <strong>{staffCount}</strong> team members.
              </p>
              <div className="space-y-2">
                <Label htmlFor="st">Title</Label>
                <Input
                  id="st"
                  value={staffTitle}
                  onChange={(e) => setStaffTitle(e.target.value)}
                  placeholder="e.g. Workers' meeting this Saturday"
                  disabled={!canManage}
                />
              </div>
            </>
          ) : (
            <>
              {/* Audience */}
              <div className="space-y-2">
                <Label>Send to</Label>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["all", "All members"],
                      ["group", "A group"],
                      ["selected", "Choose members"],
                      ["contacts", "New contact"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setAudience(id)}
                      disabled={!canManage}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                        audience === id
                          ? "border-primary bg-primary/10 text-primary"
                          : "hover:bg-accent",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {audience === "group" && (
                <Select value={groupId} onValueChange={setGroupId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a group" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {audience === "contacts" && (
                <div className="space-y-2">
                  <Label htmlFor="contact">
                    {channel === "sms" ? "Phone numbers" : "Email addresses"}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="contact"
                      value={contactDraft}
                      onChange={(e) => setContactDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          addContacts(contactDraft);
                        }
                      }}
                      onBlur={() => addContacts(contactDraft)}
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        if (splitContacts(text).length > 1) {
                          e.preventDefault();
                          addContacts(text);
                        }
                      }}
                      inputMode={channel === "sms" ? "tel" : "email"}
                      type={channel === "sms" ? "tel" : "email"}
                      placeholder={
                        channel === "sms" ? "0803 123 4567" : "name@example.com"
                      }
                      disabled={!canManage}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => addContacts(contactDraft)}
                      disabled={!canManage || !contactDraft.trim()}
                    >
                      <UserPlus className="size-4" />
                      <span className="hidden sm:inline">Add</span>
                    </Button>
                  </div>
                  {contacts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {contacts.map((cnt) => (
                        <span
                          key={cnt}
                          className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full py-1 pr-1 pl-3 text-sm font-medium"
                        >
                          {cnt}
                          <button
                            type="button"
                            onClick={() =>
                              setContacts((p) => p.filter((x) => x !== cnt))
                            }
                            className="hover:bg-primary/20 grid size-5 place-items-center rounded-full"
                            aria-label={`Remove ${cnt}`}
                          >
                            <X className="size-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-muted-foreground text-xs">
                    Send to someone who isn&apos;t a member yet. Paste a whole
                    list — separate them with commas, spaces or new lines.{" "}
                    <code>{"{name}"}</code> falls back to &ldquo;there&rdquo; for
                    these recipients.
                  </p>
                </div>
              )}

              {audience === "selected" && (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search members"
                      className="pl-9"
                    />
                  </div>
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
                    {filteredMembers.map((m) => {
                      const on = selected.has(m.id);
                      const hasContact = !!m[contactKey];
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={!hasContact}
                          onClick={() =>
                            setSelected((p) => {
                              const n = new Set(p);
                              n.has(m.id) ? n.delete(m.id) : n.add(m.id);
                              return n;
                            })
                          }
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md p-2 text-left text-sm transition-colors",
                            on ? "bg-primary/10 text-primary" : "hover:bg-accent",
                            !hasContact && "cursor-not-allowed opacity-40",
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
                          <span className="truncate">{m.name}</span>
                          <span className="text-muted-foreground ml-auto text-xs">
                            {m[contactKey] ?? `no ${contactKey}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Template */}
              <div className="space-y-2">
                <Label>Template</Label>
                <Select onValueChange={applyTemplate}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Start from a template (optional)" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {channel === "email" && (
                <div className="space-y-2">
                  <Label htmlFor="subj">Subject</Label>
                  <Input
                    id="subj"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Email subject"
                    disabled={!canManage}
                  />
                </div>
              )}
            </>
          )}

          {/* Message body (shared) */}
          <div className="space-y-2">
            <Label htmlFor="body">Message</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={channel === "sms" ? 4 : 6}
              placeholder="Type your message…"
              disabled={!canManage}
            />
            <p className="text-muted-foreground text-xs">
              Use <code>{"{name}"}</code> for the member&apos;s first name and{" "}
              <code>{"{church}"}</code> for your church name.
              {channel === "sms" && (
                <>
                  {" "}
                  · {body.trim().length} chars · {pages} page
                  {pages === 1 ? "" : "s"}
                </>
              )}
            </p>
          </div>

          {/* SMS meta */}
          {channel === "sms" && (
            <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-lg p-3 text-sm">
              <span>
                Balance:{" "}
                <span className="font-bold">
                  {formatMoney(smsBalance, currency)}
                </span>
              </span>
              {estCost !== null && (
                <span>
                  Est. cost:{" "}
                  <span className="font-bold">
                    {formatMoney(estCost, currency)}
                  </span>{" "}
                  ({reach} recipient{reach === 1 ? "" : "s"})
                </span>
              )}
            </div>
          )}

          {/* Staff also-email */}
          {channel === "staff" && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <p className="text-sm font-semibold">Also email staff</p>
              <Switch checked={alsoEmail} onCheckedChange={setAlsoEmail} />
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              {channel === "staff"
                ? `${staffCount} staff`
                : reach !== null
                  ? `${reach} recipient${reach === 1 ? "" : "s"}`
                  : "Recipients in the group"}
            </p>
            <Button
              onClick={send}
              disabled={
                pending || !canManage || (channel === "sms" && !smsAvailable)
              }
              size="lg"
            >
              {pending ? <Loader2 className="animate-spin" /> : <Send className="size-4" />}
              Send
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* History */}
      {recent.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-lg">Recent messages</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/communication/history">
                <History className="size-4" />
                History &amp; analytics
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {recent.map((r) => {
              const Icon = CHANNEL_ICON[r.channel];
              return (
                <div
                  key={r.id}
                  className="flex items-start gap-3 rounded-xl border p-3"
                >
                  <div className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="capitalize">
                        {r.channel === "notification" ? "Staff" : r.channel}
                      </Badge>
                      <span className="text-sm font-semibold">{r.audience}</span>
                    </div>
                    {r.subject && (
                      <p className="truncate text-sm font-medium">{r.subject}</p>
                    )}
                    <p className="text-muted-foreground line-clamp-2 text-sm">
                      {r.body}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {format(parseISO(r.createdAt), "MMM d, yyyy · h:mm a")} ·{" "}
                      {r.sent}/{r.recipients} sent
                      {r.channel === "sms" && r.units
                        ? ` · ${r.units} unit${r.units === 1 ? "" : "s"}`
                        : ""}
                      {r.failed ? ` · ${r.failed} failed` : ""}
                      {r.cost ? ` · ${formatMoney(r.cost, currency)}` : ""}
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() => reuse(r)}
                      title="Use this message again"
                    >
                      <RotateCcw className="size-4" />
                      <span className="hidden sm:inline">Reuse</span>
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
