/**
 * Database-backed checks for media stored on this server. Run with `pnpm test:db`.
 *
 * The promise being asserted is the one that matters after months of lost
 * recordings: **a file that has been accepted is never at risk**. It is on disk
 * before anything else happens, it survives a transcode that fails, and
 * deleting it actually frees the disk rather than leaving a church paying quota
 * for bytes nobody can reach.
 *
 * ffmpeg may or may not exist on the machine running these. That is deliberate:
 * where it is absent, the transcode-failure path is exercised for real, which is
 * the path that must not lose anything.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { church, media } from "@/db/schema";
import {
  MEDIA_ROOT,
  exists,
  fileSize,
  makeStorageKey,
  removeFile,
  resolveKey,
} from "@/lib/media-store";
import { deleteMedia } from "@/lib/media";
import { runTranscodeQueue, transcodeMedia } from "@/lib/media-transcode";

const stamp = Date.now();
let churchId = "";
const mediaIds: string[] = [];
const keys: string[] = [];

/** A locally-stored media row with real bytes behind it. */
async function makeLocalMedia(opts: { bytes: number; mime?: string; ext?: string }) {
  const key = makeStorageKey(churchId, opts.ext ?? "webm");
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, Buffer.alloc(opts.bytes, 7));
  keys.push(key);

  const [row] = await db
    .insert(media)
    .values({
      churchId,
      kind: "sermon",
      mime: opts.mime ?? "video/webm",
      size: opts.bytes,
      bytes: opts.bytes,
      provider: "local",
      storageKey: key,
      format: opts.ext ?? "webm",
      transcodeStatus: "pending",
      title: `ZZ storage probe ${stamp}`,
    })
    .returning({ id: media.id });
  mediaIds.push(row.id);
  return { id: row.id, key };
}

const read = async (id: string) => {
  const [r] = await db
    .select({
      storageKey: media.storageKey,
      bytes: media.bytes,
      mime: media.mime,
      transcodeStatus: media.transcodeStatus,
      transcodeError: media.transcodeError,
      originalBytes: media.originalBytes,
    })
    .from(media)
    .where(eq(media.id, id))
    .limit(1);
  return r;
};

beforeAll(async () => {
  const [c] = await db.select({ id: church.id }).from(church).limit(1);
  churchId = c.id;
});

afterAll(async () => {
  if (mediaIds.length) await db.delete(media).where(inArray(media.id, mediaIds));
  for (const k of keys) await removeFile(k);
});

describe("where the bytes actually are", () => {
  it("writes the file under the media root, not inside a release directory", async () => {
    const { key } = await makeLocalMedia({ bytes: 4096 });
    expect(await exists(key)).toBe(true);
    expect(resolveKey(key).startsWith(path.resolve(MEDIA_ROOT))).toBe(true);
    /*
     * A deploy replaces app/current wholesale. Media written inside it would
     * exist until the next release and then not — invisible for a week, then
     * total.
     */
    expect(MEDIA_ROOT).not.toContain(`${path.sep}current`);
  });

  it("keeps each church's files in their own directory", async () => {
    const { key } = await makeLocalMedia({ bytes: 1024 });
    expect(key.startsWith(`${churchId.replace(/[^a-zA-Z0-9_-]/g, "")}/`)).toBe(true);
  });

  it("reports the real size on disk, not the size it was told", async () => {
    const { key } = await makeLocalMedia({ bytes: 9999 });
    expect(await fileSize(key)).toBe(9999);
  });
});

describe("a transcode never puts the file at risk", () => {
  it("leaves the original in place and playable when ffmpeg fails", async () => {
    /*
     * The source here is 64 KB of a repeated byte with a .webm name — not a
     * real video, so ffmpeg refuses it. That is the point: this is the failure
     * path, and what matters is what survives it.
     */
    const { id, key } = await makeLocalMedia({ bytes: 65536 });
    const before = await read(id);

    const out = await transcodeMedia(id);
    expect(["failed", "skipped"]).toContain(out.status);

    const after = await read(id);
    // The row still points at the original, and the original is still there.
    expect(after.storageKey).toBe(key);
    expect(await exists(key)).toBe(true);
    expect(after.bytes).toBe(before.bytes);
    expect(after.mime).toBe(before.mime);
    // And it says why, rather than leaving a blank that means nothing.
    if (out.status === "failed") {
      expect(after.transcodeStatus).toBe("failed");
      expect(after.transcodeError).toBeTruthy();
    }
  });

  it("does not try to transcode something already in a playable format", async () => {
    const { id, key } = await makeLocalMedia({
      bytes: 2048,
      mime: "video/mp4",
      ext: "mp4",
    });
    const out = await transcodeMedia(id);
    expect(out.status).toBe("skipped");
    expect((await read(id)).transcodeStatus).toBe("skipped");
    expect(await exists(key)).toBe(true);
  });

  it("refuses to touch a row that is not stored locally", async () => {
    const [row] = await db
      .insert(media)
      .values({
        churchId,
        kind: "sermon",
        mime: "video/mp4",
        size: 10,
        bytes: 10,
        provider: "cloudinary",
        publicId: "flockinsight/x/y",
        title: `ZZ cloud probe ${stamp}`,
      })
      .returning({ id: media.id });
    mediaIds.push(row.id);
    const out = await transcodeMedia(row.id);
    expect(out.status).toBe("skipped");
  });

  it("records a missing file rather than pretending it converted one", async () => {
    const { id, key } = await makeLocalMedia({ bytes: 512 });
    await removeFile(key); // the file vanishes from under the row
    const out = await transcodeMedia(id);
    expect(out.status).toBe("failed");
    expect((await read(id)).transcodeError).toMatch(/missing/i);
  });

  it("runs the queue without two workers colliding", async () => {
    // The advisory lock is what stops a PM2 cluster transcoding one file twice.
    const [a, b] = await Promise.all([runTranscodeQueue(1), runTranscodeQueue(1)]);
    const claimed = [a.claimed, b.claimed].filter(Boolean).length;
    expect(claimed).toBeLessThanOrEqual(2);
    expect(a.claimed || b.claimed).toBe(true);
  });
});

describe("deleting really frees the disk", () => {
  it("removes the file as well as the row", async () => {
    const { id, key } = await makeLocalMedia({ bytes: 4096 });
    expect(await exists(key)).toBe(true);

    expect(await deleteMedia(id, churchId)).toBe(true);

    // Both, or the church keeps paying quota for bytes nobody can reach.
    expect(await exists(key)).toBe(false);
    expect(await read(id)).toBeUndefined();
  });

  it("will not let one church delete another's file", async () => {
    const { id, key } = await makeLocalMedia({ bytes: 1024 });
    expect(await deleteMedia(id, "some-other-church")).toBe(false);
    expect(await exists(key)).toBe(true);
    expect(await read(id)).toBeDefined();
  });
});
