import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  attendanceRecord,
  attendanceSession,
  celebrationSetting,
  devotional,
  event,
  followUpInteraction,
  form,
  formResponse,
  giving,
  givingCategory,
  group,
  groupMembership,
  media,
  member,
  reminderSetting,
  role,
  service,
  subscriber,
} from "@/db/schema";
import {
  chunkForInsert,
  planChurchRestore,
  reviveDates,
  splitMemberLinks,
  type RestoreSource,
} from "@/lib/church-restore";

/**
 * A church backup, through the same JSON round trip the real one takes.
 *
 * The export route writes `JSON.stringify(exportChurch(id))` and the restore
 * action reads it back with a bare `JSON.parse`, so every Date in the backup
 * arrives as a string. drizzle's timestamp column calls `.toISOString()` on
 * whatever it is handed, which is how every restore of every non-empty church
 * failed. These tests build the SQL for every insert the restore makes, with
 * no database, so the throw is caught here rather than in front of an admin
 * who has just reset a church and needs it back.
 */

// drizzle.mock() builds SQL without a connection — enough to run each column's
// mapToDriverValue, which is where the throw was.
const sqlOnly = drizzle.mock({ casing: "snake_case" });

const OLD_CHURCH = "church-old";
const NEW_CHURCH = "church-new";
const at = new Date("2026-03-01T09:30:00.000Z");

const ids = {
  parent: "00000000-0000-4000-8000-000000000001",
  child: "00000000-0000-4000-8000-000000000002",
  visitor: "00000000-0000-4000-8000-000000000003",
  service: "00000000-0000-4000-8000-000000000010",
  session: "00000000-0000-4000-8000-000000000011",
  category: "00000000-0000-4000-8000-000000000012",
  group: "00000000-0000-4000-8000-000000000013",
  event: "00000000-0000-4000-8000-000000000014",
  form: "00000000-0000-4000-8000-000000000015",
  // Rows the backup never carries — they belong to the source church only.
  household: "00000000-0000-4000-8000-0000000000aa",
  project: "00000000-0000-4000-8000-0000000000bb",
  pledge: "00000000-0000-4000-8000-0000000000cc",
  // A member of SOME OTHER church entirely.
  stranger: "00000000-0000-4000-8000-0000000000dd",
};

function exported(): RestoreSource {
  const base = { churchId: OLD_CHURCH, createdAt: at };
  const backup = {
    version: 1,
    exportedAt: at.toISOString(),
    church: { id: OLD_CHURCH, name: "Grace Chapel", slug: "grace-chapel", createdAt: at },
    members: [
      {
        ...base,
        id: ids.parent,
        firstName: "Ada",
        status: "active",
        householdId: ids.household,
        updateToken: "tok-parent",
        userId: "user-1",
        assignedToId: "user-2",
        createdBy: "user-1",
        dateOfBirth: "1980-05-17",
        lastContactedAt: at,
        updatedAt: at,
        anniversaries: [],
      },
      {
        ...base,
        id: ids.child,
        firstName: "Bayo",
        status: "active",
        isMinor: true,
        guardianId: ids.parent,
        householdId: ids.household,
        updatedAt: at,
        anniversaries: [],
      },
      {
        ...base,
        id: ids.visitor,
        firstName: "Chi",
        status: "visitor",
        invitedById: ids.parent,
        // Pointing out of the backup: must not survive as-is.
        guardianId: ids.stranger,
        updatedAt: at,
        anniversaries: [],
      },
    ],
    services: [{ ...base, id: ids.service, name: "Sunday", dayOfWeek: 0 }],
    sessions: [
      {
        ...base,
        id: ids.session,
        serviceId: ids.service,
        date: "2026-03-01",
        recordedBy: "user-1",
        updatedAt: at,
      },
    ],
    records: [
      { id: "r1", sessionId: ids.session, memberId: ids.parent, checkedInAt: at },
      { id: "r2", sessionId: ids.session, memberId: ids.child, checkedInAt: at },
    ],
    categories: [{ ...base, id: ids.category, name: "Tithe" }],
    giving: [
      {
        ...base,
        id: "g1",
        categoryId: ids.category,
        memberId: ids.parent,
        amount: 5000,
        date: "2026-03-01",
        projectId: ids.project,
        pledgeId: ids.pledge,
        recordedBy: "user-1",
        updatedAt: at,
      },
    ],
    groups: [{ ...base, id: ids.group, name: "Choir", createdBy: "user-1", updatedAt: at }],
    memberships: [{ id: "gm1", groupId: ids.group, memberId: ids.child, createdAt: at }],
    followUps: [
      {
        ...base,
        id: "f1",
        memberId: ids.visitor,
        kind: "call",
        occurredAt: "2026-03-02",
        createdBy: "user-1",
      },
    ],
    roles: [{ ...base, id: "role-1", name: "Usher", permissions: [] }],
    forms: [
      {
        ...base,
        id: ids.form,
        title: "Welcome card",
        slug: "welcome-abc",
        eventId: ids.event,
        fields: [],
        updatedAt: at,
      },
    ],
    responses: [
      { ...base, id: "fr1", formId: ids.form, memberId: ids.visitor, answers: {} },
    ],
    devotionals: [
      {
        ...base,
        id: "d1",
        title: "Monday word",
        body: "…",
        status: "scheduled",
        scheduledAt: at,
        updatedAt: at,
      },
      {
        ...base,
        id: "d2",
        title: "Last week",
        body: "…",
        status: "sent",
        sentAt: at,
        updatedAt: at,
      },
    ],
    subscribers: [{ ...base, id: "s1", email: "a@example.com" }],
    events: [{ ...base, id: ids.event, title: "Harvest", date: "2026-04-01" }],
    media: [
      { id: "m1", kind: "photo", mime: "image/png", createdAt: at, expiresAt: at },
      {
        id: "m2",
        kind: "photo",
        mime: "image/jpeg",
        provider: "cloudinary",
        publicId: "flockinsight/old-church/harvest",
        resourceType: "image",
        url: "https://res.cloudinary.com/demo/image/upload/flockinsight/old-church/harvest.jpg",
        createdAt: at,
      },
    ],
    reminderSetting: { churchId: OLD_CHURCH, enabled: true, updatedAt: at },
    celebrationSetting: { churchId: OLD_CHURCH, enabled: true, updatedAt: at },
  };
  // The round trip the real backup takes: download, then upload.
  return JSON.parse(JSON.stringify(backup)) as RestoreSource;
}

