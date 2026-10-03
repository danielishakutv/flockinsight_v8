/**
 * Database-backed checks for repeating meetings. Run with `pnpm test:db`.
 *
 * The recurrence arithmetic is covered by `meeting-recurrence.test.ts`, which
 * needs no database. What is asserted here is everything the arithmetic cannot
 * see: that exactly one future occurrence exists no matter how many times the
 * roll-forward is called, that a saved link keeps working, that each occurrence
 * gets its own register rather than inheriting the last one's, and that a series
 * nobody opens eventually stops generating rows.
 *
 * Those are the properties a church would notice. A duplicate occurrence means
 * two links to Wednesday prayer and half the congregation in each.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { church, meeting } from "@/db/schema";
import {
  continueDueSeries,
  endMeeting,
  resolveMeetingByCode,
  rollSeriesForward,
  listSeriesOccurrences,
} from "@/lib/meetings";
import { MAX_MISSED_RUNS } from "@/lib/meeting-recurrence";
import type { PlanId } from "@/lib/plans";

const stamp = Date.now();
let churchId = "";
let timezone = "Africa/Lagos";
/** The plan this church was really on, put back in `afterAll`. */
let realPlan: PlanId = "starter";
const made: string[] = [];

/**
 * Repeating meetings are a paid upgrade, so the fixture church is put on a plan
 * that includes them for the duration of this file and put back afterwards.
 *
 * Every test here is about the chain rather than about the gate, and a suite
 * that silently tested nothing because the test church happened to be on Growth
 * would be worse than no suite at all — which is exactly what happened the first
 * time this ran.
 */
async function setPlan(plan: PlanId) {
  await db.update(church).set({ plan }).where(eq(church.id, churchId));
}

/** The first occurrence of a series, as the form would have created it. */
async function startSeries(opts: {
  repeat: string;
  scheduledFor: Date;
  repeatUntil?: Date | null;
  access?: "open" | "passcode";
  missedRuns?: number;
}) {
  const [row] = await db
    .insert(meeting)
    .values({
      churchId,
      code: `zz-${String(stamp).slice(-4)}-${Math.random().toString(36).slice(2, 5)}`,
      title: `ZZ series probe ${stamp}`,
      scheduledFor: opts.scheduledFor,
      repeatAnchor: opts.scheduledFor,
      repeat: opts.repeat,
      repeatUntil: opts.repeatUntil ?? null,
      access: opts.access ?? "open",
      passcode: opts.access === "passcode" ? "123456" : null,
      hostKey: `zzhost${stamp}`,
      missedRuns: opts.missedRuns ?? 0,
      status: "live",
      startedAt: new Date(),
    })
    .returning({ id: meeting.id, code: meeting.code });
  made.push(row.id);
  return row;
}

async function read(id: string) {
  const [row] = await db.select().from(meeting).where(eq(meeting.id, id)).limit(1);
  return row;
}

/** Every row in the same series, oldest first. */
async function occurrences(seriesId: string) {
  const rows = await db
    .select()
    .from(meeting)
    .where(or(eq(meeting.seriesId, seriesId), eq(meeting.id, seriesId)))
    .orderBy(meeting.occurrence);
  for (const r of rows) if (!made.includes(r.id)) made.push(r.id);
  return rows;
}

beforeAll(async () => {
  const [c] = await db
    .select({ id: church.id, timezone: church.timezone, plan: church.plan })
    .from(church)
    .limit(1);
  churchId = c.id;
  timezone = c.timezone;
  realPlan = c.plan;
  await setPlan("pro");
});

afterAll(async () => {
  // The plan first: it belongs to a real church row that other files read, and
  // leaving it changed would be this suite breaking the next one.
  await setPlan(realPlan);
  if (made.length) await db.delete(meeting).where(inArray(meeting.id, made));
});

/** A past Wednesday, so "the next one" is always in the future. */
const lastWeek = () => new Date(Date.now() - 7 * 24 * 3_600_000);

