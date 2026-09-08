import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  member,
  trainingCohort,
  trainingCourse,
  trainingEnrollment,
  trainingInstructor,
} from "@/db/schema";
import { badgeLabelFor, type EarnedBadge } from "@/lib/training-shared";

export type CourseRow = typeof trainingCourse.$inferSelect;
export type CohortRow = typeof trainingCohort.$inferSelect;
export type EnrollmentRow = typeof trainingEnrollment.$inferSelect;

/* ------------------------------------------------------------------ *
 * Courses
 * ------------------------------------------------------------------ */

export type CourseWithCounts = CourseRow & {
  cohorts: number;
  enrolled: number;
  completed: number;
};

/**
 * Every course with the numbers the index page shows.
 *
 * Counted as grouped aggregates and joined in JS, NOT as correlated
 * subqueries. Inside a raw `sql` template drizzle only qualifies
 * `${table.column}` when the outer query has a join; without one it emits a
 * bare column name, so `where ${trainingCohort.courseId} = ${trainingCourse.id}`
 * becomes `where "course_id" = "id"` and Postgres binds BOTH to the inner
 * table. The condition is never true and every count comes back 0 — no error,
 * just a page of zeroes. See lib/sql-safety.test.ts, which fails the build on
 * that shape.
 *
 * Three queries instead of one also avoids the row multiplication that joining
 * cohorts and enrolments together would cause.
 */
export async function listCourses(churchId: string): Promise<CourseWithCounts[]> {
  const [courses, cohortCounts, enrolCounts] = await Promise.all([
    db
      .select()
      .from(trainingCourse)
      .where(eq(trainingCourse.churchId, churchId))
      .orderBy(
        asc(trainingCourse.position),
        asc(trainingCourse.level),
        asc(trainingCourse.name),
      ),
    db
      .select({
        courseId: trainingCohort.courseId,
        n: sql<number>`count(*)::int`,
      })
      .from(trainingCohort)
      .where(eq(trainingCohort.churchId, churchId))
      .groupBy(trainingCohort.courseId),
    db
      .select({
        courseId: trainingEnrollment.courseId,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${trainingEnrollment.status} = 'completed')::int`,
      })
      .from(trainingEnrollment)
      .where(eq(trainingEnrollment.churchId, churchId))
      .groupBy(trainingEnrollment.courseId),
  ]);

  const cohortsBy = new Map(cohortCounts.map((r) => [r.courseId, r.n]));
  const enrolBy = new Map(
    enrolCounts.map((r) => [r.courseId, { total: r.total, completed: r.completed }]),
  );

  return courses.map((c) => ({
    ...c,
    cohorts: cohortsBy.get(c.id) ?? 0,
    enrolled: enrolBy.get(c.id)?.total ?? 0,
    completed: enrolBy.get(c.id)?.completed ?? 0,
  }));
}

export async function getCourse(
  churchId: string,
  id: string,
): Promise<CourseRow | null> {
  const [row] = await db
    .select()
    .from(trainingCourse)
    .where(and(eq(trainingCourse.churchId, churchId), eq(trainingCourse.id, id)))
    .limit(1);
  return row ?? null;
}

/* ------------------------------------------------------------------ *
 * Cohorts
 * ------------------------------------------------------------------ */

export type CohortWithCounts = CohortRow & {
  courseName: string;
  courseKind: string;
  enrolled: number;
  completed: number;
};

/** Same grouped-aggregate shape as listCourses, and for the same reason. */
export async function listCohorts(
  churchId: string,
  courseId?: string,
): Promise<CohortWithCounts[]> {
  const where = courseId
    ? and(
        eq(trainingCohort.churchId, churchId),
        eq(trainingCohort.courseId, courseId),
      )
    : eq(trainingCohort.churchId, churchId);

  const [rows, enrolCounts] = await Promise.all([
    db
      .select({
        cohort: trainingCohort,
        courseName: trainingCourse.name,
        courseKind: trainingCourse.kind,
      })
      .from(trainingCohort)
      .innerJoin(trainingCourse, eq(trainingCourse.id, trainingCohort.courseId))
      .where(where)
      .orderBy(desc(trainingCohort.startDate), desc(trainingCohort.createdAt)),
    db
      .select({
        cohortId: trainingEnrollment.cohortId,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${trainingEnrollment.status} = 'completed')::int`,
      })
      .from(trainingEnrollment)
      .where(eq(trainingEnrollment.churchId, churchId))
      .groupBy(trainingEnrollment.cohortId),
  ]);

  const by = new Map(
    enrolCounts.map((r) => [r.cohortId, { total: r.total, completed: r.completed }]),
  );

  return rows.map((r) => ({
    ...r.cohort,
    courseName: r.courseName,
    courseKind: r.courseKind,
    enrolled: by.get(r.cohort.id)?.total ?? 0,
    completed: by.get(r.cohort.id)?.completed ?? 0,
  }));
}

