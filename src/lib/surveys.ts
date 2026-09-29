import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  platformSurvey,
  platformSurveyResponse,
  staff,
} from "@/db/schema";
import { blankField, type FieldValue, type FormField } from "@/lib/forms-shared";
import type { Sample } from "@/lib/thin-data";

/**
 * Surveys the platform sends to its churches.
 *
 * Deliberately the same thing a church's own forms are, one level up: the field
 * definitions, validation and display helpers all come from `forms-shared`, so
 * a question type added for one is available to the other. Only the audience
 * differs — churches rather than members — which is why the tables are separate
 * rather than `form.churchId` being made nullable.
 */

export type SurveyTemplate = {
  key: string;
  title: string;
  description: string;
  /** Why you would send this one, shown when picking. */
  purpose: string;
  fields: FormField[];
};

const f = (
  type: FormField["type"],
  label: string,
  extra: Partial<FormField> = {},
): FormField => ({ ...blankField(type), label, ...extra });

/**
 * Starting points, not finished surveys.
 *
 * Each is short on purpose. A fourteen-question survey to a pastor who is
 * already not using the product gets no answers at all, and a response rate of
 * zero teaches you nothing — whereas two questions answered by four churches at
 * least tells you what four churches think.
 */
export const SURVEY_TEMPLATES: SurveyTemplate[] = [
  {
    key: "nps",
    title: "How are we doing?",
    description: "Two questions. It takes about twenty seconds.",
    purpose: "The standard recommendation score, plus room to say why.",
    fields: [
      f("scale", "How likely are you to recommend FlockInsight to another church?", {
        required: true,
        description: "0 is not at all likely, 10 is extremely likely.",
      }),
      f("long_text", "What is the main reason for your score?"),
    ],
  },
  {
    key: "missing",
    title: "What is missing?",
    description: "Tell us what FlockInsight should do next.",
    purpose: "Feature demand, straight from the people who would use it.",
    fields: [
      f("long_text", "What would make FlockInsight more useful for your church?", {
        required: true,
      }),
      f("radio", "How much is this holding you back?", {
        options: ["We manage without it", "It is annoying", "It is a real problem"],
      }),
    ],
  },
  {
    key: "onboarding",
    title: "How was getting started?",
    description: "A few questions about your first week.",
    purpose: "Sent to churches that recently signed up, to find the stuck points.",
    fields: [
      f("scale", "How easy was it to get started?", {
        required: true,
        description: "0 is very difficult, 10 is very easy.",
      }),
      f("long_text", "Was anything confusing or harder than it should have been?"),
      f("yesno", "Would you like someone to walk you through it?"),
    ],
  },
  {
    key: "exit",
    title: "Before you go",
    description: "Help us understand what did not work.",
    purpose: "For churches that stopped using it. The most useful answers you will get.",
    fields: [
      f("radio", "What is the main reason you stopped using FlockInsight?", {
        required: true,
        options: [
          "Too difficult to use",
          "Too expensive",
          "Missing something we needed",
          "We went back to our old way",
          "Nobody had time",
          "Something else",
        ],
      }),
      f("long_text", "Anything else you would like us to know?"),
    ],
  },
];

export type SurveyRow = {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "open" | "closed";
  anonymous: boolean;
  responses: number;
  createdAt: Date;
};

/** Every survey, newest first, with its response count. */
export async function listSurveys(): Promise<SurveyRow[]> {
  const rows = await db
    .select({
      id: platformSurvey.id,
      title: platformSurvey.title,
      slug: platformSurvey.slug,
      status: platformSurvey.status,
      anonymous: platformSurvey.anonymous,
      createdAt: platformSurvey.createdAt,
      responses: sql<number>`(
        select count(*) from platform_survey_response r
        where r.survey_id = platform_survey.id
      )`.mapWith(Number),
    })
    .from(platformSurvey)
    .orderBy(desc(platformSurvey.createdAt));

  return rows as SurveyRow[];
}

export async function getSurvey(id: string) {
  const [row] = await db
    .select()
    .from(platformSurvey)
    .where(eq(platformSurvey.id, id))
    .limit(1);
  return row ?? null;
}

