"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { submitSurvey } from "@/app/s/[slug]/actions";
import { FieldInput } from "@/components/forms/form-submit";
import {
  validateSubmission,
  type FieldValue,
  type FormField,
} from "@/lib/forms-shared";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";

/**
 * Answering a platform survey.
 *
 * The inputs come from the church form renderer, so a question type behaves
 * the same wherever it is asked and there is one place to fix it.
 */
export function SurveySubmit({
  slug,
  fields,
  anonymous,
}: {
  slug: string;
  fields: FormField[];
  anonymous: boolean;
}) {
  const t = useT();
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [hp, setHp] = useState("");

  const set = (id: string, v: FieldValue) => {
    setValues((p) => ({ ...p, [id]: v }));
    if (errors[id]) setErrors((p) => ({ ...p, [id]: "" }));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateSubmission(fields, values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setSubmitting(true);
    setFailure(null);
    try {
      const res = await submitSurvey(slug, values, hp);
      if (!res.ok) {
        // Named, not swallowed: "already answered" and "survey closed" need
        // different responses from the person reading it.
        setFailure(res.error);
        if (res.errors) setErrors(res.errors);
        return;
      }
      setDone(true);
    } catch {
      setFailure("That did not send. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="bg-card rounded-2xl border p-8 text-center">
        <CheckCircle2 aria-hidden className="text-success mx-auto size-10" />
        <p className="mt-3 text-lg font-semibold">{t("surveys.thankYou")}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          That is genuinely useful — it goes straight to the people building
          FlockInsight.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="bg-card space-y-6 rounded-2xl border p-6">
      {fields.map((f) => (
        <div key={f.id} className="space-y-2">
          <label className="block text-sm font-semibold" htmlFor={`f-${f.id}`}>
            {f.label}
            {f.required && <span className="text-destructive"> *</span>}
          </label>
          {f.description && (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {f.description}
            </p>
          )}
          <FieldInput
            field={f}
            value={values[f.id] ?? null}
            onChange={(v) => set(f.id, v)}
          />
          {errors[f.id] && (
            <p className="text-destructive text-xs font-medium">{errors[f.id]}</p>
          )}
        </div>
      ))}

      {/* Bots fill everything; people never see this. */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        className="sr-only"
      />

      {failure && (
        <p className="text-destructive text-sm font-medium">{failure}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting && <Loader2 className="size-4 animate-spin" />}
          Send my answer
        </Button>
        {anonymous && (
          <p className="text-muted-foreground text-xs">
            Anonymous — no church or name is recorded.
          </p>
        )}
      </div>
    </form>
  );
}
