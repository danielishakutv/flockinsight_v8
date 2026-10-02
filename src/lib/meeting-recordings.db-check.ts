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
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, meeting, meetingRecording } from "@/db/schema";
import { failStalledRecordings } from "@/lib/meetings";

const stamp = Date.now();
let churchId = "";
let meetingId = "";
const recordingIds: string[] = [];

/** A recording row as it exists the moment somebody presses Record. */
async function makeRecording(opts: {
  minutesAgo: number;
  status?: string;
  bytes?: number;
}) {
  const [row] = await db
    .insert(meetingRecording)
    .values({
      meetingId,
      churchId,
      title: `ZZ probe ${stamp}`,
      mode: "video",
      status: opts.status ?? "uploading",
      bytes: opts.bytes ?? 0,
      durationSec: 0,
      createdAt: new Date(Date.now() - opts.minutesAgo * 60_000),
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
    })
    .from(meetingRecording)
    .where(eq(meetingRecording.id, id))
    .limit(1);
  return row;
}

beforeAll(async () => {
  const [c] = await db.select({ id: church.id }).from(church).limit(1);
  churchId = c.id;

  const [m] = await db
    .insert(meeting)
    .values({
      churchId,
      code: `zzprobe${String(stamp).slice(-6)}`,
      title: `ZZ recording probe ${stamp}`,
    })
    .returning({ id: meeting.id });
  meetingId = m.id;
});

afterAll(async () => {
  if (meetingId) await db.delete(meeting).where(eq(meeting.id, meetingId));
  if (recordingIds.length)
    await db.delete(meetingRecording).where(inArray(meetingRecording.id, recordingIds));
});

describe("a recording never silently stays 'uploading'", () => {
  it("marks one the browser abandoned as failed, with a reason a person can read", async () => {
    // The laptop lid closed mid-upload. The browser can never report this, so
    // the server has to decide for itself.
    const id = await makeRecording({ minutesAgo: 90 });

    const n = await failStalledRecordings(30);
    expect(n).toBeGreaterThanOrEqual(1);

    const row = await read(id);
    expect(row.status).toBe("failed");
    expect(row.error).toBeTruthy();
    // Not a code or a status word — the sentence has to tell the host what
    // happened and where their copy might still be.
    expect(row.error).toMatch(/never finished/i);
    expect(row.error).toMatch(/device/i);
  });

  it("leaves a genuinely in-flight upload alone", async () => {
    /*
     * The other half of the promise, and the easier one to get wrong. An hour
     * of video on a weak connection is a genuinely long upload; marking a live
     * one as failed would be its own lie, and would train people to ignore the
     * status.
     */
    const id = await makeRecording({ minutesAgo: 2 });
    await failStalledRecordings(30);
    expect((await read(id)).status).toBe("uploading");
  });

  it("never touches one that already made it to the library", async () => {
    // A slow "complete" and the sweep can race. Downgrading a recording that is
    // safely saved would be a lie in the more alarming direction.
    const id = await makeRecording({ minutesAgo: 300, status: "ready", bytes: 5_000_000 });
    await failStalledRecordings(30);
    const row = await read(id);
    expect(row.status).toBe("ready");
    expect(row.bytes).toBe(5_000_000);
  });

  it("does not re-mark, or re-report, one already known to have failed", async () => {
    const id = await makeRecording({ minutesAgo: 300, status: "failed" });
    const before = await read(id);
    await failStalledRecordings(30);
    const after = await read(id);
    expect(after.status).toBe("failed");
    // The original reason survives; the sweep does not overwrite a specific
    // explanation with its generic one.
    expect(after.error).toBe(before.error);
  });

  it("sweeps nothing when there is nothing to sweep", async () => {
    await failStalledRecordings(30);
    const second = await failStalledRecordings(30);
    expect(second).toBe(0);
  });

  it("honours the window it is given", async () => {
    const id = await makeRecording({ minutesAgo: 10 });
    // Not stale at 30 minutes...
    await failStalledRecordings(30);
    expect((await read(id)).status).toBe("uploading");
    // ...but stale at 5.
    await failStalledRecordings(5);
    expect((await read(id)).status).toBe("failed");
  });
});