describe("a repeating meeting puts the next one on the calendar", () => {
  it("creates exactly one future occurrence when it ends", async () => {
    const first = await startSeries({ repeat: "weekly", scheduledFor: lastWeek() });

    await endMeeting(first.id);

    const rows = await occurrences(first.id);
    expect(rows).toHaveLength(2);
    const [a, b] = rows;
    expect(a.status).toBe("ended");
    expect(b.status).toBe("scheduled");
    expect(b.occurrence).toBe(2);
    expect(b.seriesId).toBe(first.id);
    // Seven days on, and in the future — the whole point of rolling forward.
    expect(b.scheduledFor!.getTime()).toBeGreaterThan(Date.now());
  });

  it("does not create a second one, however many times it is asked", async () => {
    /*
     * The property that matters most. Three things call this — the end of a
     * call, a host cancelling a week, and the housekeeping cron — and two
     * occurrences of Wednesday prayer means two links and half the congregation
     * in each.
     */
    const first = await startSeries({ repeat: "weekly", scheduledFor: lastWeek() });
    await endMeeting(first.id);

    await Promise.all([
      rollSeriesForward(first.id, { held: true }),
      rollSeriesForward(first.id, { held: true }),
      continueDueSeries(),
    ]);

    expect(await occurrences(first.id)).toHaveLength(2);
  });

  it("only the caller that actually closed the room rolls it forward", async () => {
    /*
     * Two people pressing End at the same moment — a host in the room and an
     * admin on the detail page. `endMeeting`'s update is status-scoped, so only
     * one of them changes a row, and only that one creates next week. Without
     * this the duplicate check is two statements and both could pass it.
     */
    const first = await startSeries({ repeat: "weekly", scheduledFor: lastWeek() });

    await Promise.all([endMeeting(first.id), endMeeting(first.id), endMeeting(first.id)]);

    expect(await occurrences(first.id)).toHaveLength(2);
  });

  it("carries the settings, the passcode and the host key over", async () => {
    // What a saved link and a read-out passcode depend on. A new passcode every
    // week is the same as no recurring meeting at all.
    const first = await startSeries({
      repeat: "weekly",
      scheduledFor: lastWeek(),
      access: "passcode",
    });
    await db
      .update(meeting)
      .set({ lowDataDefault: true, lobby: true, maxParticipants: 9, durationMin: 45 })
      .where(eq(meeting.id, first.id));

    await endMeeting(first.id);
    const [, next] = await occurrences(first.id);

    expect(next.passcode).toBe("123456");
    expect(next.hostKey).toBe(`zzhost${stamp}`);
    expect(next.lowDataDefault).toBe(true);
    expect(next.lobby).toBe(true);
    expect(next.maxParticipants).toBe(9);
    expect(next.durationMin).toBe(45);
    expect(next.repeat).toBe("weekly");
    // And its own code, because a code is unique to a room.
    expect(next.code).not.toBe(first.code);
  });

  it("starts each occurrence with a clear screen and an empty register", async () => {
    /*
     * The reason a series is a chain of rows rather than one row rolled forward.
     * "Who came to Wednesday prayer" is a question about one Wednesday, and a
     * verse left on the screen from last week is not this week's.
     */
    const first = await startSeries({ repeat: "weekly", scheduledFor: lastWeek() });
    await db
      .update(meeting)
      .set({
        stage: { kind: "text", body: "Last week", rev: 3 },
        slides: ["some-media-id"],
        spotlightPeerId: "peer-from-last-week",
        peakParticipants: 14,
        totalJoins: 20,
      })
      .where(eq(meeting.id, first.id));

    await endMeeting(first.id);
    const [, next] = await occurrences(first.id);

    expect(next.stage).toEqual({});
    expect(next.slides).toEqual([]);
    expect(next.spotlightPeerId).toBeNull();
    expect(next.peakParticipants).toBe(0);
    expect(next.totalJoins).toBe(0);
  });

  it("leaves a meeting that does not repeat alone", async () => {
    const one = await startSeries({ repeat: "none", scheduledFor: lastWeek() });
    await endMeeting(one.id);
    expect(await occurrences(one.id)).toHaveLength(1);
    expect(await listSeriesOccurrences(await read(one.id))).toEqual([]);
  });
});

