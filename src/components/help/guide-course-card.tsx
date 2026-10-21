"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Award, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";
import { GuideQuiz } from "@/components/help/guide-quiz";
import { markGuideComplete } from "@/app/(app)/help/course/actions";
import type { ModuleState, PublicQuiz } from "@/lib/certification-shared";

/**
 * The course card under a guide.
 *
 * Its state is local and seeded once from the server. The server actions
 * revalidate this page, and a fresh render must not yank a result the person
 * is still reading (the score, the re-read links, a new certificate) out from
 * under them by switching the card to its "passed" view.
 */
export function GuideCourseCard({
  slug,
  position,
  total,
  state: initialState,
  quiz: initialQuiz,
  best,
  readOnlyReason,
  holderName,
}: {
  slug: string;
  position: number;
  total: number;
  state: ModuleState;
  quiz: PublicQuiz | null;
  best: number | null;
  readOnlyReason: string | null;
  holderName: string | null;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(initialState);
  const [quiz, setQuiz] = useState(initialQuiz);
  const [retaking, setRetaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function markComplete() {
    setError(null);
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof markGuideComplete>>;
      try {
        res = await markGuideComplete(slug);
      } catch (e) {
        console.error("[course] mark complete failed", e);
        setError(t("course.requestFailed"));
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setQuiz(res.quiz);
      setState("read");
    });
  }

  const readOnly = readOnlyReason !== null;

  return (
    <div className="bg-card rounded-2xl border p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Award className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
            {t("course.moduleOf", { n: position, total })}
          </p>
          <Link href="/help/course" className="font-bold hover:underline">
            {t("course.title")}
          </Link>
        </div>
        {state === "passed" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-500/25 ring-inset dark:text-emerald-300">
            <CheckCircle2 className="size-3.5" />
            {t("course.modulePassed")}
            {best !== null && ` · ${best}%`}
          </span>
        )}
      </div>

      {readOnlyReason && (
        <p className="text-muted-foreground mb-4 rounded-xl border border-dashed p-3 text-sm">{readOnlyReason}</p>
      )}

      {holderName && !readOnly && (
        <p className="text-muted-foreground mb-4 text-sm">
          {t("course.certificateName", { name: holderName })}{" "}
          <Link href="/profile" className="text-primary font-medium hover:underline">
            {t("profile.title")}
          </Link>
        </p>
      )}

      {state === "unread" && (
        <div className="space-y-3">
          <Button type="button" onClick={markComplete} disabled={pending || readOnly}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("course.markComplete")}
          </Button>
          {error && (
            <p role="alert" className="text-destructive text-sm font-medium">
              {error}
            </p>
          )}
        </div>
      )}

      {state === "read" && quiz && <GuideQuiz slug={slug} quiz={quiz} disabled={readOnly} />}

      {state === "passed" && (
        <div className="space-y-4">
          {retaking && quiz ? (
            <GuideQuiz slug={slug} quiz={quiz} disabled={readOnly} />
          ) : (
            <div className="flex flex-wrap gap-2">
              {quiz && (
                <Button type="button" variant="outline" onClick={() => setRetaking(true)} disabled={readOnly}>
                  {t("course.retakeForPractice")}
                </Button>
              )}
              <Button asChild variant="ghost">
                <Link href="/help/course">{t("course.backToCourse")}</Link>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
