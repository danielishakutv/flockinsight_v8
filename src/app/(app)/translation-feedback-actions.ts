"use server";

import { z } from "zod";
import { db } from "@/db";
import { translationFeedback } from "@/db/schema";
import { getSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";

export type FeedbackResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  suggestion: z.string().trim().min(2).max(2000),
  original: z.string().trim().max(500).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  path: z.string().trim().max(200).optional().nullable(),
});

/**
 * Record a correction to the translation.
 *
 * The locale is taken from the request rather than the form: what matters is
 * the language they were READING when it looked wrong, and a client that can
 * name its own locale is a client that can file a Swahili correction against
 * French.
 *
 * Signed in or not. A guest in a meeting reads the same strings as everybody
 * else and is as entitled to tell us they are wrong.
 */
export async function sendTranslationFeedback(
  input: unknown,
): Promise<FeedbackResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please write what it should say instead." };
  }

  const locale = await getLocale();
  if (locale === "en") {
    // Nothing to correct, and a sign something is wired wrong.
    return { ok: false, error: "This form is for translated languages." };
  }

  const session = await getSession().catch(() => null);

  await db.insert(translationFeedback).values({
    locale,
    churchId: session?.session?.activeOrganizationId ?? null,
    userId: session?.user?.id ?? null,
    path: parsed.data.path || null,
    original: parsed.data.original || null,
    suggestion: parsed.data.suggestion,
    note: parsed.data.note || null,
  });

  return { ok: true };
}
