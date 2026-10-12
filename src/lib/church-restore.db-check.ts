/**
 * A church backup, restored for real. Run with `pnpm test:db`.
 *
 * `church-restore.test.ts` proves the rows can be turned into SQL after a JSON
 * round trip. This file proves the half only Postgres can answer: that the
 * inserts are accepted (foreign keys, unique indexes, and the guardian and
 * inviter links — members go in unlinked, in chunks, and those self-references
 * are set afterwards by UPDATEs scoped to the new church id), and that nothing
 * in the restored church points back into the church it was copied from.
 *
 * Until this existed, every restore of a non-empty church failed — a timestamp
 * arrived as a string — and nothing anywhere said so until an admin needed it.
 *
 * Every row here is a fixture it created, named with a `zzcheck-` prefix, and
 * it removes only those churches, by id, at the end. Their rows go with them
 * through the church's ON DELETE CASCADE.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceRecord,
  attendanceSession,
  church,
  giving,
  member,
  service,
} from "@/db/schema";
import { exportChurch, restoreChurchAsNew, type ChurchBackup } from "@/lib/church-data";

const STAMP = Date.now().toString(36);
const SOURCE_ID = `zzcheck-restore-${STAMP}`;
let restoredId = "";

const PARENT = crypto.randomUUID();
const CHILD = crypto.randomUUID();
const VISITOR = crypto.randomUUID();
const SERVICE = crypto.randomUUID();
const SESSION = crypto.randomUUID();

beforeAll(async () => {
  await db.insert(church).values({
    id: SOURCE_ID,
    name: `zzcheck restore ${STAMP}`,
    slug: `zzcheck-restore-${STAMP}`,
  });
  await db.insert(member).values([
    {
      id: PARENT,
      churchId: SOURCE_ID,
      firstName: "Ada",
      updateToken: `zzcheck-token-${STAMP}`,
      lastContactedAt: new Date("2026-02-01T10:00:00Z"),
    },
    { id: CHILD, churchId: SOURCE_ID, firstName: "Bayo", isMinor: true, guardianId: PARENT },
    { id: VISITOR, churchId: SOURCE_ID, firstName: "Chi", status: "visitor", invitedById: PARENT },
  ]);
  await db.insert(service).values({ id: SERVICE, churchId: SOURCE_ID, name: "Sunday" });
  await db.insert(attendanceSession).values({
    id: SESSION,
    churchId: SOURCE_ID,
    serviceId: SERVICE,
    date: "2026-03-01",
  });
  await db.insert(attendanceRecord).values([
    { sessionId: SESSION, memberId: PARENT },
    { sessionId: SESSION, memberId: CHILD },
  ]);
  await db.insert(giving).values({
    churchId: SOURCE_ID,
    memberId: PARENT,
    amount: 2500,
    date: "2026-03-01",
  });
});

afterAll(async () => {
  const ids = [SOURCE_ID, restoredId].filter(Boolean);
  await db.delete(church).where(inArray(church.id, ids));
});

describe("restoring a downloaded backup", () => {
  it("creates a new church with every row, through a JSON round trip", async () => {
    const backup = await exportChurch(SOURCE_ID);
    expect(backup).not.toBeNull();
    // Exactly what the download and the upload do to it.
    const roundTripped = JSON.parse(JSON.stringify(backup)) as ChurchBackup;

    const res = await restoreChurchAsNew(roundTripped);
    if (!res.ok) throw new Error(`restore refused: ${res.error}`);
    restoredId = res.churchId;
    expect(restoredId).not.toBe(SOURCE_ID);

    const members = await db.select().from(member).where(eq(member.churchId, restoredId));
    expect(members).toHaveLength(3);

    const sessions = await db
      .select({ id: attendanceSession.id })
      .from(attendanceSession)
      .where(eq(attendanceSession.churchId, restoredId));
    expect(sessions).toHaveLength(1);
    const records = await db
      .select({ memberId: attendanceRecord.memberId })
      .from(attendanceRecord)
      .where(eq(attendanceRecord.sessionId, sessions[0].id));
    expect(records).toHaveLength(2);

    const gifts = await db.select().from(giving).where(eq(giving.churchId, restoredId));
    expect(gifts).toHaveLength(1);
    expect(gifts[0].amount).toBe(2500);
  });

  it("points nothing in the restored church back at the source", async () => {
    const members = await db.select().from(member).where(eq(member.churchId, restoredId));
    const restoredIds = new Set(members.map((m) => m.id));
    const sourceIds = new Set([PARENT, CHILD, VISITOR]);

    for (const m of members) {
      expect(sourceIds.has(m.id)).toBe(false);
      for (const ref of [m.guardianId, m.invitedById]) {
        if (ref) expect(restoredIds.has(ref)).toBe(true);
      }
      expect(m.updateToken).toBeNull();
    }

    const ada = members.find((m) => m.firstName === "Ada")!;
    expect(members.find((m) => m.firstName === "Bayo")!.guardianId).toBe(ada.id);
    expect(members.find((m) => m.firstName === "Chi")!.invitedById).toBe(ada.id);
    // A timestamp made the trip as the same instant.
    expect(ada.lastContactedAt?.toISOString()).toBe("2026-02-01T10:00:00.000Z");

    const [gift] = await db.select().from(giving).where(eq(giving.churchId, restoredId));
    expect(gift.memberId).toBe(ada.id);
  });

  it("leaves the source church exactly as it was", async () => {
    const members = await db.select().from(member).where(eq(member.churchId, SOURCE_ID));
    expect(members).toHaveLength(3);
    expect(members.find((m) => m.id === PARENT)!.updateToken).toBe(`zzcheck-token-${STAMP}`);
  });
});
