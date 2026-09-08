"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  member,
  trainingCohort,
  trainingCourse,
  trainingEnrollment,
  trainingInstructor,
} from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { BADGE_COLOR_KEYS, TRAINING_BADGE_ICONS } from "@/lib/training-shared";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

const DENIED: ActionResult = {
  ok: false,
  error: "You don't have permission to manage training.",
};

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const optText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable());

const optDate = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date")
    .nullable(),
);

/** Every write starts here: the church, and the right to change its training. */
async function guard() {
  const { church, user } = await requireChurch();
  if (!(await can("training.manage"))) return null;
  return { churchId: church.id, userId: user.id };
}

/* ------------------------------------------------------------------ *
 * Ownership checks
 *
 * Every id that arrives from the client is re-read scoped to the active
 * church before it is used. A uuid is guessable enough to be worth guarding,
 * and without this a member of one church could enrol people into another
 * church's cohort by posting its id.
 * ------------------------------------------------------------------ */

async function courseInChurch(id: string, churchId: string) {
  const [row] = await db
    .select({ id: trainingCourse.id })
    .from(trainingCourse)
    .where(and(eq(trainingCourse.id, id), eq(trainingCourse.churchId, churchId)))
    .limit(1);
  return row?.id ?? null;
}

async function cohortInChurch(id: string, churchId: string) {
  const [row] = await db
    .select({ id: trainingCohort.id, courseId: trainingCohort.courseId })
    .from(trainingCohort)
    .where(and(eq(trainingCohort.id, id), eq(trainingCohort.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

async function membersInChurch(ids: string[], churchId: string) {
  if (ids.length === 0) return new Set<string>();
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.churchId, churchId), inArray(member.id, ids)));
  return new Set(rows.map((r) => r.id));
}

function refresh(cohortId?: string, courseId?: string) {
  revalidatePath("/training");
  revalidatePath("/members");
  if (courseId) revalidatePath(`/training/courses/${courseId}`);
  if (cohortId) revalidatePath(`/training/cohorts/${cohortId}`);
}

/* ------------------------------------------------------------------ *
 * Courses
 * ------------------------------------------------------------------ */

const courseSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  kind: z.enum(["class", "training", "course"]),
  description: optText(2000),
  level: z.coerce.number().int().min(1).max(20).default(1),
  badgeLabel: optText(20),
  badgeColor: z.enum(BADGE_COLOR_KEYS as [string, ...string[]]).default("indigo"),
  badgeIcon: z.enum(TRAINING_BADGE_ICONS).default("check"),
  showBadge: z.boolean().default(true),
  passMark: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(0).max(100).nullable(),
  ),
  issuesCertificate: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export type CourseInput = z.input<typeof courseSchema>;

export async function saveCourse(input: CourseInput): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;

  const parsed = courseSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  if (d.id) {
    if (!(await courseInChurch(d.id, g.churchId)))
      return { ok: false, error: "That course no longer exists." };
    await db
      .update(trainingCourse)
      .set({
        name: d.name,
        kind: d.kind,
        description: d.description,
        level: d.level,
        badgeLabel: d.badgeLabel,
        badgeColor: d.badgeColor,
        badgeIcon: d.badgeIcon,
        showBadge: d.showBadge,
        passMark: d.passMark,
        issuesCertificate: d.issuesCertificate,
        isActive: d.isActive,
      })
      .where(eq(trainingCourse.id, d.id));
    refresh(undefined, d.id);
    return { ok: true, id: d.id };
  }

  const [row] = await db
    .insert(trainingCourse)
    .values({
      churchId: g.churchId,
      name: d.name,
      kind: d.kind,
      description: d.description,
      level: d.level,
      badgeLabel: d.badgeLabel,
      badgeColor: d.badgeColor,
      badgeIcon: d.badgeIcon,
      showBadge: d.showBadge,
      passMark: d.passMark,
      issuesCertificate: d.issuesCertificate,
      isActive: d.isActive,
      createdBy: g.userId,
    })
    .returning({ id: trainingCourse.id });

  refresh();
  return { ok: true, id: row.id };
}

