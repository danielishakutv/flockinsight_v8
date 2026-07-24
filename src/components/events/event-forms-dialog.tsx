"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { createForm, setFormEvent } from "@/app/(app)/forms/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type EventForm = {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "open" | "closed";
  responseCount: number;
};

const STATUS: Record<EventForm["status"], { label: string; variant: "secondary" | "success" | "outline" }> = {
  draft: { label: "Draft", variant: "secondary" },
  open: { label: "Live", variant: "success" },
  closed: { label: "Closed", variant: "outline" },
};

/**
 * Manage the forms attached to an event: create a new registration form,
 * attach an existing one, open/copy/detach. A linked form shows in both the
 * Events and Forms screens.
 */
export function EventFormsDialog({
  open,
  onOpenChange,
  eventId,
  eventTitle,
  forms,
  unlinkedForms,
  baseUrl,
  canManageForms,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  eventId: string;
  eventTitle: string;
  forms: EventForm[];
  unlinkedForms: { id: string; title: string }[];
  baseUrl: string;
  canManageForms: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pickId, setPickId] = useState("");

  function createLinked() {
    start(async () => {
      const res = await createForm(eventId);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Registration form created");
      if (res.id) router.push(`/forms/${res.id}`);
    });
  }
  function linkExisting() {
    if (!pickId) return;
    start(async () => {
      const res = await setFormEvent(pickId, eventId);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Form attached to this event");
      setPickId("");
      router.refresh();
    });
  }
  function unlink(formId: string) {
    start(async () => {
      const res = await setFormEvent(formId, null);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Form detached");
      router.refresh();
    });
  }
  async function copy(f: EventForm) {
    try {
      await navigator.clipboard.writeText(`${baseUrl}/f/${f.slug}`);
      setCopiedId(f.id);
      toast.success("Link copied");
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="truncate">Forms · {eventTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {forms.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No forms attached yet. Add a registration or sign-up form so people
              can register for this event.
            </p>
          ) : (
            <div className="space-y-2">
              {forms.map((f) => {
                const st = STATUS[f.status];
                return (
                  <div key={f.id} className="rounded-xl border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="text-primary size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {f.title}
                      </span>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {f.responseCount} response{f.responseCount === 1 ? "" : "s"}
                      {f.status !== "draft" ? ` · /f/${f.slug}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/forms/${f.id}/responses`}>
                          <BarChart3 className="size-4" /> Responses
                        </Link>
                      </Button>
                      {canManageForms && (
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/forms/${f.id}`}>
                            <Pencil className="size-4" /> Edit
                          </Link>
                        </Button>
                      )}
                      {f.status !== "draft" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copy(f)}
                            title="Copy public link"
                          >
                            {copiedId === f.id ? (
                              <Check className="size-4" />
                            ) : (
                              <Copy className="size-4" />
                            )}
                          </Button>
                          <Button variant="ghost" size="sm" asChild title="Open form">
                            <a href={`${baseUrl}/f/${f.slug}`} target="_blank" rel="noreferrer">
                              <ExternalLink className="size-4" />
                            </a>
                          </Button>
                        </>
                      )}
                      {canManageForms && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => unlink(f.id)}
                          className="text-muted-foreground hover:text-destructive ml-auto"
                          title="Detach from event"
                        >
                          <Unlink className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {canManageForms && (
            <div className="space-y-3 border-t pt-4">
              <Button onClick={createLinked} disabled={pending} className="w-full">
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Create a registration form
              </Button>

              {unlinkedForms.length > 0 && (
                <div className="flex gap-2">
                  <Select value={pickId} onValueChange={setPickId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Attach an existing form…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {unlinkedForms.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    onClick={linkExisting}
                    disabled={pending || !pickId}
                  >
                    <Link2 className="size-4" /> Attach
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
