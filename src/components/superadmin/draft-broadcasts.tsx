"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  CalendarClock,
  FileText,
  Loader2,
  Pencil,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  createCatchUpDraft,
  deleteDraft,
  sendDraft,
} from "@/app/superadmin/notifications/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type DraftRow = {
  id: string;
  title: string;
  body: string;
  category: string;
  audienceLabel: string;
  channels: string;
  createdAt: string;
  updatedAt: string;
  /** Set when this was written automatically for a release. */
  sourceVersion: string | null;
};

export function DraftBroadcasts({ items }: { items: DraftRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function send(id: string, at?: string | null) {
    start(async () => {
      const res = await sendDraft(id, at ?? null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.scheduled
          ? "Scheduled."
          : `Sent · ${res.emailSent} email, ${res.pushSent} push.`,
      );
      setScheduling(null);
      setWhen("");
      router.refresh();
    });
  }

  function catchUp() {
    start(async () => {
      const res = await createCatchUpDraft(5);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Catch-up draft written — read it before you send it.");
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteDraft(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Draft deleted.");
      setConfirmDelete(null);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="size-4" /> Drafts ({items.length})
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={catchUp}
          title="Summarise the last 5 releases into one short notice"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          Catch-up draft
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing waiting. Write a notification and choose{" "}
            <span className="font-semibold">Save as draft</span> to keep it
            here — and every release writes one for you automatically.
          </p>
        ) : (
          items.map((d) => (
            <div key={d.id} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{d.title}</p>
                {d.sourceVersion && (
                  <Badge variant="secondary">Release {d.sourceVersion}</Badge>
                )}
                <Badge variant="outline" className="capitalize">
                  {d.category}
                </Badge>
                <Badge variant="secondary">{d.audienceLabel}</Badge>
              </div>
              <p className="text-muted-foreground mt-1 line-clamp-2 text-sm whitespace-pre-wrap">
                {d.body}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {d.channels || "No channel chosen"} · updated{" "}
                {format(new Date(d.updatedAt), "MMM d, h:mm a")}
              </p>

              {scheduling === d.id ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Input
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    className="w-auto"
                  />
                  <Button
                    size="sm"
                    disabled={pending || !when}
                    onClick={() => send(d.id, new Date(when).toISOString())}
                  >
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setScheduling(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : confirmDelete === d.id ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">Delete this draft?</p>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => remove(d.id)}
                  >
                    Delete
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDelete(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/superadmin/notifications?draft=${d.id}`}>
                      <Pencil className="size-3.5" /> Edit
                    </Link>
                  </Button>
                  <Button size="sm" disabled={pending} onClick={() => send(d.id)}>
                    {pending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Send className="size-3.5" />
                    )}
                    Send now
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setScheduling(d.id)}
                  >
                    <CalendarClock className="size-3.5" /> Schedule
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDelete(d.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
