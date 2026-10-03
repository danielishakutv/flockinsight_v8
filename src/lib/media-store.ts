import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Media kept on this server's own disk.
 *
 * Video and audio live here rather than at Cloudinary, because Cloudinary's
 * plan refuses any single asset over 100 MB and an hour of meeting video is
 * several times that. Disk is the one storage that does not have an opinion
 * about how long a service lasts.
 *
 * Images are deliberately NOT here. They are small, they already work, and
 * Cloudinary's image pipeline is better than anything worth writing — moving
 * them would be risk with no gain.
 *
 * WHERE THE FILES GO, AND WHY IT IS NOT NEGOTIABLE. `MEDIA_ROOT` must be
 * outside the release directory. Deploys replace `current/` wholesale, so a
 * file written inside it is a file that exists until the next deploy and then
 * does not. The default points at the `shared/` directory for that reason, and
 * this is the kind of mistake that is invisible for a week and then total.
 */

/** Where media lives. Absolute, and outside any directory a deploy replaces. */
export const MEDIA_ROOT =
  process.env.MEDIA_ROOT || "/home/flockinsight/app/shared/media";

/** Partially-uploaded files, assembled here and moved only when complete. */
export const MEDIA_TMP = path.join(MEDIA_ROOT, ".tmp");

/** Only these ever go to local disk; everything else stays on Cloudinary. */
export function isLocallyStored(mime: string): boolean {
  return mime.startsWith("video/") || mime.startsWith("audio/");
}

/**
 * A storage key for one file: "<churchId>/<uuid>.<ext>".
 *
 * The church id is a directory rather than a prefix so one church's media can
 * be measured, moved or removed with ordinary tools, and so a directory listing
 * never mixes two congregations' files.
 */
export function makeStorageKey(churchId: string, ext: string): string {
  const safeExt = (ext || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  return `${safeChurch(churchId)}/${randomUUID()}.${safeExt}`;
}

/**
 * Resolve a key to an absolute path, refusing anything that escapes the root.
 *
 * The key reaches this function from a database row, and a row is only as
 * trustworthy as everything that has ever written to it. `..` in a key would
 * otherwise read or delete arbitrary files as the app user, so the resolved
 * path is checked to be inside the root rather than assumed to be.
 */
export function resolveKey(key: string): string {
  const full = path.resolve(MEDIA_ROOT, key);
  const root = path.resolve(MEDIA_ROOT);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error("Refusing a media path outside the media root.");
  }
  return full;
}

function safeChurch(churchId: string): string {
  const clean = churchId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!clean) throw new Error("A media file needs a church to belong to.");
  return clean;
}

export async function ensureDirs(): Promise<void> {
  await mkdir(MEDIA_TMP, { recursive: true });
}

/** Is this an upload id we are willing to touch the filesystem with? */
export function validUploadId(id: string): boolean {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

/**
 * An upload in progress: a temp file the chunks are appended to.
 *
 * NAMESPACED BY CHURCH, and that is a security boundary rather than tidiness.
 *
 * Upload ids may be supplied by the caller, so that a recording waiting in a
 * device's vault since yesterday resumes the same file rather than starting a
 * second one. In one shared namespace that is a cross-tenant hole: church B
 * could name church A's in-progress upload and call `finish`, and walk away
 * with a media row in their own library pointing at church A's recording. Two
 * churches could also collide on an id by accident and corrupt each other's
 * file.
 *
 * With the church in the path, the same id from a different church simply
 * resolves to a different file. There is nothing to guess and nothing to share.
 *
 * The id is also stripped of anything but letters, digits and hyphens, so no
 * input here can climb out of MEDIA_TMP.
 */
export function tmpPathFor(churchId: string, uploadId: string): string {
  const clean = uploadId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  if (!clean) throw new Error("Bad upload id.");
  return path.join(MEDIA_TMP, `${safeChurch(churchId)}--${clean}.part`);
}

/** Move a finished temp file into place under its final key. */
export async function commitUpload(
  tmpFile: string,
  key: string,
): Promise<{ bytes: number }> {
  const dest = resolveKey(key);
  await mkdir(path.dirname(dest), { recursive: true });
  /*
   * `rename` and not copy: it is atomic within a filesystem, so a file is never
   * half-present at its final path. Both sides live under MEDIA_ROOT precisely
   * so this holds.
   */
  await rename(tmpFile, dest);
  const s = await stat(dest);
  return { bytes: s.size };
}

export async function fileSize(key: string): Promise<number | null> {
  try {
    const s = await stat(resolveKey(key));
    return s.size;
  } catch {
    return null;
  }
}

export async function exists(key: string): Promise<boolean> {
  return (await fileSize(key)) !== null;
}

/** Remove a stored file. Never throws — a missing file is already the goal. */
export async function removeFile(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await unlink(resolveKey(key));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    // ENOENT is success by another name. Anything else is worth knowing about,
    // because it means a church's quota is being charged for bytes nobody can
    // reach.
    if (err?.code !== "ENOENT") {
      console.error(`[media-store] could not remove ${key}:`, err?.message ?? e);
    }
  }
}

