"use server";

import { db } from "@/db";
import { platformSurveyResponse } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import {
  validateSubmission,
  type FieldValue,
  type FormField,
} from "@/lib/forms-shared";
import { churchForUser, getSurveyBySlug, hasAnswered } from "@/lib/surveys";

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string; errors?: Record<string, string> };

/**
 * Record one answer to a platform survey.
 *
 * Open to anyone with the link, signed in or not. A survey that only works for
 * people already logged in cannot reach the churches most worth hearing from —
 * the ones that stopped logging in.
 */
export async function submitSurvey(
  slug: string,
  values: Record<string, FieldValue>,
  honeypot: string,
): Promise<SubmitResult> {
  // Quietly accept and discard: a bot told it failed simply tries again.
  if (honeypot.trim() !== "") return { ok: true };

  const survey = await getSurveyBySlug(slug);
  if (!survey) return { ok: false, error: "That survey no longer exists." };
  if (survey.status !== "open") {
    return { ok: false, error: "This survey is no longer accepting answers." };
  }

  const fields = (survey.fields ?? []) as FormField[];
  const errors = validateSubmission(fields, values);
  if (Object.keys(errors).length > 0) {
    return { ok: false, error: "Please fix the highlighted questions.", errors };
  }

  /*
   * Anonymity is enforced where the row is written, not by hiding a column
   * later. If the church id were stored and merely not displayed, the promise
   * on the form would be false the moment anybody ran a query.
   */
  let churchId: string | null = null;
  let userId: string | null = null;

  if (!survey.anonymous) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user?.id) {
      userId = session.user.id;
      churchId = await churchForUser(session.user.id);
      if (churchId && (await hasAnswered(survey.id, churchId))) {
        return { ok: false, error: "Your church has already answered this one." };
      }
    }
  }

  const clean: Record<string, FieldValue> = {};
  for (const field of fields) {
    const v = values[field.id];
    if (v == null || v === "") continue;
    if (field.type === "checkboxes")
      clean[field.id] = Array.isArray(v) ? v.map(String).slice(0, 50) : [String(v)];
    else if (field.type === "yesno")
      clean[field.id] = v === true || v === "true" || v === "Yes";
    else if (field.type === "scale") clean[field.id] = Number(v);
    else clean[field.id] = String(v).slice(0, 5000);
  }

  await db.insert(platformSurveyResponse).values({
    surveyId: survey.id,
    churchId,
    userId,
    data: clean,
  });

  return { ok: true };
}