export async function deleteCourse(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;
  if (!(await courseInChurch(id, g.churchId))) return { ok: true };

  // Deleting a course deletes its cohorts and everybody's completion record
  // with them, so say so plainly rather than letting the cascade surprise
  // someone who only wanted it off the list.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(trainingEnrollment)
    .where(eq(trainingEnrollment.courseId, id));

  if (n > 0)
    return {
      ok: false,
      error: `${n} enrolment${n === 1 ? " has" : "s have"} been recorded against this course. Mark it inactive instead — deleting it would erase who completed it.`,
    };

  await db.delete(trainingCourse).where(eq(trainingCourse.id, id));
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Cohorts
 * ------------------------------------------------------------------ */

const cohortSchema = z.object({
  id: z.string().uuid().optional(),
  courseId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(120),
  status: z.enum(["upcoming", "running", "completed", "cancelled"]),
  startDate: optDate,
  endDate: optDate,
  venue: optText(160),
  meetingDay: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(0).max(6).nullable(),
  ),
  meetingTime: z.preprocess(
    emptyToNull,
    z.string().regex(/^\d{2}:\d{2}$/, "Invalid time").nullable(),
  ),
  capacity: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(1).max(10_000).nullable(),
  ),
  notes: optText(2000),
});

export type CohortInput = z.input<typeof cohortSchema>;

export async function saveCohort(input: CohortInput): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;

  const parsed = cohortSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  if (!(await courseInChurch(d.courseId, g.churchId)))
    return { ok: false, error: "That course no longer exists." };

  if (d.startDate && d.endDate && d.endDate < d.startDate)
    return { ok: false, error: "The end date is before the start date." };

  const values = {
    courseId: d.courseId,
    name: d.name,
    status: d.status,
    startDate: d.startDate,
    endDate: d.endDate,
    venue: d.venue,
    meetingDay: d.meetingDay,
    meetingTime: d.meetingTime,
    capacity: d.capacity,
    notes: d.notes,
  };

  if (d.id) {
    if (!(await cohortInChurch(d.id, g.churchId)))
      return { ok: false, error: "That class no longer exists." };
    await db
      .update(trainingCohort)
      .set(values)
      .where(eq(trainingCohort.id, d.id));
    refresh(d.id, d.courseId);
    return { ok: true, id: d.id };
  }

  const [row] = await db
    .insert(trainingCohort)
    .values({ ...values, churchId: g.churchId, createdBy: g.userId })
    .returning({ id: trainingCohort.id });

  refresh(row.id, d.courseId);
  return { ok: true, id: row.id };
}

export async function deleteCohort(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;
  const found = await cohortInChurch(id, g.churchId);
  if (!found) return { ok: true };

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(trainingEnrollment)
    .where(
      and(
        eq(trainingEnrollment.cohortId, id),
        eq(trainingEnrollment.status, "completed"),
      ),
    );

  if (n > 0)
    return {
      ok: false,
      error: `${n} ${n === 1 ? "person has" : "people have"} completed this class. Mark it completed or cancelled instead — deleting it would take their badges with it.`,
    };

  await db.delete(trainingCohort).where(eq(trainingCohort.id, id));
  refresh(undefined, found.courseId);
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Instructors
 * ------------------------------------------------------------------ */

const instructorSchema = z.object({
  cohortId: z.string().uuid(),
  memberId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  name: optText(120),
  role: optText(60),
});

export async function addInstructor(
  input: z.input<typeof instructorSchema>,
): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;

  const parsed = instructorSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const cohort = await cohortInChurch(d.cohortId, g.churchId);
  if (!cohort) return { ok: false, error: "That class no longer exists." };

  if (!d.memberId && !d.name)
    return { ok: false, error: "Pick a member, or type a name." };

  if (d.memberId) {
    const ok = await membersInChurch([d.memberId], g.churchId);
    if (!ok.has(d.memberId))
      return { ok: false, error: "That member isn't in your church." };
  }

  try {
    await db.insert(trainingInstructor).values({
      cohortId: d.cohortId,
      memberId: d.memberId,
      name: d.name,
      role: d.role,
    });
  } catch {
    // The unique index on (cohort, member) is the only thing that can fail here.
    return { ok: false, error: "They're already listed on this class." };
  }

  refresh(d.cohortId, cohort.courseId);
  return { ok: true };
}

export async function removeInstructor(
  id: string,
  cohortId: string,
): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;
  const cohort = await cohortInChurch(cohortId, g.churchId);
  if (!cohort) return { ok: false, error: "That class no longer exists." };

  await db
    .delete(trainingInstructor)
    .where(
      and(
        eq(trainingInstructor.id, id),
        eq(trainingInstructor.cohortId, cohortId),
      ),
    );

  refresh(cohortId, cohort.courseId);
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Enrolment
 * ------------------------------------------------------------------ */

