"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Loader2, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import type { SurveyRow, SurveyTemplate } from "@/lib/surveys";
import { createFromTemplate, sendSurvey } from "@/app/superadmin/surveys/actions";
import { shareLabel } from "@/lib/thin-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The survey list, and the templates that start one.
 *
 * Templates lead rather than a blank builder. "Write a survey" is a task
 * somebody puts off; "send the recommendation one" is a decision they can make
 * in a moment, and the questions can still be edited afterwards.
 */
export function SurveysAdmin({
  surveys,
  templates,
  totalChurches,
  baseUrl,
}: {
  surveys: SurveyRow[];
  templates: SurveyTemplate[];
  totalChurches: number;
  baseUrl: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const startFrom = (key: string) =>
    start(async () => {
      setBusy(key);
      const res = await createFromTemplate(key);
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Draft created. Edit the questions, then open it.");
      if (res.id) router.push(`/superadmin/surveys/${res.id}`);
      router.refresh();
    });

  const send = (id: string) =>
    start(async () => {
      setBusy(id);
      const res = await sendSurvey(id);
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Sent.");
      router.refresh();
    });

  const copyLink = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(`${baseUrl}/s/${slug}`);
      toast.success("Link copied.");
    } catch {
      // Clipboard is blocked in some browsers and contexts; show the link so
      // it can still be copied by hand rather than failing silently.
      toast.info(`${baseUrl}/s/${slug}`);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Start from a template</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => (
              <button
                key={t.key}
                type="button"
                disabled={pending}
                onClick={() => startFrom(t.key)}
                className="hover:bg-accent/60 hover:border-primary/40 rounded-xl border p-3 text-left transition-colors disabled:opacity-60"
              >
                <div className="flex items-center gap-2">
                  {busy === t.key ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="text-primary size-4" />
                  )}
                  <span className="text-sm font-bold">{t.title}</span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  {t.purpose}
                </p>
                <p className="text-muted-foreground/80 mt-1 text-[11px]">
                  {t.fields.length} question{t.fields.length === 1 ? "" : "s"}
                </p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your surveys</CardTitle>
        </CardHeader>
        <CardContent>
          {surveys.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              No surveys yet. Pick a template above to start one.
            </p>
          ) : (
            <ul className="space-y-2">
              {surveys.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/superadmin/surveys/${s.id}`}
                      className="hover:text-primary truncate text-sm font-semibold"
                    >
                      {s.title}
                    </Link>
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <Badge
                        variant={
                          s.status === "open"
                            ? "success"
                            : s.status === "closed"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {s.status}
                      </Badge>
                      {s.anonymous && <span>Anonymous</span>}
                      <span>
                        {shareLabel(s.responses, totalChurches)} of churches answered
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Copy the link for ${s.title}`}
                      onClick={() => copyLink(s.slug)}
                    >
                      <Copy />
                    </Button>
                    {s.status === "open" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => send(s.id)}
                      >
                        {busy === s.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Send />
                        )}
                        Send
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
