"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Award, CheckCircle2, Download, Loader2, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";
import { submitGuideQuiz, type SubmitResult } from "@/app/(app)/help/course/actions";
import { rankInfo, shuffleWith, type PublicQuiz } from "@/lib/certification-shared";
import { cn } from "@/lib/utils";

type Done = Extract<SubmitResult, { ok: true }>;

/**
 * One module's quiz. Native radios inside full-width labels, so every option
 * is a large tap target that wraps rather than truncates on a phone.
 *
 * The order arrives from the server (decided there, so the render matches
 * hydration). "Try again" reshuffles in its click handler, never during a
 * render. The value of each radio is the AUTHORED option index; grading is on
 * the server, and nothing here knows which option is right.
 */
export function GuideQuiz({
  slug,
  quiz,
  disabled = false,
}: {
  slug: string;
  quiz: PublicQuiz;
  disabled?: boolean;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [questions, setQuestions] = useState(quiz.questions);
  const [answers, setAnswers] = useState<(number | undefined)[]>(() => quiz.questions.map(() => undefined));
  const [result, setResult] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);

  const complete = answers.every((a) => a !== undefined);

  function choose(q: number, option: number) {
    setAnswers((prev) => prev.map((a, i) => (i === q ? option : a)));
  }

  function submit() {
    if (!complete || pending || disabled) return;
    setError(null);
    startTransition(async () => {
      let res: SubmitResult;
      try {
        res = await submitGuideQuiz({
          slug,
          version: quiz.version,
          answers: answers as number[],
        });
      } catch (e) {
        // A dropped connection or a server crash: say so beside the button
        // instead of letting the page fall over, and keep the answers.
        console.error("[course] submit failed", e);
        setError(t("course.requestFailed"));
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res);
      if (res.passed) toast.success(t("course.passedScore", { correct: res.correct, total: res.total }));
    });
  }

  function tryAgain() {
    const shuffle = shuffleWith(Math.random);
    setQuestions((prev) => prev.map((q) => ({ ...q, options: shuffle(q.options) })));
    setAnswers(quiz.questions.map(() => undefined));
    setResult(null);
    setError(null);
  }

  if (result) {
    return (
      <div className="space-y-4" aria-live="polite">
        {result.passed ? (
          <div className="flex gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0 space-y-2">
              <p className="font-bold">
                {t("course.passedScore", { correct: result.correct, total: result.total })}
              </p>
              {result.why.length > 0 && (
                <ul className="text-muted-foreground space-y-1 text-sm">
                  {result.why.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <XCircle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 space-y-2">
              <p className="font-bold">
                {t("course.failedScore", {
                  correct: result.correct,
                  total: result.total,
                  passMark: result.passMark,
                })}
              </p>
              {result.reread.length > 0 && (
                <ul className="space-y-1">
                  {result.reread.map((r) => (
                    <li key={r.anchor}>
                      <a href={`#${r.anchor}`} className="text-primary text-sm font-medium hover:underline">
                        {r.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {result.certificateError && (
          <p role="alert" className="text-destructive text-sm font-medium">
            {result.certificateError}
          </p>
        )}

        {result.newRanks.map((rank) => (
          <div
            key={rank}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-500/30 bg-violet-500/10 p-4"
          >
            <Award className="size-5 shrink-0 text-violet-600 dark:text-violet-400" />
            {/* min-w-48, not min-w-0: with a zero floor the sentence, not the
                button, gave way on a phone and read one letter per line. */}
            <p className="min-w-48 flex-1 font-bold">{t("course.newRank", { rank: rankInfo(rank).label })}</p>
            <Button asChild size="sm">
              {/* A route handler download, not a page: a plain anchor, no prefetch. */}
              <a href={`/help/course/certificate/${rank}`}>
                <Download className="size-4" /> {t("course.downloadCertificate")}
              </a>
            </Button>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={tryAgain}>
            <RotateCcw className="size-4" />
            {result.passed ? t("course.retakeForPractice") : t("course.tryAgain")}
          </Button>
          <Button asChild variant="ghost">
            <Link href="/help/course">{t("course.backToCourse")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-muted-foreground text-sm">
        {t("course.quizIntro", { total: questions.length, passMark: quiz.passMark })}
      </p>

      {questions.map((q, qi) => (
        <fieldset key={qi} className="space-y-2" disabled={disabled || pending}>
          <legend className="mb-2 text-[15px] leading-snug font-semibold">
            {qi + 1}. {q.q}
          </legend>
          {q.options.map((o) => {
            const checked = answers[qi] === o.index;
            return (
              <label
                key={o.index}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 text-[14px] leading-snug transition",
                  checked ? "border-primary bg-primary/5" : "hover:bg-accent/60",
                  (disabled || pending) && "cursor-not-allowed opacity-70",
                )}
              >
                <input
                  type="radio"
                  name={`${slug}-q${qi}`}
                  value={o.index}
                  checked={checked}
                  onChange={() => choose(qi, o.index)}
                  className="accent-primary mt-0.5 size-4 shrink-0"
                />
                <span className="min-w-0 break-words">{o.text}</span>
              </label>
            );
          })}
        </fieldset>
      ))}

      {error && (
        <p role="alert" className="text-destructive text-sm font-medium">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!complete || pending || disabled}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t("course.submitAnswers")}
        </Button>
        {!complete && !disabled && (
          <span className="text-muted-foreground text-xs">{t("course.answerEveryQuestion")}</span>
        )}
      </div>
    </form>
  );
}