describe("the link in somebody's WhatsApp keeps working", () => {
  it("follows a finished occurrence's code forward to the current one", async () => {
    const first = await startSeries({ repeat: "weekly", scheduledFor: lastWeek() });
    await endMeeting(first.id);
    const [, next] = await occurrences(first.id);

    // The code printed in March, opened in November.
    const resolved = await resolveMeetingByCode(first.code);
    expect(resolved?.id).toBe(next.id);
    expect(resolved?.code).toBe(next.code);
  });

  it("resolves a one-off ended meeting to itself", async () => {
    // Nothing to follow. The page must still say "this meeting has ended"
    // rather than finding somebody else's room.
    const one = await startSeries({ repeat: "none", scheduledFor: lastWeek() });
    await endMeeting(one.id);
    const resolved = await resolveMeetingByCode(one.code);
    expect(resolved?.id).toBe(one.id);
  });

  it("resolves the current occurrence's own code to itself", async () => {
    const first = await startSeries({ repeat: "weekly", scheduledFor: lastWeek() });
    await endMeeting(first.id);
    const [, next] = await occurrences(first.id);
    expect((await resolveMeetingByCode(next.code))?.id).toBe(next.id);
  });
});

describe("a series stops when it should", () => {
  it("stops at its end date, and says so on the row", async () => {
    const first = await startSeries({
      repeat: "weekly",
      scheduledFor: lastWeek(),
      // The next occurrence would be next week, which is past this.
      repeatUntil: new Date(Date.now() + 2 * 24 * 3_600_000),
    });

    await endMeeting(first.id);

    expect(await occurrences(first.id)).toHaveLength(1);
    // And the card stops claiming it repeats, because it does not any more.
    expect((await read(first.id)).repeat).toBe("none");
  });

  it("gives up after enough occurrences nobody opened", async () => {
    /*
     * The safety valve. Without it a church that set up "every Wednesday" and
     * moved on would have a row generated for it every week for ever.
     */
    const first = await startSeries({
      repeat: "weekly",
      scheduledFor: lastWeek(),
      missedRuns: MAX_MISSED_RUNS - 1,
    });
    await db
      .update(meeting)
      .set({ status: "cancelled", startedAt: null })
      .where(eq(meeting.id, first.id));

    const created = await rollSeriesForward(first.id, { held: false });

    expect(created).toBeNull();
    expect((await read(first.id)).repeat).toBe("none");
  });

  it("forgets the missed ones as soon as one is actually held", async () => {
    // A church that misses a few weeks and comes back is not an abandoned
    // series, and must not be one bad month from losing its meeting.
    const first = await startSeries({
      repeat: "weekly",
      scheduledFor: lastWeek(),
      missedRuns: MAX_MISSED_RUNS - 1,
    });

    await endMeeting(first.id);
    const [, next] = await occurrences(first.id);

    expect(next).toBeDefined();
    expect(next.missedRuns).toBe(0);
    expect(next.repeat).toBe("weekly");
  });

  it("counts a missed one without ending the series", async () => {
    const first = await startSeries({
      repeat: "weekly",
      scheduledFor: lastWeek(),
      missedRuns: 1,
    });
    await db
      .update(meeting)
      .set({ status: "cancelled", startedAt: null })
      .where(eq(meeting.id, first.id));

    await rollSeriesForward(first.id, { held: false });
    const [, next] = await occurrences(first.id);

    expect(next.missedRuns).toBe(2);
    expect(next.repeat).toBe("weekly");
  });
});

