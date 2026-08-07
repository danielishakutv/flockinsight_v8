"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, MessageSquare, Plus, Send, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  saveEventGuest,
  deleteEventGuest,
  messageEventGuests,
} from "@/app/(app)/my-events/guest-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type Guest = {
  id: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
};

export function EventGuestsDialog({
  open,
  onOpenChange,
  eventId,
  eventTitle,
  guests,
  smsAvailable,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  eventId: string;
  eventTitle: string;
  guests: Guest[];
  smsAvailable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sending, startSend] = useTransition();
  // add form
  const [name, setName] = useState("");
  const [role, setRole] = useState("Speaker");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // message composer
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  function addGuest() {
    if (!name.trim()) return toast.error("Add a name.");
    if (!email.trim() && !phone.trim())
      return toast.error("Add an email or phone number.");
    start(async () => {
      const res = await saveEventGuest({ eventId, name, role, email, phone });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Guest added");
      setName("");
      setEmail("");
      setPhone("");
      router.refresh();
    });
  }

  function removeGuest(id: string) {
    start(async () => {
      const res = await deleteEventGuest(id);
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
  }

  function sendMessage() {
    if (!body.trim()) return toast.error("Write a message.");
    if (channel === "sms" && !smsAvailable)
      return toast.error("SMS isn't available in your country yet.");
    startSend(async () => {
      const res = await messageEventGuests({ eventId, channel, subject, body });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Sent to ${res.sent}${res.failed ? `, ${res.failed} failed` : ""}.`);
      setBody("");
      setSubject("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Speakers &amp; guests — {eventTitle}</DialogTitle>
        </DialogHeader>

        {/* Existing guests */}
        <div className="space-y-2">
          {guests.length === 0 ? (
            <p className="text-muted-foreground text-sm">No guests added yet.</p>
          ) : (
            guests.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-3 rounded-xl border p-2.5"
              >
                <div className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg text-xs font-bold">
                  {g.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {g.name}{" "}
                    <span className="text-muted-foreground font-normal">· {g.role}</span>
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {[g.email, g.phone].filter(Boolean).join(" · ") || "No contact"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove"
                  onClick={() => removeGuest(g.id)}
                  disabled={pending}
                  className="text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Add guest */}
        <div className="space-y-3 rounded-xl border p-3">
          <p className="flex items-center gap-2 text-sm font-bold">
            <UserPlus className="size-4" /> Add a guest
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (e.g. Speaker)" />
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" type="tel" />
          </div>
          <Button size="sm" onClick={addGuest} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add guest
          </Button>
        </div>

        {/* Message guests */}
        {guests.length > 0 && (
          <div className="space-y-3 rounded-xl border p-3">
            <p className="text-sm font-bold">Message all guests</p>
            <div className="flex gap-2">
              {(["email", "sms"] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannel(ch)}
                  className={
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors " +
                    (channel === ch
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground")
                  }
                >
                  {ch === "email" ? <Mail className="size-4" /> : <MessageSquare className="size-4" />}
                  {ch === "email" ? "Email" : "SMS"}
                </button>
              ))}
            </div>
            {channel === "sms" && !smsAvailable && (
              <p className="rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                SMS isn&apos;t available in your country yet — coming soon.
              </p>
            )}
            {channel === "email" && (
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject (optional)"
              />
            )}
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Your message… use {name}, {event} and {church}."
            />
            <Button
              size="sm"
              onClick={sendMessage}
              disabled={sending || (channel === "sms" && !smsAvailable)}
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send to guests
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