export async function getSurveyBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(platformSurvey)
    .where(eq(platformSurvey.slug, slug))
    .limit(1);
  return row ?? null;
}

export type SurveyResults = {
  survey: NonNullable<Awaited<ReturnType<typeof getSurvey>>>;
  responses: {
    id: string;
    churchName: string | null;
    data: Record<string, FieldValue>;
    createdAt: Date;
  }[];
  /** Per-scale-field average and NPS, when the survey has one. */
  scales: { fieldId: string; label: string; average: number; nps: number | null }[];
  /** How many churches the survey was actually sent to. */
  audienceSize: number;
  sample: Sample;
};

/**
 * Net promoter score, the standard way.
 *
 * Promoters (9-10) minus detractors (0-6), as a percentage of everyone. Shown
 * beside the average rather than instead of it, because at five responses NPS
 * swings by forty points on one answer and the average at least moves smoothly.
 */
function npsFrom(values: number[]): number | null {
  if (values.length === 0) return null;
  const promoters = values.filter((v) => v >= 9).length;
  const detractors = values.filter((v) => v <= 6).length;
  return Math.round(((promoters - detractors) / values.length) * 100);
}

export async function getSurveyResults(id: string): Promise<SurveyResults | null> {
  const survey = await getSurvey(id);
  if (!survey) return null;

  const rows = await db
    .select({
      id: platformSurveyResponse.id,
      churchName: church.name,
      data: platformSurveyResponse.data,
      createdAt: platformSurveyResponse.createdAt,
    })
    .from(platformSurveyResponse)
    .leftJoin(church, eq(church.id, platformSurveyResponse.churchId))
    .where(eq(platformSurveyResponse.surveyId, id))
    .orderBy(desc(platformSurveyResponse.createdAt));

  const scales = survey.fields
    .filter((field) => field.type === "scale")
    .map((field) => {
      const values = rows
        .map((r) => Number(r.data[field.id]))
        .filter((n) => Number.isFinite(n));
      return {
        fieldId: field.id,
        label: field.label,
        average: values.length
          ? +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)
          : 0,
        nps: npsFrom(values),
      };
    });

  const audienceSize = await countAudience(survey);

  return {
    survey,
    responses: rows.map((r) => ({
      id: r.id,
      churchName: r.churchName,
      data: r.data,
      createdAt: r.createdAt,
    })),
    scales,
    audienceSize,
    sample: {
      n: rows.length,
      churches: new Set(rows.map((r) => r.churchName).filter(Boolean)).size,
      unit: "responses",
    },
  };
}

/** How many churches this survey is addressed to. */
export async function countAudience(
  s: Pick<
    NonNullable<Awaited<ReturnType<typeof getSurvey>>>,
    "audience" | "targetPlan" | "targetCountry" | "churchIds"
  >,
): Promise<number> {
  if (s.audience === "churches") return s.churchIds.length;
  const where =
    s.audience === "plan" && s.targetPlan
      ? eq(church.plan, s.targetPlan)
      : s.audience === "country" && s.targetCountry
        ? eq(church.country, s.targetCountry)
        : undefined;
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(church)
    .where(where ? and(eq(church.status, "active"), where) : eq(church.status, "active"));
  return row?.n ?? 0;
}

/**
 * Which church a signed-in person is answering for.
 *
 * Returns null when they belong to none, which is how a public link answer is
 * recorded — the survey is still worth having, it just carries no church.
 */
export async function churchForUser(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ churchId: staff.organizationId })
    .from(staff)
    .where(and(eq(staff.userId, userId), eq(staff.temp, false)))
    .limit(1);
  return row?.churchId ?? null;
}

/** Has this church already answered? */
export async function hasAnswered(
  surveyId: string,
  churchId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: platformSurveyResponse.id })
    .from(platformSurveyResponse)
    .where(
      and(
        eq(platformSurveyResponse.surveyId, surveyId),
        eq(platformSurveyResponse.churchId, churchId),
      ),
    )
    .limit(1);
  return !!row;
}
