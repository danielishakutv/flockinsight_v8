import { appendFile, mkdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { media } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { permForKind, MEDIA_KINDS, type MediaKind } from "@/lib/media";
import {
  MEDIA_TMP,
  commitUpload,
  discardUpload,
  ensureDirs,
  isLocallyStored,
  makeStorageKey,
  tmpPathFor,
  validUploadId,
} from "@/lib/media-store";
import { getStorageInfo } from "@/lib/storage";
import { formatBytes } from "@/lib/storage-bytes";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
// A single chunk is small; the whole point is that no request is ever long.
export const maxDuration = 120;

/**
 * POST /api/media/chunk — one slice of a large video or audio file.
 *
 * This is how a 266 MB recording reaches a server sitting behind Cloudflare,
 * which rejects any single request body over 100 MB before the origin hears
 * about it. Nothing here is clever: the file is cut into small pieces, each
 * piece is an ordinary request well under the limit, and the server appends
 * them to one temp file. Only when the last piece lands does it become a real
 * media row.
 *
 * Why appending rather than holding it in memory: an hour of video is hundreds
 * of megabytes and this process also serves every church page on the box. Bytes
 * go to disk as they arrive and the resident memory never grows with the file.
 *
 * The temp file is named by an upload id the server issued, and lives under
 * MEDIA_TMP. A half-finished upload is therefore a stray file in one directory,
 * which the sweep clears — never a half-real row in the library.
 */

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Chunks this size keep every request an order of magnitude under the cap. */
export const CHUNK_SIZE = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const { church, user } = await requireChurch();

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "append";

  /* ---------------------------------------------------------- start ---- */
  if (action === "start") {
    let body: {
      kind?: string;
      mime?: string;
      bytes?: number;
      name?: string;
      /** Supplied when resuming an upload begun in an earlier session. */
      uploadId?: string;
    };
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Could not read that request." }, 400);
    }

    const kind: MediaKind = MEDIA_KINDS.includes(body.kind as MediaKind)
      ? (body.kind as MediaKind)
      : "file";
    if (!(await can(permForKind(kind))))
      return json({ ok: false, error: "You can't upload this." }, 403);
    if (church.status === "suspended")
      return json({ ok: false, error: "This church's account is paused." }, 403);

    const mime = String(body.mime ?? "");
    if (!isLocallyStored(mime))
      return json(
        { ok: false, error: "Only video and audio are stored on the server." },
        400,
      );

    const bytes = Math.max(0, Math.round(Number(body.bytes ?? 0)) || 0);
    const info = await getStorageInfo(church.id, church.storageExtraBytes);
    if (bytes > 0 && info.used + bytes > info.limit)
      return json(
        {
          ok: false,
          error: `Not enough storage — this file is ${formatBytes(bytes)} and you have ${formatBytes(info.free)} free. Free up space or upgrade your storage.`,
        },
        413,
      );

    await ensureDirs();
    /*
     * The caller may bring its own id, so a recording that has been waiting in
     * this device's vault since yesterday resumes the same temp file rather
     * than starting a second one beside it.
     */
    const asked = String(body.uploadId ?? "").trim();
    const uploadId = validUploadId(asked) ? asked : randomUUID();

    let received = 0;
    try {
      received = (await stat(tmpPathFor(church.id, uploadId))).size;
    } catch {
      received = 0;
    }
    return json({ ok: true, uploadId, chunkSize: CHUNK_SIZE, received });
  }

  /* --------------------------------------------------------- status ---- */
  /*
   * How many bytes the server already holds for this upload.
   *
   * The server is the authority, not the browser. A recording may be resumed
   * days later, in a different session, after a crash — and whatever the client
   * remembers about its own progress is exactly the thing least likely to have
   * survived. Asking means a resume continues from the true offset instead of
   * duplicating or skipping bytes.
   */
  if (action === "status") {
    const uploadId = url.searchParams.get("uploadId") ?? "";
    if (!validUploadId(uploadId))
      return json({ ok: false, error: "Invalid upload id." }, 400);
    let received = 0;
    try {
      received = (await stat(tmpPathFor(church.id, uploadId))).size;
    } catch {
      // Nothing yet, or it was swept. Either way: start from zero.
      received = 0;
    }
    return json({ ok: true, received });
  }

  /* --------------------------------------------------------- append ---- */
  if (action === "append") {
    const uploadId = url.searchParams.get("uploadId") ?? "";
    if (!validUploadId(uploadId))
      return json({ ok: false, error: "Invalid upload id." }, 400);

    let tmp: string;
    try {
      // Scoped to this church: the same id from another church is a different
      // file, so one tenant can never append to — or finish — another's upload.
      tmp = tmpPathFor(church.id, uploadId);
    } catch {
      return json({ ok: false, error: "Bad upload id." }, 400);
    }

    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.length === 0) return json({ ok: false, error: "Empty chunk." }, 400);
    if (buf.length > CHUNK_SIZE * 2)
      return json({ ok: false, error: "That chunk is too large." }, 413);

    /*
     * The running total is re-checked every chunk, not just at the start.
     *
     * The size declared up front is the browser's word for it. Without this, a
     * client could announce 1 MB and then send a hundred — and the first anyone
     * would know is a full disk, which takes down every site on the box, not
     * just this one.
     */
    await mkdir(MEDIA_TMP, { recursive: true });
    let soFar = 0;
    try {
      soFar = (await stat(tmp)).size;
    } catch {
      soFar = 0;
    }

    const info = await getStorageInfo(church.id, church.storageExtraBytes);
    if (info.used + soFar + buf.length > info.limit) {
      await discardUpload(church.id, uploadId);
      return json(
        {
          ok: false,
          error: `Not enough storage — you have ${formatBytes(info.free)} free. Nothing was saved.`,
        },
        413,
      );
    }

    await appendFile(tmp, buf);
    return json({ ok: true, received: soFar + buf.length });
  }

  /* --------------------------------------------------------- finish ---- */
  if (action === "finish") {
    let body: {
      uploadId?: string;
      kind?: string;
      mime?: string;
      name?: string;
      title?: string;
      durationSec?: number;
      /** When this file is a meeting recording, the row to close out. */
      recordingId?: string | null;
    };
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Could not read that request." }, 400);
    }

    const uploadId = String(body.uploadId ?? "");
    if (!validUploadId(uploadId))
      return json({ ok: false, error: "Invalid upload id." }, 400);

    const kind: MediaKind = MEDIA_KINDS.includes(body.kind as MediaKind)
      ? (body.kind as MediaKind)
      : "file";
    if (!(await can(permForKind(kind))))
      return json({ ok: false, error: "You can't upload this." }, 403);

    const mime = String(body.mime ?? "");
    if (!isLocallyStored(mime))
      return json({ ok: false, error: "Only video and audio are stored here." }, 400);

    let tmp: string;
    let size: number;
    try {
      tmp = tmpPathFor(church.id, uploadId);
      size = (await stat(tmp)).size;
    } catch {
      return json(
        { ok: false, error: "That upload wasn't found — please try again." },
        404,
      );
    }
    if (size === 0) {
      await discardUpload(church.id, uploadId);
      return json({ ok: false, error: "Nothing was uploaded." }, 400);
    }

    const name = String(body.name ?? "").slice(0, 300);
    const ext = (name.split(".").pop() ?? "").toLowerCase() || (mime.startsWith("audio/") ? "webm" : "webm");
    const key = makeStorageKey(church.id, ext);
    await commitUpload(tmp, key);

    const [row] = await db
      .insert(media)
      .values({
        churchId: church.id,
        kind,
        mime,
        size,
        bytes: size,
        provider: "local",
        storageKey: key,
        format: ext,
        durationSec: Math.max(0, Math.round(Number(body.durationSec ?? 0)) || 0) || null,
        // Queued, not required. The file is already here and already playable;
        // the transcode only makes it playable on more devices.
        transcodeStatus: "pending",
        title: String(body.title ?? "").slice(0, 200) || name || null,
        originalName: name || null,
        uploadedBy: user.id,
      })
      .returning();

    /*
     * If this was a meeting recording, close its row out here.
     *
     * One upload path, one completion. Recordings used to travel a second route
     * of their own straight to Cloudinary — which could not carry anything over
     * 100 MB, i.e. any real service. Two paths for one file is how a recording
     * ends up half-saved by one and ignored by the other.
     */
    const recordingId = String(body.recordingId ?? "");
    if (recordingId) {
      const { completeRecording } = await import("@/lib/meetings");
      await completeRecording({
        id: recordingId,
        churchId: church.id,
        mediaId: row.id,
        url: `/media/${row.id}`,
        bytes: size,
        durationSec: row.durationSec ?? 0,
        status: "ready",
      });
    }

    await audit({
      churchId: church.id,
      action: "media.file.create",
      summary: `Uploaded "${row.title ?? row.originalName ?? "a file"}" (${formatBytes(size)}) to the media library`,
      targetType: "media",
      targetId: row.id,
      targetLabel: row.title ?? row.originalName ?? null,
      meta: { bytes: size, kind, storage: "local", recordingId: recordingId || null },
    });

    /*
     * Kicked off, never awaited. The person is told their file is saved the
     * moment it IS saved; converting it for older phones happens behind them.
     * `void` with a catch, because an unhandled rejection here would take the
     * worker down for a job that is allowed to fail.
     */
    void import("@/lib/media-transcode")
      .then((m) => m.runTranscodeQueue(1))
      .catch((e) => console.error("[media/chunk] transcode kick failed", e));

    return json({
      ok: true,
      id: row.id,
      link: `/media/${row.id}`,
      url: `/media/${row.id}`,
      bytes: row.bytes,
      kind: row.kind,
      mime: row.mime,
      title: row.title,
      width: row.width,
      height: row.height,
      durationSec: row.durationSec,
      createdAt: row.createdAt,
    });
  }

  /* --------------------------------------------------------- abandon --- */
  if (action === "abandon") {
    const uploadId = url.searchParams.get("uploadId") ?? "";
    if (validUploadId(uploadId)) await discardUpload(church.id, uploadId);
    return json({ ok: true });
  }

  return json({ ok: false, error: "Unknown action." }, 400);
}