export async function getCohort(
  churchId: string,
  id: string,
): Promise<(CohortRow & { course: CourseRow }) | null> {
  const [row] = await db
    .select({ cohort: trainingCohort, course: trainingCourse })
    .from(trainingCohort)
    .innerJoin(trainingCourse, eq(trainingCourse.id, trainingCohort.courseId))
    .where(and(eq(trainingCohort.churchId, churchId), eq(trainingCohort.id, id)))
    .limit(1);
  return row ? { ...row.cohort, course: row.course } : null;
}

/* ------------------------------------------------------------------ *
 * Instructors
 * ------------------------------------------------------------------ */

export type InstructorRow = {
  id: string;
  memberId: string | null;
  name: string;
  role: string | null;
};

export async function listInstructors(cohortId: string): Promise<InstructorRow[]> {
  const rows = await db
    .select({
      id: trainingInstructor.id,
      memberId: trainingInstructor.memberId,
      name: trainingInstructor.name,
      role: trainingInstructor.role,
      firstName: member.firstName,
      lastName: member.lastName,
    })
    .from(trainingInstructor)
    .leftJoin(member, eq(member.id, trainingInstructor.memberId))
    .where(eq(trainingInstructor.cohortId, cohortId))
    .orderBy(asc(trainingInstructor.createdAt));

  return rows.map((r) => ({
    id: r.id,
    memberId: r.memberId,
    // A member's current name wins over whatever was typed, so a person who
    // marries and changes their surname is renamed everywhere they taught.
    name:
      [r.firstName, r.lastName].filter(Boolean).join(" ") ||
      r.name ||
      "Unnamed instructor",
    role: r.role,
  }));
}

/* ------------------------------------------------------------------ *
 * Enrolments
 * ------------------------------------------------------------------ */

export type EnrollmentWithMember = EnrollmentRow & {
  firstName: string;
  lastName: string | null;
  phone: string | null;
  photoUrl: string | null;
};

export async function listEnrollments(
  cohortId: string,
): Promise<EnrollmentWithMember[]> {
  const rows = await db
    .select({
      e: trainingEnrollment,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone,
      photoUrl: member.photoUrl,
    })
    .from(trainingEnrollment)
    .innerJoin(member, eq(member.id, trainingEnrollment.memberId))
    .where(eq(trainingEnrollment.cohortId, cohortId))
    .orderBy(asc(member.firstName), asc(member.lastName));

  return rows.map((r) => ({
    ...r.e,
    firstName: r.firstName,
    lastName: r.lastName,
    phone: r.phone,
    photoUrl: r.photoUrl,
  }));
}

/** Everything one member has taken, for their profile. */
export async function memberTraining(churchId: string, memberId: string) {
  return db
    .select({
      enrollment: trainingEnrollment,
      courseName: trainingCourse.name,
      courseKind: trainingCourse.kind,
      badgeLabel: trainingCourse.badgeLabel,
      badgeColor: trainingCourse.badgeColor,
      badgeIcon: trainingCourse.badgeIcon,
      level: trainingCourse.level,
      passMark: trainingCourse.passMark,
      cohortName: trainingCohort.name,
      cohortId: trainingCohort.id,
    })
    .from(trainingEnrollment)
    .innerJoin(trainingCourse, eq(trainingCourse.id, trainingEnrollment.courseId))
    .innerJoin(trainingCohort, eq(trainingCohort.id, trainingEnrollment.cohortId))
    .where(
      and(
        eq(trainingEnrollment.churchId, churchId),
        eq(trainingEnrollment.memberId, memberId),
      ),
    )
    .orderBy(desc(trainingEnrollment.completedAt), desc(trainingEnrollment.createdAt));
}

