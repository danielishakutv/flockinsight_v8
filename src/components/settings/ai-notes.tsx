"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/components/i18n-provider";
import { saveChurchAiNotesAction } from "@/app/(app)/settings/ai/actions";
import { cn } from "@/lib/utils";

type Props = {
  /** What is stored now, already scrubbed. */
  notes: string;
  max: number;
  /** Acting as the church, or the demo church: shown, never editable. */
  locked: boolean;
  /** The plan includes the church advisor, the only thing that reads these. */
  onPlan: boolean;
  /** AI features are switched on. Notes can be written either way. */
  aiOn: boolean;
  /** The advisor's plan name, for the off-plan line. */
  planName: string;
};

/**
 * "About our church": a few lines the church advisor is given with every
 * answer, so it can speak the church's own language (what the services are
 * called, what this year is about) instead of guessing.
 *
 * After a save the box shows what was STORED, which is what will be sent:
 * phone numbers, emails and addresses come back as placeholders, and a line
 * says how many were taken out, so nobody believes a number they typed is
 * still in there.
 */
export function AiNotes({ notes, max, locked, onPlan, aiOn, planName }: Props) {
  const t = useT();
  const router = useRouter();
  const [text, setText] = useState(notes);
  const [saved, setSaved] = useState(notes);
  const [removed, setRemoved] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Clearing is always allowed, even off the plan: taking words back must
  // never need an upgrade. Writing needs the plan.
  const readOnly = locked || (!onPlan && !saved);
  const over = text.trim().length > max;
  const dirty = text.trim() !== saved.trim();
  const canSave = !locked && dirty && !over && (onPlan || !text.trim());

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await saveChurchAiNotesAction({ notes: text });
        if (!res.ok) {
          const msg = res.code ? t(res.code === "tooLong" ? "ai.notesTooLong" : `ai.${res.code}`, { max }) : res.error;
          setError(msg);
          toast.error(msg);
          return;
        }
        setText(res.notes);
        setSaved(res.notes);
        setRemoved(res.redactions);
        toast.success(t("ai.notesSaved"));
        router.refresh();
      } catch (e) {
        console.error("[ai-notes] save failed", e);
        setError(t("ai.notesFailed"));
      }
    });
  }

  return (
    <section className="bg-card space-y-3 rounded-2xl border p-4" aria-labelledby="ai-notes-heading">
      <div>
        <Label htmlFor="ai-notes" id="ai-notes-heading" className="font-semibold">
          {t("ai.notesTitle")}
        </Label>
        <p className="text-muted-foreground mt-1 text-sm">{t("ai.notesHelp")}</p>
      </div>

      <Textarea
        id="ai-notes"
        rows={5}
        value={text}
        maxLength={max + 200}
        readOnly={readOnly}
        disabled={pending}
        aria-invalid={over || undefined}
        aria-describedby="ai-notes-count"
        placeholder={t("ai.notesPlaceholder")}
        className="text-base sm:text-sm"
        onChange={(e) => {
          setText(e.target.value);
          setRemoved(0);
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          id="ai-notes-count"
          className={cn("text-xs tabular-nums", over ? "text-destructive font-semibold" : "text-muted-foreground")}
          aria-live="polite"
        >
          {t("ai.notesCount", { count: text.trim().length, max })}
        </p>
        {!locked && (
          <Button onClick={save} disabled={!canSave || pending} className="w-full sm:w-auto" aria-busy={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("ai.notesSave")}
          </Button>
        )}
      </div>

      {removed > 0 && (
        <p className="text-sm text-amber-800 dark:text-amber-200" role="status">
          {t("ai.notesRemoved", { count: removed })}
        </p>
      )}
      {locked && <p className="text-muted-foreground text-sm">{t("ai.notesLocked")}</p>}
      {!locked && !onPlan && <p className="text-muted-foreground text-sm">{t("ai.notesOffPlan", { plan: planName })}</p>}
      {!locked && onPlan && !aiOn && <p className="text-muted-foreground text-sm">{t("ai.notesWhileOff")}</p>}
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
