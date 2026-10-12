/**
 * Database-backed checks for recordings that do not save. Run with `pnpm test:db`.
 *
 * These exist because of the worst class of bug this product has: eleven
 * recordings in production sitting at status "uploading", zero bytes, zero
 * duration, error NULL — forever. Every one was a host who stopped recording,
 * saw nothing wrong, and believed they had a recording of their service.
 *
 * The upload was never the problem. Credentials, signature, transformation,
 * chunking and quota were all verified working against the live account. The
 * problem was that a status which can only ever move forwards is not a status,
 * it is a hope: nothing on any failing path ever told the server, so the row
 * kept claiming to be uploading long after the browser had gone.
 *
 * So what is asserted here is not "uploads work" — it is the promise the user
 * actually asked for: a recording is either in the library, or it is visibly
 * marked as not. Never silently in between.
 *
 * And the other half, which the first version of the sweep broke: a recording
 * that is still being RECORDED, or still uploading, is never called lost. The
 * sweep used to judge on time since Record was pressed, so every service longer
 * than half an hour was marked failed while it was still going.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, meeting, meetingRecording } from "@/db/schema";
import {
  completeRecording,
  failStalledRecordings,
  markRecordingStopped,
  STALLED_GONE_QUIET,
  STALLED_NEVER_STOPPED,
} from "@/lib/meetings";

const stamp = Date.now();
let churchId = "";
const meetingIds: string[] = [];
const recordingIds: string[] = [];

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

/** A meeting: live, or ended some minutes ago. */
async function makeMeeting(opts: { endedMinutesAgo?: number } = {}) {
  const ended = opts.endedMinutesAgo !== undefined;
  const [m] = await db
    .insert(meeting)
    .values({
      churchId,
      code: `zzcheck${String(stamp).slice(-5)}${meetingIds.length}`,
      title: `zzcheck- recording probe ${stamp}`,
      status: ended ? "ended" : "live",
      endedAt: ended ? ago(opts.endedMinutesAgo!) : null,
    })
    .returning({ id: meeting.id });
  meetingIds.push(m.id);
  return m.id;
}

/** A recording row as it exists the moment somebody presses Record. */
async function makeRecording(opts: {
  meetingId: string;
  startedMinutesAgo: number;
  stoppedMinutesAgo?: number;
  lastActivityMinutesAgo?: number;
  status?: string;
  bytes?: number;
  error?: string | null;
}) {
  const [row] = await db
    .insert(meetingRecording)
    .values({
      meetingId: opts.meetingId,
      churchId,
      title: `zzcheck- probe ${stamp}`,
      mode: "video",
      status: opts.status ?? "uploading",
      bytes: opts.bytes ?? 0,
      durationSec: 0,
      error: opts.error ?? null,
      startedAt: ago(opts.startedMinutesAgo),
      createdAt: ago(opts.startedMinutesAgo),
      stoppedAt: opts.stoppedMinutesAgo !== undefined ? ago(opts.stoppedMinutesAgo) : null,
      lastActivityAt: ago(opts.lastActivityMinutesAgo ?? opts.startedMinutesAgo),
    })
    .returning({ id: meetingRecording.id });
  recordingIds.push(row.id);
  return row.id;
}

async function read(id: string) {
  const [row] = await db
    .select({
      status: meetingRecording.status,
      error: meetingRecording.error,
      bytes: meetingRecording.bytes,
      stoppedAt: meetingRecording.stoppedAt,
    })
    .from(meetingRecording)
    .where(eq(meetingRecording.id, id))
    .limit(1);
  return row;
}

beforeAll(async () => {
  const [c] = await db.select({ id: church.id }).from(church).limit(1);
  churchId = c.id;
});

afterAll(async () => {
  if (recordingIds.length)
    await db.delete(meetingRecording).where(inArray(meetingRecording.id, recordingIds));
  if (meetingIds.length) await db.delete(meeting).where(inArray(meeting.id, meetingIds));
});