export async function enrolMembers(
  cohortId: string,
  memberIds: string[],
): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;

  const parsed = z.array(z.string().uuid()).min(1).max(500).safeParse(memberIds);
  if (!parsed.success) return { ok: false, error: "Pick at least one person." };

  const cohort = await cohortInChurch(cohortId, g.churchId);
  if (!cohort) return { ok: false, error: "That class no longer exists." };

  const valid = await membersInChurch(parsed.data, g.churchId);
  const ids = parsed.data.filter((id) => valid.has(id));
  if (ids.length === 0)
    return { ok: false, error: "None of those people are in your church." };

  // Respect the cap, counting who is already on the register.
  const [{ current }] = await db
    .select({ current: sql<number>`count(*)::int` })
    .from(trainingEnrollment)
    .where(eq(trainingEnrollment.cohortId, cohortId));

  const [cap] = await db
    .select({ capacity: trainingCohort.capacity })
    .from(trainingCohort)
    .where(eq(trainingCohort.id, cohortId))
    .limit(1);

  if (cap?.capacity != null && current + ids.length > cap.capacity) {
    const room = Math.max(0, cap.capacity - current);
    return {
      ok: false,
      error:
        room === 0
          ? `This class is full (${cap.capacity}).`
          : `Only ${room} place${room === 1 ? "" : "s"} left — you picked ${ids.length}.`,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  await db
    .insert(trainingEnrollment)
    .values(
      ids.map((memberId) => ({
        churchId: g.churchId,
        cohortId,
        courseId: cohort.courseId,
        memberId,
        status: "enrolled" as const,
        enrolledAt: today,
        createdBy: g.userId,
      })),
    )
    // Someone added twice in one go, or already on the register, is not an
    // error worth failing the whole batch for.
    .onConflictDoNothing();

  refresh(cohortId, cohort.courseId);
  return { ok: true };
}

const resultSchema = z.object({
  id: z.string().uuid(),
  cohortId: z.string().uuid(),
  status: z.enum([
    "enrolled",
    "in_progress",
    "completed",
    "withdrawn",
    "failed",
  ]),
  score: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(0).max(100).nullable(),
  ),
  grade: optText(30),
  certificateNo: optText(60),
  completedAt: optDate,
  notes: optText(1000),
});

export type ResultInput = z.input<typeof resultSchema>;

/**
 * Record how someone did.
 *
 * Completing sets the date if one wasn't given, so the common case — tick
 * "completed", save — still produces a dated record. Moving off completed
 * clears it, so a date never outlives the completion it refers to.
 */
export async function saveResult(input: ResultInput): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;

  const parsed = resultSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const cohort = await cohortInChurch(d.cohortId, g.churchId);
  if (!cohort) return { ok: false, error: "That class no longer exists." };

  const completed = d.status === "completed";
  await db
    .update(trainingEnrollment)
    .set({
      status: d.status,
      score: d.score,
      grade: d.grade,
      certificateNo: d.certificateNo,
      completedAt: completed
        ? (d.completedAt ?? new Date().toISOString().slice(0, 10))
        : null,
      notes: d.notes,
    })
    .where(
      and(
        eq(trainingEnrollment.id, d.id),
        eq(trainingEnrollment.cohortId, d.cohortId),
        eq(trainingEnrollment.churchId, g.churchId),
      ),
    );

  refresh(d.cohortId, cohort.courseId);
  return { ok: true };
}

/** Mark a whole register complete in one go — the end-of-class action. */
export async function completeAll(cohortId: string): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;
  const cohort = await cohortInChurch(cohortId, g.churchId);
  if (!cohort) return { ok: false, error: "That class no longer exists." };

  const today = new Date().toISOString().slice(0, 10);
  await db
    .update(trainingEnrollment)
    .set({ status: "completed", completedAt: today })
    .where(
      and(
        eq(trainingEnrollment.cohortId, cohortId),
        eq(trainingEnrollment.churchId, g.churchId),
        // Leave people who withdrew or failed exactly as they are — "everyone
        // finished" means everyone still taking it, not a rewrite of history.
        inArray(trainingEnrollment.status, ["enrolled", "in_progress"]),
      ),
    );

  refresh(cohortId, cohort.courseId);
  return { ok: true };
}

export async function removeEnrollment(
  id: string,
  cohortId: string,
): Promise<ActionResult> {
  const g = await guard();
  if (!g) return DENIED;
  const cohort = await cohortInChurch(cohortId, g.churchId);
  if (!cohort) return { ok: false, error: "That class no longer exists." };

  await db
    .delete(trainingEnrollment)
    .where(
      and(
        eq(trainingEnrollment.id, id),
        eq(trainingEnrollment.cohortId, cohortId),
        eq(trainingEnrollment.churchId, g.churchId),
      ),
    );

  refresh(cohortId, cohort.courseId);
  return { ok: true };
}
