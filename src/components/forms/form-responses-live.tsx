"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Download, Inbox, UserRound } from "lucide-react";
import { displayValue, type FormField, type FieldValue } from "@/lib/forms-shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Response = {
  id: string;
  data: Record<string, FieldValue>;
  memberId: string | null;
  memberName: string;
  createdAt: string;
};

export function FormResponsesLive({
  formId,
  fields,
  initial,
}: {
  formId: string;
  fields: FormField[];
  initial: Response[];
}) {
  const [responses, setResponses] = useState<Response[]>(initial);
  const [flash, setFlash] = useState<string[]>([]); // ids of just-arrived rows
  const latest = useRef(initial[0]?.createdAt ?? null);

  useEffect(() => {
    let active = true;
    async function poll() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const qs = latest.current ? `?after=${encodeURIComponent(latest.current)}` : "";
        const res = await fetch(`/api/forms/${formId}/responses${qs}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { responses?: Response[] };
        const fresh = data.responses ?? [];
        if (active && fresh.length > 0) {
          latest.current = fresh[0].createdAt;
          setResponses((prev) => {
            const seen = new Set(prev.map((r) => r.id));
            const add = fresh.filter((r) => !seen.has(r.id));
            if (add.length === 0) return prev;
            setFlash(add.map((r) => r.id));
            setTimeout(() => setFlash([]), 2500);
            return [...add, ...prev];
          });
        }
      } catch {
        /* try again next tick */
      }
    }
    const timer = setInterval(poll, 7000);
    const onVisible = () => !document.hidden && poll();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [formId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {responses.length} response{responses.length === 1 ? "" : "s"}
          <span className="ml-2 inline-flex items-center gap-1 text-xs">
            <span className="relative flex size-2">
              <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-60" />
              <span className="bg-success relative inline-flex size-2 rounded-full" />
            </span>
            live
          </span>
        </p>
        {responses.length > 0 && (
          <Button asChild variant="outline" size="sm">
            <a href={`/forms/${formId}/responses/export`}>
              <Download className="size-4" /> Export CSV
            </a>
          </Button>
        )}
      </div>

      {responses.length === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed py-16 text-center">
          <Inbox className="mx-auto mb-3 size-8 opacity-60" />
          No responses yet. Share the form link to start collecting.
        </div>
      ) : (
        <div className="space-y-3">
          {responses.map((r) => (
            <Card
              key={r.id}
              className={
                flash.includes(r.id) ? "ring-success/50 ring-2 transition" : "transition"
              }
            >
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-muted-foreground text-xs">
                    {format(parseISO(r.createdAt), "MMM d, yyyy · h:mm a")}
                  </p>
                  {r.memberId && (
                    <Link
                      href={`/members/${r.memberId}`}
                      className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
                    >
                      <UserRound className="size-3.5" />
                      {r.memberName || "Member"}
                    </Link>
                  )}
                </div>
                <dl className="divide-y">
                  {fields.map((field) => (
                    <div
                      key={field.id}
                      className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-4"
                    >
                      <dt className="text-muted-foreground w-48 shrink-0 text-sm">
                        {field.label}
                      </dt>
                      <dd className="text-sm font-medium">
                        {displayValue(r.data[field.id] ?? null) || "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
