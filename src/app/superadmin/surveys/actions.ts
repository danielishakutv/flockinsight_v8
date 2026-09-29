"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platformSurvey } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { recordAudit } from "@/lib/audit";
import { slugify, randomSuffix } from "@/lib/slug";
import { FIELD_TYPES, type FormFieldType } from "@/lib/forms-shared";
import { SURVEY_TEMPLATES, countAudience, getSurvey } from "@/lib/surveys";
import { LEADERSHIP_REACH, sendOutreach } from "@/lib/outreach";

export type ActionResult =
  | { ok: true; id?: string; message?: string }
  | { ok: false; error: string };

const fieldSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(FIELD_TYPES.map((t) => t.type) as [FormFieldType, ...FormFieldType[]]),
  label: z.string().trim().max(200).default(""),
  description: z.string().trim().max(500).optional(),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().max(120)).max(50).optional(),
});

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(600).optional(),
  status: z.enum(["draft", "open", "closed"]),
  anonymous: z.boolean().default(false),
  audience: z.enum(["all", "plan", "country", "churches"]),
  targetPlan: z.string().optional().nullable(),
  targetCountry: z.string().optional().nullable(),
  churchIds: z.array(z.string()).max(500).default([]),
  fields: z.array(fieldSchema).max(40),
});

export async function saveSurvey(input: unknown): Promise<ActionResult> {
  await requirePlatform("platform.messaging.send");

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the form and try again." };
  const d = parsed.data;

  if (d.status === "open" && d.fields.length === 0) {
    return { ok: false, error: "Add at least one question before opening it." };
  }

  const values = {
    title: d.title,
    description: d.description || null,
    status: d.status,
    anonymous: d.anonymous,
    audience: d.audience,
    targetPlan: (d.targetPlan || null) as never,
    targetCountry: d.targetCountry || null,
    churchIds: d.churchIds,
    fields: d.fields as never,
    updatedAt: new Date(),
    closedAt: d.status === "closed" ? new Date() : null,
  };

  if (d.id) {
    await db.update(platformSurvey).set(values).where(eq(platformSurvey.id, d.id));
    await recordAudit({
      action: "platform.survey.update",
      summary: `Updated survey "${d.title}"`,
      targetType: "survey",
      targetId: d.id,
      targetLabel: d.title,
    });
    revalidatePath("/superadmin/surveys");
    return { ok: true, id: d.id };
  }

  const [row] = await db
    .insert(platformSurvey)
    .values({ ...values, slug: `${slugify(d.title).slice(0, 40)}-${randomSuffix(5)}` })
    .returning({ id: platformSurvey.id });

  await recordAudit({
    action: "platform.survey.create",
    summary: `Created survey "${d.title}"`,
    targetType: "survey",
    targetId: row.id,
    targetLabel: d.title,
  });
  revalidatePath("/superadmin/surveys");
  return { ok: true, id: row.id };
}

/** Start a survey from one of the templates. */
export async function createFromTemplate(key: string): Promise<ActionResult> {
  await requirePlatform("platform.messaging.send");
  const t = SURVEY_TEMPLATES.find((x) => x.key === key);
  if (!t) return { ok: false, error: "Unknown template." };

  return saveSurvey({
    title: t.title,
    description: t.description,
    status: "draft",
    anonymous: key === "nps" || key === "exit",
    audience: "all",
    churchIds: [],
    fields: t.fields,
  });
}

/**
 * Send the survey out.
 *
 * Email only. SMS reaches a church's public phone rather than a person and
 * costs real money per page, which is a poor fit for a link somebody has to
 * open and think about — the WhatsApp and SMS routes stay manual, from the
 * outreach composer, where the cost is visible before sending.
 */
export async function sendSurvey(id: string): Promise<ActionResult> {
  await requirePlatform("platform.messaging.send");

  const survey = await getSurvey(id);
  if (!survey) return { ok: false, error: "That survey no longer exists." };
  if (survey.status !== "open") {
    return { ok: false, error: "Open the survey before sending it." };
  }
  if (survey.fields.length === 0) {
    return { ok: false, error: "This survey has no questions." };
  }

  const audience =
    survey.audience === "plan" && survey.targetPlan
      ? ({ kind: "churches", filter: "plan", plan: survey.targetPlan } as const)
      : survey.audience === "country" && survey.targetCountry
        ? ({ kind: "churches", filter: "country", country: survey.targetCountry } as const)
        : survey.audience === "churches"
          ? ({ kind: "churches", filter: "picked", ids: survey.churchIds } as const)
          : ({ kind: "churches", filter: "all" } as const);

  const res = await sendOutreach({
    channel: "email",
    audience,
    subject: survey.title,
    body: [
      "Hi {name},",
      survey.description || "We would value your answer to a couple of quick questions.",
      survey.anonymous
        ? "Your answers are anonymous — we do not record which church they came from."
        : "It takes less than a minute.",
    ].join("\n\n"),
    ctaLabel: "Answer the survey",
    ctaUrl: `/s/${survey.slug}`,
    reach: LEADERSHIP_REACH,
    purpose: "survey",
  });

  await recordAudit({
    action: "platform.survey.send",
    severity: "notice",
    summary: `Sent survey "${survey.title}" to ${res.sent} ${res.sent === 1 ? "person" : "people"}`,
    targetType: "survey",
    targetId: id,
    targetLabel: survey.title,
    meta: { sent: res.sent, failed: res.failed },
  });

  revalidatePath("/superadmin/surveys");
  return {
    ok: true,
    message: `Sent to ${res.sent}${res.failed ? `, ${res.failed} failed` : ""}.`,
  };
}

/** How many churches would receive this, before sending. */
export async function surveyReach(id: string): Promise<number> {
  await requirePlatform("platform.overview.view");
  const survey = await getSurvey(id);
  return survey ? countAudience(survey) : 0;
}
