"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  Plus,
  Loader2,
  FileText,
  Link2,
  BarChart3,
  CalendarDays,
  Pencil,
  Trash2,
  Eye,
  Send,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  createForm,
  deleteForm,
  setFormStatus,
} from "@/app/(app)/forms/actions";
import { useLiveCounts } from "@/components/forms/use-live-counts";
import type { FormStatus } from "@/lib/forms-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type FormRow = {
  id: string;
  title: string;
  slug: string;
  status: FormStatus;
  responseCount: number;
  updatedAt: string;
  eventId: string | null;
  eventTitle: string | null;
};

const STATUS: Record<FormStatus, { label: string; variant: "secondary" | "success" | "outline" }> = {
  draft: { label: "Draft", variant: "secondary" },
  open: { label: "Live", variant: "success" },
  closed: { label: "Closed", variant: "outline" },
};

export function FormsList({
  forms,
  canManage,
  baseUrl,
}: {
  forms: FormRow[];
  canManage: boolean;
  baseUrl: string;
}) {
  const router = useRouter();
  const [creating, startCreate] = useTransition();
  const liveCounts = useLiveCounts(
    Object.fromEntries(forms.map((f) => [f.id, f.responseCount])),
  );

  function create() {
    startCreate(async () => {
      const res = await createForm();
      if (res.ok && res.id) router.push(`/forms/${res.id}`);
      else if (!res.ok) toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={create} disabled={creating}>
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            New form
          </Button>
        </div>
      )}

      {forms.length === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed py-16 text-center">
          <FileText className="mx-auto mb-3 size-8 opacity-60" />
          No forms yet.
          {canManage && " Create your first form to start collecting responses."}
        </div>
      ) : (
        <div className="grid gap-3">
          {forms.map((f) => (
            <FormCard
              key={f.id}
              form={f}
              count={liveCounts[f.id] ?? f.responseCount}
              canManage={canManage}
              baseUrl={baseUrl}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FormCard({
  form: f,
  count,
  canManage,
  baseUrl,
}: {
  form: FormRow;
  count: number;
  canManage: boolean;
  baseUrl: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const link = `${baseUrl}/f/${f.slug}`;
  const status = STATUS[f.status];

  function copyLink() {
    navigator.clipboard
      .writeText(link)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Couldn't copy"));
  }

  function publish(next: FormStatus) {
    start(async () => {
      const res = await setFormStatus(f.id, next);
      if (res.ok) {
        toast.success(next === "open" ? "Form is live!" : "Form closed.");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function remove() {
    if (!confirm(`Delete "${f.title}" and all its responses? This can't be undone.`))
      return;
    start(async () => {
      const res = await deleteForm(f.id);
      if (res.ok) {
        toast.success("Form deleted");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="bg-card rounded-2xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold">{f.title}</p>
            <Badge variant={status.variant}>{status.label}</Badge>
            {f.eventId && (
              <Link href="/my-events">
                <Badge variant="secondary" className="gap-1">
                  <CalendarDays className="size-3" />
                  {f.eventTitle ?? "Event"}
                </Badge>
              </Link>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {count} response{count === 1 ? "" : "s"} · updated{" "}
            {format(parseISO(f.updatedAt), "MMM d, yyyy")}
          </p>
          {f.status !== "draft" && (
            <button
              type="button"
              onClick={copyLink}
              className="text-primary mt-1 inline-flex items-center gap-1 text-xs font-medium hover:underline"
            >
              <Link2 className="size-3.5" />
              /f/{f.slug}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button asChild variant="outline" size="sm">
            <Link href={`/forms/${f.id}/responses`}>
              <BarChart3 className="size-4" /> Responses
            </Link>
          </Button>
          {canManage ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={`/forms/${f.id}`}>
                  <Pencil className="size-4" /> Edit
                </Link>
              </Button>
              {f.status === "open" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => publish("closed")}
                  title="Stop accepting responses"
                >
                  <XCircle className="size-4" /> Close
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => publish("open")}
                  title="Publish & accept responses"
                >
                  <Send className="size-4" /> {f.status === "draft" ? "Publish" : "Reopen"}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={remove}
                className="text-muted-foreground hover:text-destructive"
                title="Delete"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
            </>
          ) : (
            f.status !== "draft" && (
              <Button asChild variant="ghost" size="sm">
                <a href={link} target="_blank" rel="noreferrer">
                  <Eye className="size-4" /> View
                </a>
              </Button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
