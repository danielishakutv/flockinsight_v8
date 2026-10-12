import "server-only";
import { constants as fsConstants } from "node:fs";
import { mkdir, open, rename, rm, stat, unlink, type FileHandle } from "node:fs/promises";
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

/*
 * The allow-list itself lives in a client-safe module, because the uploader in
 * the browser routes by the same rule. Re-exported so server code keeps one
 * import.
 */
import { localMimeEssence } from "@/lib/media-local-types";
export { localMimeEssence, extForMime } from "@/lib/media-local-types";

/**
 * Do these first bytes look like an audio or video container at all?
 *
 * The allow-list (`localMimeEssence`) decides what TYPE a file is served as; this decides
 * whether the bytes are plausibly that kind of thing. Both are needed: the type
 * comes from the browser that uploaded it, and a church that labelled an HTML
 * page "video/mp4" would otherwise still have it stored, kept for ever and
 * served — as video, harmlessly, but as a file nobody can play and an
 * invitation to try the next trick. Checked on the assembled file at `finish`,
 * before anything becomes a media row.
 *
 * Deliberately generous within audio/video: every container a phone, a camera,
 * a recorder or an old desktop tool is likely to produce. What it refuses is
 * text, markup and anything else that is not media.
 */
export function looksLikeAudioOrVideo(head: Uint8Array): boolean {
  if (head.length < 4) return false;
  const at = (i: number) => head[i] ?? -1;
  const ascii = (from: number, text: string) =>
    [...text].every((c, i) => at(from + i) === c.charCodeAt(0));

  // Matroska / WebM — what MediaRecorder writes in Chrome, Edge and Firefox.
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return true;
  // ISO base media (mp4, m4a, mov, 3gp): a box size, then the box type. Safari's
  // recorder and every phone camera. Old QuickTime files may open on another box.
  if (["ftyp", "moov", "mdat", "free", "skip", "wide", "pnot"].some((b) => ascii(4, b)))
    return true;
  if (ascii(0, "OggS")) return true; // Ogg (Vorbis, Opus, Theora)
  if (ascii(0, "fLaC")) return true; // FLAC
  if (ascii(0, "RIFF") && (ascii(8, "WAVE") || ascii(8, "AVI "))) return true;
  if (ascii(0, "ID3")) return true; // MP3 with a tag
  if (ascii(0, "FLV")) return true;
  if (ascii(0, "#!AMR")) return true;
  // AIFF / AIFC (Logic, GarageBand, older Macs) and Apple's Core Audio Format.
  if (ascii(0, "FORM") && (ascii(8, "AIFF") || ascii(8, "AIFC"))) return true;
  if (ascii(0, "caff")) return true;
  // ASF (wmv / wma): a fixed header GUID.
  if (at(0) === 0x30 && at(1) === 0x26 && at(2) === 0xb2 && at(3) === 0x75) return true;
  // MPEG program stream, and a transport stream's sync byte repeated a packet on.
  if (at(0) === 0x00 && at(1) === 0x00 && at(2) === 0x01 && (at(3) === 0xba || at(3) === 0xb3))
    return true;
  if (head.length >= 189 && at(0) === 0x47 && at(188) === 0x47) return true;
  // Blu-ray / AVCHD camera transport stream (.m2ts): 192-byte packets, each
  // with a 4-byte timestamp in front of the sync byte.
  if (head.length >= 197 && at(4) === 0x47 && at(196) === 0x47) return true;
  // A bare MPEG audio frame (mp3) or ADTS (aac): eleven sync bits. FF FE is
  // excluded by name because it is also the UTF-16 byte-order mark — the one
  // way a text file can begin with these bits.
  if (at(0) === 0xff && (at(1) & 0xe0) === 0xe0 && at(1) !== 0xfe && at(1) !== 0xff)
    return true;
  return false;
}

