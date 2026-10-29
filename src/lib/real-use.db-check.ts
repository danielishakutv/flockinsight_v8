/**
 * What counts as a church using FlockInsight, against a real Postgres. Run
 * with `pnpm test:db`.
 *
 * REAL_USE is raw SQL over six tables, and every way it can be wrong is
 * silent: a number on the Command centre that is merely off. So each rule in
 * lib/real-use-sql.ts gets a church of its own here, and the test reads what
 * REAL_USE says about each one.
 *
 * Cleans up by deleting the fixture churches and users, which cascades to
 * everything they own.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  analyticsEvent,
  auditLog,
  church,
  communicationLog,
  giving,
  member,
  session,
  staff,
  user,
} from "@/db/schema";
import { REAL_APP_EVENTS, REAL_USE } from "@/lib/real-use-sql";
import { classifyHealth } from "@/lib/health-rules";

const STAMP = Date.now().toString(36);
const id = (s: string) => `zzcheck-use-${s}-${STAMP}`;

const C = {
  weekly: id("weekly"),
  robots: id("robots"),
  actedAs: id("actedas"),
  demo: id("demo"),
  auditOnly: id("audit"),
  sessionOnly: id("session"),
};
const U = { pastor: id("pastor"), operator: id("operator"), demoUser: id("demouser") };

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

type Row = { church_id: string; last_seen: string | null; weeks: string };
let byChurch = new Map<string, Row>();

beforeAll(async () => {
  await db.insert(church).values(
    Object.entries(C).map(([k, cid]) => ({
      id: cid,
      name: `zzcheck use ${k}`,
      slug: cid,
      handle: cid,
      isDemo: k === "demo",
      createdAt: ago(90),
    })),
  );
  await db.insert(user).values(
    Object.values(U).map((uid) => ({ id: uid, name: uid, email: `${uid}@example.invalid` })),
  );
  await db.insert(staff).values([
    // The pastor really works in every church but the acted-as one.
    ...[C.weekly, C.robots, C.auditOnly, C.sessionOnly].map((cid) => ({
      id: `${cid}-pastor`,
      organizationId: cid,
      userId: U.pastor,
      role: "owner",
      temp: false,
    })),
    // The operator holds only the temp seat acting-as creates.
    { id: `${C.actedAs}-op`, organizationId: C.actedAs, userId: U.operator, role: "owner", temp: true },
    { id: `${C.demo}-u`, organizationId: C.demo, userId: U.demoUser, role: "owner", temp: false },
  ]);

  await db.insert(analyticsEvent).values([
    // Weekly: three different weeks of pageviews, and nothing else at all.
    ...[2, 9, 16].map((d) => ({
      churchId: C.weekly,
      userId: U.pastor,
      name: "Meetings",
      path: "/meetings",
      createdAt: ago(d),
    })),
    // Acted as: the operator browsing the church on their temp seat.
    { churchId: C.actedAs, userId: U.operator, name: "Members", path: "/members", createdAt: ago(1) },
    // Demo: a visitor on the shared login.
    { churchId: C.demo, userId: U.demoUser, name: "Dashboard", path: "/dashboard", createdAt: ago(1) },
  ]);

  // Robots: the birthday cron, a public welcome form and an online gift.
  await db.insert(communicationLog).values({
    churchId: C.robots,
    channel: "sms",
    audience: "Birthdays",
    body: "Happy birthday",
    createdAt: ago(1),
  });
  await db.insert(member).values({
    churchId: C.robots,
    firstName: "Visitor",
    status: "visitor",
    createdBy: null,
    createdAt: ago(1),
  });
  await db.insert(giving).values({
    churchId: C.robots,
    amount: 5000,
    date: ago(1).toISOString().slice(0, 10),
    recordedBy: null,
    createdAt: ago(1),
  });

  await db.insert(auditLog).values([
    // Acted as: an operator's write, flagged as impersonation.
    {
      scope: "church",
      churchId: C.actedAs,
      actorUserId: U.operator,
      viaImpersonation: true,
      action: "members.member.create",
      summary: "Added someone",
      createdAt: ago(1),
    },
    // Audit only: the pastor recorded a finance entry, beacon lost.
    {
      scope: "church",
      churchId: C.auditOnly,
      actorUserId: U.pastor,
      viaImpersonation: false,
      action: "finance.transaction.create",
      module: "finance",
      summary: "Recorded an expense",
      createdAt: ago(3),
    },
  ]);

  // Session only: signed in and pointed at the church, nothing else logged.
  await db.insert(session).values({
    id: id("sess"),
    token: id("tok"),
    userId: U.pastor,
    activeOrganizationId: C.sessionOnly,
    expiresAt: new Date(Date.now() + 7 * DAY),
    createdAt: ago(4),
    updatedAt: ago(4),
  });

  const res = await db.execute(sql`
    select church_id, max(at) as last_seen,
      count(distinct date_trunc('week', at)) as weeks
    from (${REAL_USE}) as u
    where church_id like ${`zzcheck-use-%-${STAMP}`}
    group by church_id
  `);
  byChurch = new Map((res.rows as Row[]).map((r) => [r.church_id, r]));
});

afterAll(async () => {
  await db.delete(church).where(inArray(church.id, Object.values(C)));
  await db.delete(user).where(inArray(user.id, Object.values(U)));
});

describe("REAL_USE", () => {
  it("counts a church whose people open the app every week, with no register", () => {
    const r = byChurch.get(C.weekly);
    expect(r).toBeDefined();
    expect(Number(r!.weeks)).toBe(3);
    // And the health rule then calls it healthy, not never activated.
    expect(
      classifyHealth({
        status: "active",
        createdAt: ago(90),
        lastSeenAt: new Date(r!.last_seen!),
        memberCount: 0,
        sessionCount: 0,
        activeWeeks: Number(r!.weeks),
      }),
    ).toBe("healthy");
  });

  it("ignores a cron send, a public form and an online gift", () => {
    expect(byChurch.has(C.robots)).toBe(false);
  });

  it("ignores an operator acting as the church", () => {
    expect(byChurch.has(C.actedAs)).toBe(false);
  });

  it("ignores the demo church", () => {
    expect(byChurch.has(C.demo)).toBe(false);
  });

  it("counts a staff action in the activity log", () => {
    expect(byChurch.has(C.auditOnly)).toBe(true);
  });

  it("counts a signed-in session pointed at the church", () => {
    const r = byChurch.get(C.sessionOnly);
    expect(r).toBeDefined();
    expect(Date.parse(r!.last_seen!)).toBeLessThanOrEqual(Date.now());
  });
});

describe("REAL_APP_EVENTS", () => {
  it("keeps the pastor's pageviews and drops the operator's and the demo's", async () => {
    const res = await db.execute(sql`
      select church_id, count(*) as n from (${REAL_APP_EVENTS}) as ev
      where church_id like ${`zzcheck-use-%-${STAMP}`}
      group by church_id
    `);
    const got = Object.fromEntries(
      (res.rows as { church_id: string; n: string }[]).map((r) => [r.church_id, Number(r.n)]),
    );
    expect(got).toEqual({ [C.weekly]: 3 });
  });
});
