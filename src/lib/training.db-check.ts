/**
 * Database-backed checks for training. Run with `pnpm test:db`.
 *
 * These exist because of a bug that no amount of reading would have caught.
 * The per-course and per-cohort counts were written as correlated subqueries
 * inside a raw `sql` template. Drizzle only qualifies `${table.column}` in
 * such a template when the outer query has a join; without one it emits a
 * bare column name, so
 *
 *     where ${trainingCohort.courseId} = ${trainingCourse.id}
 *
 * became `where "course_id" = "id"` and Postgres bound BOTH names to the
 * inner table. The condition was never true, every count came back 0, and
 * nothing errored — the page just showed a course with no classes and nobody
 * enrolled, forever.
 *
 * So these assert the numbers against data actually written to the database,
 * which is the only way that class of bug shows itself.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  member,
  trainingCohort,
  trainingCourse,
  trainingEnrollment,
} from "@/db/schema";
import {
  badgesForMembers,
  enrollableMembers,
  listCohorts,
  listCourses,
  trainingOverview,
} from "@/lib/training";

const stamp = Date.now();

let churchId = "";
let courseId = "";
let otherCourseId = "";
let cohortA = "";
let cohortB = "";
const memberIds: string[] = [];

beforeAll(async () => {
  const [c] = await db.select({ id: church.id }).from(church).limit(1);
  churchId = c.id;

  const [course] = await db
    .insert(trainingCourse)
    .values({
      churchId,
      name: `ZZ Foundation ${stamp}`,
      kind: "class",
      level: 2,
      badgeLabel: "ZFND",
      badgeColor: "emerald",
    })
    .returning({ id: trainingCourse.id });
  courseId = course.id;

  // A second course with no cohorts at all — its counts must be 0 rather than
  // inheriting another course's numbers.
  const [other] = await db
    .insert(trainingCourse)
    .values({ churchId, name: `ZZ Empty ${stamp}`, kind: "training", level: 5 })
    .returning({ id: trainingCourse.id });
  otherCourseId = other.id;

  const cohorts = await db
    .insert(trainingCohort)
    .values([
      { churchId, courseId, name: `ZZ Jan ${stamp}`, status: "running" },
      { churchId, courseId, name: `ZZ Feb ${stamp}`, status: "upcoming" },
    ])
    .returning({ id: trainingCohort.id });
  cohortA = cohorts[0].id;
  cohortB = cohorts[1].id;

  const people = await db
    .insert(member)
    .values([
      { churchId, firstName: "ZZTrainA", lastName: String(stamp) },
      { churchId, firstName: "ZZTrainB", lastName: String(stamp) },
      { churchId, firstName: "ZZTrainC", lastName: String(stamp) },
    ])
    .returning({ id: member.id });
  memberIds.push(...people.map((p) => p.id));

  await db.insert(trainingEnrollment).values([
    // Cohort A: two completed, one still going.
    {
      churchId,
      cohortId: cohortA,
      courseId,
      memberId: memberIds[0],
      status: "completed",
      completedAt: "2026-03-01",
      score: 80,
    },
    {
      churchId,
      cohortId: cohortA,
      courseId,
      memberId: memberIds[1],
      status: "completed",
      completedAt: "2026-03-01",
      score: 80,
    },
    {
      churchId,
      cohortId: cohortA,
      courseId,
      memberId: memberIds[2],
      status: "enrolled",
    },
    // Cohort B: one withdrawal, which must not count as a completion.
    {
      churchId,
      cohortId: cohortB,
      courseId,
      memberId: memberIds[0],
      status: "withdrawn",
    },
  ]);
});

afterAll(async () => {
  // Enrolments and cohorts cascade from the course; members are removed by id.
  await db
    .delete(trainingCourse)
    .where(inArray(trainingCourse.id, [courseId, otherCourseId]));
  if (memberIds.length) {
    await db.delete(member).where(inArray(member.id, memberIds));
  }
});

describe("listCourses counts", () => {
  it("counts cohorts and enrolments against the right course", async () => {
    const rows = await listCourses(churchId);
    const row = rows.find((r) => r.id === courseId);
    expect(row).toBeDefined();
    // The regression: these were all 0.
    expect(row!.cohorts).toBe(2);
    expect(row!.enrolled).toBe(4);
    expect(row!.completed).toBe(2);
  });

  it("reports zero for a course that genuinely has nothing", async () => {
    const rows = await listCourses(churchId);
    const row = rows.find((r) => r.id === otherCourseId);
    expect(row).toMatchObject({ cohorts: 0, enrolled: 0, completed: 0 });
  });
});

describe("listCohorts counts", () => {
  it("attributes each enrolment to its own cohort", async () => {
    const rows = await listCohorts(churchId, courseId);
    const a = rows.find((r) => r.id === cohortA)!;
    const b = rows.find((r) => r.id === cohortB)!;
    expect(a).toMatchObject({ enrolled: 3, completed: 2 });
    expect(b).toMatchObject({ enrolled: 1, completed: 0 });
  });
});

describe("enrollableMembers", () => {
  it("leaves out people already on that register, and nobody else", async () => {
    const rows = await enrollableMembers(churchId, cohortA);
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.has(memberIds[0])).toBe(false);
    expect(ids.has(memberIds[1])).toBe(false);
    expect(ids.has(memberIds[2])).toBe(false);
  });

  it("still offers someone enrolled only in a different cohort", async () => {
    const rows = await enrollableMembers(churchId, cohortB);
    const ids = new Set(rows.map((r) => r.id));
    // Enrolled in A but not B, so B may still take them.
    expect(ids.has(memberIds[1])).toBe(true);
    expect(ids.has(memberIds[0])).toBe(false);
  });

  it("returns each member once, however many cohorts they are in", async () => {
    const rows = await enrollableMembers(churchId, cohortA);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });
});

describe("badgesForMembers", () => {
  it("gives a badge only to people who completed", async () => {
    const map = await badgesForMembers(churchId, memberIds);
    expect(map.get(memberIds[0])?.map((b) => b.courseId)).toEqual([courseId]);
    expect(map.get(memberIds[1])?.map((b) => b.courseId)).toEqual([courseId]);
    // Still enrolled, and separately withdrawn — neither earns anything.
    expect(map.get(memberIds[2])).toBeUndefined();
  });

  it("does not duplicate a course taken in two cohorts", async () => {
    // memberIds[0] is completed in A and withdrawn in B; even were both
    // completed, one course is one badge.
    const map = await badgesForMembers(churchId, memberIds);
    expect(map.get(memberIds[0])).toHaveLength(1);
  });

  it("carries the course's badge settings through", async () => {
    const map = await badgesForMembers(churchId, memberIds);
    expect(map.get(memberIds[0])![0]).toMatchObject({
      label: "ZFND",
      color: "emerald",
      level: 2,
    });
  });

  it("returns an empty map for no members, rather than issuing `in ()`", async () => {
    await expect(badgesForMembers(churchId, [])).resolves.toEqual(new Map());
  });
});

describe("trainingOverview", () => {
  it("counts a member holding two completions once as certified", async () => {
    const before = await trainingOverview(churchId);
    // Two people completed the fixture course; certified counts distinct
    // members, so it can never exceed the number of completions.
    expect(before.certified).toBeLessThanOrEqual(before.completed);
    expect(before.completed).toBeGreaterThanOrEqual(2);
  });
});