describe("the series reads correctly on the detail page", () => {
  it("lists every occurrence of the series it belongs to", async () => {
    const first = await startSeries({ repeat: "weekly", scheduledFor: lastWeek() });
    await endMeeting(first.id);
    const [, next] = await occurrences(first.id);

    const fromTheFirst = await listSeriesOccurrences(await read(first.id));
    const fromTheSecond = await listSeriesOccurrences(await read(next.id));

    // Both ends of the chain see the same series, newest first.
    expect(fromTheFirst.map((o) => o.id)).toEqual([next.id, first.id]);
    expect(fromTheSecond.map((o) => o.id)).toEqual([next.id, first.id]);
  });

  it("never reaches across churches", async () => {
    // A series id is a plain uuid with no foreign key. Scoping the lookup to the
    // church is what stops one tenant's calendar leaking into another's page.
    const first = await startSeries({ repeat: "weekly", scheduledFor: lastWeek() });
    await endMeeting(first.id);
    const mine = await read(first.id);

    const found = await listSeriesOccurrences({ ...mine, churchId: "not-a-real-church" });
    expect(found).toEqual([]);
  });
});

describe("repeating is a paid upgrade", () => {
  it("stops the chain for a church whose plan no longer includes it", async () => {
    /*
     * The downgrade path, and the reason the plan is checked here as well as at
     * the form. A church on Pro in March that is on Growth in June must not keep
     * being handed a meeting a week — that is a feature they stopped paying for
     * quietly continuing to work.
     */
    const first = await startSeries({ repeat: "weekly", scheduledFor: lastWeek() });
    await setPlan("growth");

    try {
      // Through a real ending, which is how this actually happens: the host
      // finishes Wednesday's meeting and there is no next Wednesday.
      await endMeeting(first.id);

      expect(await occurrences(first.id)).toHaveLength(1);
      // The chain stops, and the occurrence that already exists is untouched
      // apart from ending — its link has been shared and it is on calendars.
      expect((await read(first.id)).repeat).toBe("none");
      expect((await read(first.id)).status).toBe("ended");
    } finally {
      // Back to the plan the rest of this file assumes, whatever the assertions
      // above did.
      await setPlan("pro");
    }
  });

  it("carries on for a church whose plan does include it", async () => {
    // The same shape, one plan different — so the test above is known to be
    // measuring the plan and not some other reason nothing was created.
    const first = await startSeries({ repeat: "weekly", scheduledFor: lastWeek() });
    await endMeeting(first.id);

    const rows = await occurrences(first.id);
    expect(rows).toHaveLength(2);
    expect(rows[1].repeat).toBe("weekly");
  });
});

describe("the sweep is a backstop, not a generator", () => {
  it("finds a series that finished without getting a next one", async () => {
    const first = await startSeries({ repeat: "weekly", scheduledFor: lastWeek() });
    // End it WITHOUT the roll-forward — a worker restarted mid-insert, or a
    // database briefly out of reach.
    await db
      .update(meeting)
      .set({ status: "ended", endedAt: new Date() })
      .where(eq(meeting.id, first.id));
    expect(await occurrences(first.id)).toHaveLength(1);

    await continueDueSeries();

    const rows = await occurrences(first.id);
    expect(rows).toHaveLength(2);
    expect(rows[1].status).toBe("scheduled");
  });

  it("leaves a series that already has its next one alone", async () => {
    const first = await startSeries({ repeat: "weekly", scheduledFor: lastWeek() });
    await endMeeting(first.id);
    const before = await occurrences(first.id);

    await continueDueSeries();
    await continueDueSeries();

    const after = await occurrences(first.id);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
  });
});

describe("the fixtures themselves", () => {
  it("left nothing behind that is not labelled as a probe", async () => {
    // Every row this file creates carries the probe title, so the teardown can
    // be trusted not to take a real church's meeting with it.
    const rows = await db
      .select({ title: meeting.title })
      .from(meeting)
      .where(and(inArray(meeting.id, made), isNotNull(meeting.title)));
    for (const r of rows) expect(r.title).toContain("ZZ series probe");
    expect(timezone).toBeTruthy();
  });
});