/* ------------------------------------------------------------------ *
 * Badges
 * ------------------------------------------------------------------ */

/**
 * What each of these members has completed, for the badges beside their names.
 *
 * One query for the whole page. Called per member it would be a query per row,
 * which on a 500-member directory is 500 round trips for decoration.
 *
 * Returns an empty map for an empty input rather than issuing `in ()`, which
 * Postgres rejects.
 */
export async function badgesForMembers(
  churchId: string,
  memberIds: string[],
): Promise<Map<string, EarnedBadge[]>> {
  const out = new Map<string, EarnedBadge[]>();
  if (memberIds.length === 0) return out;

  const rows = await db
    .select({
      memberId: trainingEnrollment.memberId,
      completedAt: trainingEnrollment.completedAt,
      courseId: trainingCourse.id,
      name: trainingCourse.name,
      badgeLabel: trainingCourse.badgeLabel,
      badgeColor: trainingCourse.badgeColor,
      badgeIcon: trainingCourse.badgeIcon,
      level: trainingCourse.level,
    })
    .from(trainingEnrollment)
    .innerJoin(trainingCourse, eq(trainingCourse.id, trainingEnrollment.courseId))
    .where(
      and(
        eq(trainingEnrollment.churchId, churchId),
        eq(trainingEnrollment.status, "completed"),
        eq(trainingCourse.showBadge, true),
        inArray(trainingEnrollment.memberId, memberIds),
      ),
    )
    .orderBy(desc(trainingCourse.level), asc(trainingCourse.name));

  for (const r of rows) {
    const list = out.get(r.memberId) ?? [];
    // The same course taken twice (a retake, or a second cohort) is one badge.
    if (list.some((b) => b.courseId === r.courseId)) continue;
    list.push({
      courseId: r.courseId,
      name: r.name,
      label: badgeLabelFor({ name: r.name, badgeLabel: r.badgeLabel }),
      color: r.badgeColor,
      icon: r.badgeIcon,
      level: r.level,
      completedAt: r.completedAt,
    });
    out.set(r.memberId, list);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

export type TrainingOverview = {
  courses: number;
  activeCohorts: number;
  enrolled: number;
  completed: number;
  /** Distinct members holding at least one completed course. */
  certified: number;
};

export async function trainingOverview(
  churchId: string,
): Promise<TrainingOverview> {
  const [courses, cohorts, enrolments] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(trainingCourse)
      .where(
        and(
          eq(trainingCourse.churchId, churchId),
          eq(trainingCourse.isActive, true),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(trainingCohort)
      .where(
        and(
          eq(trainingCohort.churchId, churchId),
          eq(trainingCohort.status, "running"),
        ),
      ),
    db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${trainingEnrollment.status} = 'completed')::int`,
        certified: sql<number>`count(distinct ${trainingEnrollment.memberId}) filter (where ${trainingEnrollment.status} = 'completed')::int`,
      })
      .from(trainingEnrollment)
      .where(eq(trainingEnrollment.churchId, churchId)),
  ]);

  return {
    courses: courses[0]?.n ?? 0,
    activeCohorts: cohorts[0]?.n ?? 0,
    enrolled: enrolments[0]?.total ?? 0,
    completed: enrolments[0]?.completed ?? 0,
    certified: enrolments[0]?.certified ?? 0,
  };
}

/**
 * Members not yet in this cohort, for the "add people" picker.
 *
 * A left join and an IS NULL rather than a `not exists` raw template: drizzle
 * leaves `${member.id}` unqualified in a template on a single-table query, so
 * the correlated condition would bind to the inner table and match nobody —
 * the picker would keep offering people who are already on the register.
 *
 * Excluding them in SQL also keeps the list honest on a big congregation;
 * filtering client-side means shipping every member down.
 */
export async function enrollableMembers(churchId: string, cohortId: string) {
  return db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone,
    })
    .from(member)
    .leftJoin(
      trainingEnrollment,
      and(
        eq(trainingEnrollment.memberId, member.id),
        eq(trainingEnrollment.cohortId, cohortId),
      ),
    )
    .where(
      and(eq(member.churchId, churchId), isNull(trainingEnrollment.id)),
    )
    .orderBy(asc(member.firstName), asc(member.lastName));
}