describe("a recording still being made is never called lost", () => {
  it("leaves a 90-minute recording in a meeting that is still live", async () => {
    const live = await makeMeeting();
    const id = await makeRecording({ meetingId: live, startedMinutesAgo: 90 });
    await failStalledRecordings(30);
    expect((await read(id)).status).toBe("uploading");
  });

  it("leaves a stopped recording whose upload is still sending chunks", async () => {
    const ended = await makeMeeting({ endedMinutesAgo: 600 });
    const id = await makeRecording({
      meetingId: ended,
      startedMinutesAgo: 720,
      stoppedMinutesAgo: 600,
      lastActivityMinutesAgo: 5,
    });
    await failStalledRecordings(30);
    expect((await read(id)).status).toBe("uploading");
  });

  it("leaves a stopped upload that has been quiet for a day — uploads span days", async () => {
    const ended = await makeMeeting({ endedMinutesAgo: 2000 });
    const id = await makeRecording({
      meetingId: ended,
      startedMinutesAgo: 2100,
      stoppedMinutesAgo: 2000,
      lastActivityMinutesAgo: 1440,
    });
    await failStalledRecordings(30);
    expect((await read(id)).status).toBe("uploading");
  });
});

describe("a recording that is really lost is said to be", () => {
  it("marks one never stopped, in a meeting that ended, with nothing heard since", async () => {
    // The tab died mid-meeting: no Stop, and nothing ever uploaded.
    const ended = await makeMeeting({ endedMinutesAgo: 120 });
    const id = await makeRecording({ meetingId: ended, startedMinutesAgo: 200 });
    expect(await failStalledRecordings(30)).toBeGreaterThanOrEqual(1);
    const row = await read(id);
    expect(row.status).toBe("failed");
    expect(row.error).toBe(STALLED_NEVER_STOPPED);
  });

  it("marks one stopped but silent for a week, without claiming the file is gone", async () => {
    const ended = await makeMeeting({ endedMinutesAgo: 11_000 });
    const id = await makeRecording({
      meetingId: ended,
      startedMinutesAgo: 11_100,
      stoppedMinutesAgo: 11_000,
      lastActivityMinutesAgo: 10_900,
    });
    await failStalledRecordings(30);
    const row = await read(id);
    expect(row.status).toBe("failed");
    expect(row.error).toBe(STALLED_GONE_QUIET);
    expect(row.error).toMatch(/device/i);
  });
});

describe("what the sweep never touches", () => {
  it("one already in the library", async () => {
    const ended = await makeMeeting({ endedMinutesAgo: 600 });
    const id = await makeRecording({
      meetingId: ended,
      startedMinutesAgo: 700,
      status: "ready",
      bytes: 5_000_000,
    });
    await failStalledRecordings(30);
    const row = await read(id);
    expect(row.status).toBe("ready");
    expect(row.bytes).toBe(5_000_000);
  });

  it("one already known to have failed, keeping its own reason", async () => {
    const ended = await makeMeeting({ endedMinutesAgo: 600 });
    const id = await makeRecording({
      meetingId: ended,
      startedMinutesAgo: 700,
      status: "failed",
      error: "upload: the host's own words",
    });
    await failStalledRecordings(30);
    expect((await read(id)).error).toBe("upload: the host's own words");
  });

  it("sweeps nothing the second time", async () => {
    await failStalledRecordings(30);
    expect(await failStalledRecordings(30)).toBe(0);
  });
});

describe("Stop, and a finished upload, are written down", () => {
  it("records Stop on the meeting's unstopped recording, without needing its id", async () => {
    const live = await makeMeeting();
    const id = await makeRecording({ meetingId: live, startedMinutesAgo: 40 });
    expect(await markRecordingStopped({ meetingId: live, churchId })).toBe(1);
    expect((await read(id)).stoppedAt).not.toBeNull();
  });

  it("completes a row the sweep had given up on — the finished file is the truth", async () => {
    const ended = await makeMeeting({ endedMinutesAgo: 120 });
    const id = await makeRecording({ meetingId: ended, startedMinutesAgo: 200 });
    await failStalledRecordings(30);
    expect((await read(id)).status).toBe("failed");
    const n = await completeRecording({ id, churchId, bytes: 1234, status: "ready" });
    expect(n).toBe(1);
    expect((await read(id)).status).toBe("ready");
  });

  it("will not complete a recording for the wrong church, and says so with 0", async () => {
    const live = await makeMeeting();
    const id = await makeRecording({ meetingId: live, startedMinutesAgo: 5 });
    expect(await completeRecording({ id, churchId: "zzcheck-other-church", status: "ready" })).toBe(0);
    expect((await read(id)).status).toBe("uploading");
  });

  it("never overwrites a recording already in the library", async () => {
    const live = await makeMeeting();
    const id = await makeRecording({ meetingId: live, startedMinutesAgo: 5, status: "ready" });
    expect(await completeRecording({ id, churchId, status: "ready", bytes: 1 })).toBe(0);
  });
});