/** The first bytes of a file on disk, for `looksLikeAudioOrVideo`. */
export async function readHead(file: string, length = 512): Promise<Uint8Array> {
  const fh = await open(file, "r");
  try {
    const buf = new Uint8Array(length);
    const { bytesRead } = await fh.read(buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Only these ever go to local disk; everything else stays on Cloudinary. */
export function isLocallyStored(mime: string): boolean {
  return localMimeEssence(mime) !== null;
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

/**
 * Where a chunk may land, given what the server already holds.
 *
 * A chunk is placed at the offset the CLIENT says it starts at, never simply
 * appended. Appending is what corrupted files: a chunk whose response was lost
 * on a weak connection was sent again and written twice, and every byte after
 * it sat 8 MB late — a video that broke halfway through and still reported
 * "ready". Two open tabs uploading the same recording did the same thing.
 *
 * Written at its own offset, a repeat lands on top of itself. The only offset
 * refused is one PAST the end, because that would leave a hole of zeroes in
 * the middle of somebody's service.
 */
export function chunkPlacement(
  heldBytes: number,
  offset: number,
  length: number,
): { ok: true; endsAt: number } | { ok: false; received: number } {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > heldBytes) {
    return { ok: false, received: heldBytes };
  }
  return { ok: true, endsAt: Math.max(heldBytes, offset + length) };
}

/** How many bytes a partial upload holds, 0 if it does not exist yet. */
export async function heldBytes(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return 0;
    throw e;
  }
}

/**
 * Write one chunk at its offset — a positional write, never an append.
 *
 * Opened without O_APPEND and without O_TRUNC: on Linux, O_APPEND ignores the
 * position entirely (so `appendFile` and the "a" flag cannot do this), and
 * O_TRUNC would empty the file on every chunk. Because the same bytes at the
 * same offset produce the same file, this needs no lock across the two PM2
 * workers — a duplicate request is harmless whichever worker serves it.
 */
export async function writeChunkAt(
  file: string,
  offset: number,
  buf: Uint8Array,
): Promise<void> {
  const fh = await open(file, fsConstants.O_WRONLY | fsConstants.O_CREAT, 0o640);
  try {
    let written = 0;
    while (written < buf.length) {
      const { bytesWritten } = await fh.write(
        buf,
        written,
        buf.length - written,
        offset + written,
      );
      if (bytesWritten <= 0) throw new Error("The disk accepted no bytes.");
      written += bytesWritten;
    }
  } finally {
    await fh.close();
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

/** How much one pull reads from disk. */
const STREAM_CHUNK = 64 * 1024;

/**
 * A web ReadableStream over part of a file, for a Response body.
 *
 * PULL-based, and that is the whole point. The previous version attached a
 * "data" listener to a flowing fs stream and enqueued every chunk the moment
 * the disk produced it, so one phone opening a 1.5 GB service recording on a
 * slow connection made Node read the entire file into memory and hold it there
 * while the phone downloaded at 1-2 Mbps. A handful of viewers was enough to
 * push a worker past PM2's memory limit and restart it — cutting off every
 * church served by that worker, not just the one watching the video.
 *
 * Here nothing is read until the consumer asks for more, so what is held per
 * viewer is a few chunks whatever the size of the file.
 */
export function streamFile(
  key: string,
  range?: { start: number; end: number },
): ReadableStream<Uint8Array> {
  const file = resolveKey(key);
  let fh: FileHandle | null = null;
  let pos = range?.start ?? 0;
  /** Inclusive; undefined reads to the end of the file. */
  const end = range?.end;

  const close = async (why: string) => {
    const h = fh;
    fh = null;
    if (!h) return;
    try {
      await h.close();
    } catch (e) {
      // A handle that will not close is a leak somebody needs to hear about.
      console.error(`[media-store] could not close ${key} (${why}):`, e);
    }
  };

  return new ReadableStream<Uint8Array>(
    {
      async start() {
        fh = await open(file, "r");
      },
      async pull(controller) {
        try {
          const want =
            end === undefined ? STREAM_CHUNK : Math.min(STREAM_CHUNK, end - pos + 1);
          if (want <= 0 || !fh) {
            await close("done");
            controller.close();
            return;
          }
          const buf = new Uint8Array(want);
          const { bytesRead } = await fh.read(buf, 0, want, pos);
          if (bytesRead === 0) {
            await close("eof");
            controller.close();
            return;
          }
          pos += bytesRead;
          controller.enqueue(bytesRead === want ? buf : buf.subarray(0, bytesRead));
        } catch (err) {
          await close("error");
          controller.error(err);
        }
      },
      async cancel() {
        // The reader went away — a person scrubbing a video or closing the tab.
        // Without this the file handle stays open for every abandoned request.
        await close("cancel");
      },
    },
    // A few chunks of read-ahead keeps playback smooth without buffering the file.
    { highWaterMark: 4 },
  );
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
      /*
       * Two kinds of leftover live here. Partial uploads (".part") get the long
       * window above. A transcode's output ("<id>-<run>-transcode.mp4") is only
       * ever written by a running ffmpeg, whose longest allowed run is four
       * hours — so one untouched for a day belongs to a worker that was killed
       * mid-job (a deploy, a restart), and nothing will ever come back for it.
       * Left alone they pile up, each the size of a service.
       */
      const isPart = name.endsWith(".part");
      const isTranscode = /-transcode\.(mp4|m4a)$/.test(name);
      if (!isPart && !isTranscode) continue;
      const fileCutoff = isPart ? cutoff : now.getTime() - 86_400_000;
      const full = path.join(MEDIA_TMP, name);
      try {
        const st = await stat(full);
        if (st.mtimeMs >= fileCutoff) continue;
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