/** The insert statement for one table, built exactly as the restore builds it. */
function insertSql(table: PgTable, rows: Record<string, unknown>[]) {
  return sqlOnly.insert(table).values(reviveDates(table, rows) as never).toSQL();
}

describe("church restore — JSON round trip", () => {
  it("really does arrive with strings where the Dates were", () => {
    const b = exported();
    expect(typeof b.members![0].createdAt).toBe("string");
  });

  it("would throw without reviving the dates — the original failure", () => {
    // Without this control the test below could pass because drizzle stopped
    // calling toISOString, not because the restore was fixed.
    const plan = planChurchRestore(exported(), NEW_CHURCH);
    expect(() =>
      sqlOnly.insert(member).values(plan.members as never).toSQL(),
    ).toThrow(/toISOString/);
  });

  it("builds every insert the restore makes without throwing", () => {
    const plan = planChurchRestore(exported(), NEW_CHURCH);
    const inserts: [PgTable, Record<string, unknown>[]][] = [
      [member, plan.members],
      [service, plan.services],
      [givingCategory, plan.categories],
      [group, plan.groups],
      [role, plan.roles],
      [attendanceSession, plan.sessions],
      [attendanceRecord, plan.records],
      [giving, plan.giving],
      [groupMembership, plan.memberships],
      [followUpInteraction, plan.followUps],
      [event, plan.events],
      [form, plan.forms],
      [formResponse, plan.responses],
      [devotional, plan.devotionals],
      [subscriber, plan.subscribers],
      [media, plan.media],
      [reminderSetting, [plan.reminderSetting!]],
      [celebrationSetting, [plan.celebrationSetting!]],
    ];
    for (const [table, rows] of inserts) {
      expect(rows.length).toBeGreaterThan(0);
      expect(() => insertSql(table, rows)).not.toThrow();
    }
  });

  it("revives timestamps to the same instant, and leaves string-mode dates alone", () => {
    const plan = planChurchRestore(exported(), NEW_CHURCH);
    const [parent] = reviveDates(member, plan.members);
    expect(parent.createdAt).toBeInstanceOf(Date);
    expect((parent.createdAt as Date).toISOString()).toBe(at.toISOString());
    expect((parent.lastContactedAt as Date).getTime()).toBe(at.getTime());
    // `date()` is string mode: turning it into a Date would shift a birthday
    // by the server's timezone.
    expect(parent.dateOfBirth).toBe("1980-05-17");
  });

  it("drops an unparseable timestamp so the column default applies", () => {
    const [row] = reviveDates(member, [{ id: "x", firstName: "Z", createdAt: "not a date" }]);
    expect("createdAt" in row).toBe(false);
  });

  it("keeps every row, and moves each one to the new church", () => {
    const src = exported();
    const plan = planChurchRestore(src, NEW_CHURCH);
    expect(plan.members).toHaveLength(src.members!.length);
    expect(plan.records).toHaveLength(src.records!.length);
    expect(plan.giving).toHaveLength(src.giving!.length);
    expect(plan.memberships).toHaveLength(src.memberships!.length);
    expect(plan.followUps).toHaveLength(src.followUps!.length);
    expect(plan.responses).toHaveLength(src.responses!.length);
    for (const rows of [plan.members, plan.services, plan.sessions, plan.giving, plan.forms]) {
      for (const r of rows) expect(r.churchId).toBe(NEW_CHURCH);
    }
  });

  it("never leaves a member pointing outside the restored church", () => {
    const plan = planChurchRestore(exported(), NEW_CHURCH);
    const newIds = new Set(plan.members.map((m) => m.id));
    const oldIds = new Set(Object.values(ids));

    for (const m of plan.members) {
      expect(oldIds.has(m.id as string)).toBe(false);
      for (const key of ["guardianId", "invitedById"] as const) {
        if (m[key] != null) expect(newIds.has(m[key] as string)).toBe(true);
      }
      // Households are not in the backup, and a token is the original's link.
      expect(m.householdId).toBeNull();
      expect(m.updateToken).toBeNull();
      expect(m.userId).toBeNull();
    }

    const [parent, child, visitor] = plan.members;
    expect(child.guardianId).toBe(parent.id);
    expect(visitor.invitedById).toBe(parent.id);
    // Pointed at a member the backup does not contain: cleared, not copied.
    expect(visitor.guardianId).toBeNull();
  });

  it("remaps or clears every other copied reference", () => {
    const plan = planChurchRestore(exported(), NEW_CHURCH);
    const memberIds = new Set(plan.members.map((m) => m.id));

    expect(plan.sessions[0].serviceId).toBe(plan.services[0].id);
    expect(plan.sessions[0].recordedBy).toBeNull();

    const [gift] = plan.giving;
    expect(gift.categoryId).toBe(plan.categories[0].id);
    expect(memberIds.has(gift.memberId as string)).toBe(true);
    expect(gift.projectId).toBeNull();
    expect(gift.pledgeId).toBeNull();

    for (const r of plan.records) {
      expect(r.sessionId).toBe(plan.sessions[0].id);
      expect(memberIds.has(r.memberId as string)).toBe(true);
    }
    expect(plan.memberships[0].groupId).toBe(plan.groups[0].id);
    expect(plan.forms[0].eventId).toBe(plan.events[0].id);
    expect(plan.forms[0].slug).not.toBe("welcome-abc");
    expect(plan.responses[0].formId).toBe(plan.forms[0].id);
    expect(memberIds.has(plan.responses[0].memberId as string)).toBe(true);
  });

  it("restores media as a reference the copy cannot destroy", () => {
    // Deleting a picture in the copy runs the ordinary delete path, which
    // destroys whatever public id the row names. With the original's id still
    // on it, that was the ORIGINAL church's file.
    const plan = planChurchRestore(exported(), NEW_CHURCH);
    const cloud = plan.media.find((m) => m.provider === "cloudinary")!;
    expect(cloud.publicId).toBeNull();
    expect(cloud.url).toMatch(/^https:\/\/res\.cloudinary\.com\//); // still shows
    for (const m of plan.media) {
      expect(m.publicId).toBeNull();
      expect(m.storageKey).toBeNull();
      expect(m.churchId).toBe(NEW_CHURCH);
    }
  });

  it("does not let the copy send anything until somebody has reviewed it", () => {
    const plan = planChurchRestore(exported(), NEW_CHURCH);
    const [scheduled, sent] = plan.devotionals;
    expect(scheduled.status).toBe("draft");
    expect(sent.status).toBe("sent");
    expect(plan.reminderSetting).toMatchObject({ churchId: NEW_CHURCH, enabled: false });
    expect(plan.celebrationSetting).toMatchObject({ churchId: NEW_CHURCH, enabled: false });
  });
});

describe("church restore — a church bigger than one statement", () => {
  it("chunks so no insert passes Postgres's 65,535-parameter ceiling", () => {
    // A member row is ~40 values: 5,000 members is 200,000 parameters, which
    // one statement refuses. Every chunk must stay under the ceiling.
    const row = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`c${i}`, i]));
    const rows = Array.from({ length: 5000 }, () => ({ ...row }));
    const chunks = chunkForInsert(rows);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toHaveLength(5000);
    for (const c of chunks) expect(c.length * 40).toBeLessThan(65_535);
    expect(chunkForInsert([])).toEqual([]);
  });

  it("inserts members unlinked and sets every guardian and inviter afterwards", () => {
    const plan = planChurchRestore(exported(), NEW_CHURCH);
    const { rows, links } = splitMemberLinks(plan.members);
    expect(rows).toHaveLength(plan.members.length);
    for (const r of rows) {
      expect(r.guardianId).toBeNull();
      expect(r.invitedById).toBeNull();
    }
    const [parent, child, visitor] = plan.members;
    expect(links).toEqual([
      { id: child.id, guardianId: parent.id, invitedById: null },
      { id: visitor.id, guardianId: null, invitedById: parent.id },
    ]);
    // The insert built from the unlinked rows still serialises.
    expect(() => insertSql(member, rows)).not.toThrow();
  });
});