/** Abandon a partial upload. Scoped to the church that owns it. */
export async function discardUpload(
  churchId: string,
  uploadId: string,
): Promise<void> {
  try {
    await rm(tmpPathFor(churchId, uploadId), { force: true });
  } catch {
    /* nothing to discard */
  }
}

export type RangeSpec = { start: number; end: number; size: number };

/**
 * Parse a Range header against a known size.
 *
 * Video needs this. Without a 206 the browser cannot seek, Safari in particular
 * refuses to play at all, and a two-hour service becomes a file you can only
 * watch from the beginning. Only the single-range form is handled, which is the
 * only form players actually send.
 */
export function parseRange(header: string | null, size: number): RangeSpec | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;

  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;
  if (rawStart === "") {
    // "bytes=-500" — the last 500 bytes.
    const take = Number(rawEnd);
    if (!Number.isFinite(take) || take <= 0) return null;
    start = Math.max(0, size - take);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start >= size) return null;
  end = Math.min(end, size - 1);
  if (end < start) return null;

  return { start, end, size };
}

/** A web ReadableStream over part of a file, for a Response body. */
export function streamFile(
  key: string,
  range?: { start: number; end: number },
): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(resolveKey(key), range);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (c) =>
        controller.enqueue(
          typeof c === "string" ? new TextEncoder().encode(c) : new Uint8Array(c),
        ),
      );
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      // The reader went away — a person scrubbing a video or closing the tab.
      // Without this the file handle stays open for every abandoned request.
      nodeStream.destroy();
    },
  });
}

/**
 * Clear away partial uploads nobody is coming back for.
 *
 * The window is deliberately long. An upload here may legitimately span days: a
 * recording waits for spare bandwidth, the host does not open the app over the
 * week, the connection is poor every evening. A sweep that ran after a few
 * hours would delete exactly the slow uploads this whole design exists to
 * rescue, and the person would never know why their recording kept restarting.
 *
 * Judged on MODIFIED time, not created: an upload that received a chunk
 * yesterday is alive, however old it is.
 */
export async function sweepStaleUploads(
  olderThanDays = 14,
  now: Date = new Date(),
): Promise<{ removed: number; bytes: number }> {
  const cutoff = now.getTime() - olderThanDays * 86_400_000;
  let removed = 0;
  let bytes = 0;

  try {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(MEDIA_TMP);
    for (const name of names) {
      if (!name.endsWith(".part")) continue;
      const full = path.join(MEDIA_TMP, name);
      try {
        const st = await stat(full);
        if (st.mtimeMs >= cutoff) continue;
        bytes += st.size;
        await unlink(full);
        removed++;
      } catch {
        /* vanished or unreadable — nothing to reclaim */
      }
    }
  } catch {
    // No temp directory yet. Nothing to sweep.
    return { removed: 0, bytes: 0 };
  }

  if (removed > 0) {
    console.log(
      `[media-store] cleared ${removed} abandoned partial upload(s), ${(bytes / 1048576).toFixed(1)} MB`,
    );
  }
  return { removed, bytes };
}

/** Total bytes this church is holding on disk, for reconciling the quota. */
export async function churchDiskUsage(churchId: string): Promise<number> {
  const dir = path.join(path.resolve(MEDIA_ROOT), safeChurch(churchId));
  try {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(dir);
    let total = 0;
    for (const n of names) {
      try {
        total += (await stat(path.join(dir, n))).size;
      } catch {
        /* vanished mid-walk; it is not holding space */
      }
    }
    return total;
  } catch {
    return 0;
  }
}
