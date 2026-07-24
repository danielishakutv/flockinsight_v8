"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { saveEvent, deleteEvent, type EventInput } from "@/app/(app)/my-events/actions";
import {
  EventGuestsDialog,
  type Guest,
} from "@/components/events/event-guests-dialog";
import {
  EventFormsDialog,
  type EventForm,
} from "@/components/events/event-forms-dialog";
import { ImageUpload } from "@/components/settings/image-upload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type EventRow = {
  id: string;
  title: string;
  description: string | null;
  flyerUrl: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  venue: string | null;
  address: string | null;
  isPublic: boolean;
};

type FormState = {
  id?: string;
  title: string;
  description: string;
  flyerUrl: string | null;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  address: string;
  isPublic: boolean;
};

function emptyEvent(): FormState {
  return {
    title: "",
    description: "",
    flyerUrl: null,
    date: "",
    startTime: "",
    endTime: "",
    venue: "",
    address: "",
    isPublic: true,
  };
}

export function EventsManager({
  events,
  baseUrl,
  publicEnabled = true,
  guestsByEvent = {},
  formsByEvent = {},
  unlinkedForms = [],
  canManageForms = false,
  smsAvailable = true,
}: {
  events: EventRow[];
  baseUrl: string;
  publicEnabled?: boolean;
  guestsByEvent?: Record<string, Guest[]>;
  formsByEvent?: Record<string, EventForm[]>;
  unlinkedForms?: { id: string; title: string }[];
  canManageForms?: boolean;
  smsAvailable?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyEvent());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [guestsFor, setGuestsFor] = useState<EventRow | null>(null);
  const [formsFor, setFormsFor] = useState<EventRow | null>(null);
  const set = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  async function copyLink(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      toast.success("Link copied");
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  function openNew() {
    setForm(emptyEvent());
    setOpen(true);
  }
  function openEdit(e: EventRow) {
    setForm({
      id: e.id,
      title: e.title,
      description: e.description ?? "",
      flyerUrl: e.flyerUrl,
      date: e.date,
      startTime: e.startTime ?? "",
      endTime: e.endTime ?? "",
      venue: e.venue ?? "",
      address: e.address ?? "",
      isPublic: e.isPublic,
    });
    setOpen(true);
  }

  function save() {
    start(async () => {
      const res = await saveEvent(form);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Event saved");
      setOpen(false);
      router.refresh();
    });
  }
  function remove(e: EventRow) {
    if (!confirm(`Delete "${e.title}"?`)) return;
    start(async () => {
      const res = await deleteEvent(e.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Event deleted");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {publicEnabled ? (
          <Button variant="outline" asChild>
            <a href={`${baseUrl}/events`} target="_blank" rel="noreferrer">
              <Globe className="size-4" /> Public events page
            </a>
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={openNew}>
          <Plus className="size-4" /> New event
        </Button>
      </div>

      {events.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="text-muted-foreground py-12 text-center">
            No events yet. Create your first one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex flex-wrap items-center gap-3 py-3">
                {e.flyerUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={e.flyerUrl}
                    alt=""
                    className="size-14 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="bg-primary/10 text-primary grid size-14 shrink-0 place-items-center rounded-lg">
                    <CalendarDays className="size-6" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{e.title}</p>
                    <Badge variant={e.isPublic ? "success" : "secondary"}>
                      {e.isPublic ? "Public" : "Private"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {format(parseISO(e.date), "EEE, MMM d, yyyy")}
                    {e.startTime ? ` · ${e.startTime}` : ""}
                    {e.venue ? ` · ${e.venue}` : ""}
                  </p>
                </div>
                {e.isPublic && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyLink(e.id, `${baseUrl}/events/${e.id}`)}
                      title="Copy public link"
                    >
                      {copiedId === e.id ? (
                        <Check className="size-4" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </Button>
                    <Button size="sm" variant="ghost" asChild title="Open public page">
                      <a href={`${baseUrl}/events/${e.id}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-4" />
                      </a>
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFormsFor(e)}
                  title="Registration forms"
                >
                  <FileText className="size-4" />
                  <span className="tabular-nums">
                    {(formsByEvent[e.id] ?? []).length || ""}
                  </span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setGuestsFor(e)}
                  title="Speakers & guests"
                >
                  <Users className="size-4" />
                  <span className="tabular-nums">
                    {(guestsByEvent[e.id] ?? []).length || ""}
                  </span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => openEdit(e)}>
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(e)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit event" : "New event"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="ev-title">Title</Label>
              <Input
                id="ev-title"
                value={form.title}
                onChange={(e) => set({ title: e.target.value })}
                placeholder="e.g. Annual Thanksgiving Service"
              />
            </div>
            <ImageUpload
              label="Flyer / poster"
              kind="cover"
              maxDim={1600}
              aspect="wide"
              value={form.flyerUrl ?? null}
              onChange={(url) => set({ flyerUrl: url })}
            />
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-2">
                <Label htmlFor="ev-date">Date</Label>
                <Input
                  id="ev-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => set({ date: e.target.value })}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ev-start">Start</Label>
                <Input
                  id="ev-start"
                  type="time"
                  value={form.startTime ?? ""}
                  onChange={(e) => set({ startTime: e.target.value })}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ev-end">End</Label>
                <Input
                  id="ev-end"
                  type="time"
                  value={form.endTime ?? ""}
                  onChange={(e) => set({ endTime: e.target.value })}
                  className="h-11"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-venue">Venue</Label>
              <Input
                id="ev-venue"
                value={form.venue ?? ""}
                onChange={(e) => set({ venue: e.target.value })}
                placeholder="e.g. Main Auditorium"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-address">Address</Label>
              <Input
                id="ev-address"
                value={form.address ?? ""}
                onChange={(e) => set({ address: e.target.value })}
                placeholder="Where is it held?"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-desc">About</Label>
              <Textarea
                id="ev-desc"
                rows={4}
                value={form.description ?? ""}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="What's happening? Who's it for?"
              />
            </div>
            <button
              type="button"
              onClick={() => set({ isPublic: !form.isPublic })}
              className="flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left"
            >
              <div>
                <p className="text-sm font-semibold">Show publicly</p>
                <p className="text-muted-foreground text-xs">
                  List on the public events page & your church page.
                </p>
              </div>
              <span
                className={
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors " +
                  (form.isPublic ? "bg-primary" : "bg-muted-foreground/30")
                }
              >
                <span
                  className={
                    "inline-block size-5 transform rounded-full bg-white shadow transition-transform " +
                    (form.isPublic ? "translate-x-5" : "translate-x-0.5")
                  }
                />
              </span>
            </button>
            {form.venue && (
              <p className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <MapPin className="size-3" /> {form.venue}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !form.title.trim() || !form.date}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {guestsFor && (
        <EventGuestsDialog
          open={!!guestsFor}
          onOpenChange={(o) => !o && setGuestsFor(null)}
          eventId={guestsFor.id}
          eventTitle={guestsFor.title}
          guests={guestsByEvent[guestsFor.id] ?? []}
          smsAvailable={smsAvailable}
        />
      )}

      {formsFor && (
        <EventFormsDialog
          open={!!formsFor}
          onOpenChange={(o) => !o && setFormsFor(null)}
          eventId={formsFor.id}
          eventTitle={formsFor.title}
          forms={formsByEvent[formsFor.id] ?? []}
          unlinkedForms={unlinkedForms}
          baseUrl={baseUrl}
          canManageForms={canManageForms}
        />
      )}
    </div>
  );
}
