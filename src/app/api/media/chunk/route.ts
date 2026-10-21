import { mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { media } from "@/db/schema";
import { getSession } from "@/lib/session";
import { churchForApi, refusalResponse } from "@/lib/api-church";
import {
  canUploadKind,
  permForKind,
  refuseUploadKind,
  MEDIA_KINDS,
  type MediaKind,
} from "@/lib/media";
import {
  LIBRARY_FORBIDDEN,
  TOO_MANY_OPEN_UPLOADS,
  partialUploadVerdict,
  recordingUploadVerdict,
} from "@/lib/media-upload-rules";
import {
  MEDIA_TMP,
  chunkPlacement,
  commitUpload,
  discardUpload,
  ensureDirs,
  extForMime,
  heldBytes,
  localMimeEssence,
  looksLikeAudioOrVideo,
  makeStorageKey,
  partialUploadsFor,
  readHead,
  resolveKey,
  tmpPathFor,
  validUploadId,
  writeChunkAt,
} from "@/lib/media-store";
import { unsupportedMediaMessage } from "@/lib/media-local-types";
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
 * piece is an ordinary request well under the limit, and the server writes
 * them into one temp file. Only when the last piece lands does it become a
 * real media row.
 *
 * Why disk rather than memory: an hour of video is hundreds of megabytes and
 * this process also serves every church page on the box. Bytes go to disk as
 * they arrive and the resident memory never grows with the file.
 *
 * Each chunk is written AT ITS OFFSET, never appended — see `writeChunkAt`. A
 * chunk sent twice (a lost response on a weak connection, two open tabs) used
 * to be appended twice, every later byte landed 8 MB late, and the video broke
 * halfway through while reporting "ready".
 *
 * The temp file is named by an upload id the server issued, and lives under
 * MEDIA_TMP. A half-finished upload is therefore a stray file in one directory,
 * which the sweep clears — never a half-real row in the library.
 *
 * A MEETING RECORDING (the body or query names a `recordingId`) is routed by the
 * recording, not by the browser: it goes to the church that held the meeting,
 * and may be sent by whoever recorded or hosted it. See `recordingUploadVerdict`.
 * Every answer is JSON with a `code` a client can branch on — never a redirect
 * to a sign-in page that `fetch` would follow and hand back as a 200.
 */

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Chunks this size keep every request an order of magnitude under the cap. */
export const CHUNK_SIZE = 8 * 1024 * 1024;

type Target = {
  churchId: string;
  storageExtraBytes: number;
  userId: string;
  /** Set when this upload is a meeting recording. */
  recordingId: string | null;
  /** The recording is already in the library; nothing more to file. */
  alreadySaved: boolean;
};

function kindOf(raw: unknown): MediaKind {
  return MEDIA_KINDS.includes(raw as MediaKind) ? (raw as MediaKind) : "file";
}

/**
 * Whose upload this is and where it goes — or the JSON refusal that says why
 * not. `kind` is only known on start and finish; `checkKind` says whether the
 * permission to upload that kind should be asked here. The steps that do not
 * name a kind (status, append, abandon) still need the right to upload
 * SOMETHING: they used to need only a seat, so any staff login could write
 * temp files to the shared disk.
 */
async function resolveTarget(opts: {
  recordingId: string | null;
  kind: MediaKind;
  checkKind: boolean;
}): Promise<Target | Response> {
  if (opts.recordingId) {
    const session = await getSession();
    if (!session?.user)
      return json(
        {
          ok: false,
          code: "signin",
          error: "Sign in to the church account in this browser to send this recording.",
        },
        401,
      );
    const { recordingUploadFacts, standingInChurch, standingCan } = await import(
      "@/lib/meetings"
    );
    const rec = await recordingUploadFacts(opts.recordingId);
    const standing = rec ? await standingInChurch(rec.churchId, session.user.id) : null;
    const verdict = recordingUploadVerdict({
      rec,
      userId: session.user.id,
      standingAllows:
        !!standing &&
        (standingCan(standing, "meetings.manage") ||
          standingCan(standing, permForKind(opts.kind))),
    });
    if (!verdict.ok)
      return json({ ok: false, code: verdict.code, error: verdict.error }, verdict.status);
    return {
      churchId: verdict.churchId,
      storageExtraBytes: rec!.storageExtraBytes,
      userId: session.user.id,
      recordingId: opts.recordingId,
      alreadySaved: verdict.alreadySaved,
    };
  }

  const r = await churchForApi();
  if (!r.ok) return refusalResponse(r);
  if (r.church.status === "suspended")
    return json({ ok: false, code: "suspended", error: "This church's account is paused." }, 403);
  /*
   * The demo is one login with a published password, and its uploads would sit
   * on the disk every church shares. A superadmin acting as it may still test.
   * Meeting recordings never reach here: they are routed above, by recording.
   */
  if (r.church.isDemo && !r.impersonating)
    return json(
      {
        ok: false,
        code: "forbidden",
        error:
          "Uploading video and audio is switched off in the demo. Start your own church to build a media library.",
      },
      403,
    );
  const allowed = opts.checkKind
    ? await canUploadKind(opts.kind)
    : (await Promise.all(MEDIA_KINDS.map(canUploadKind))).some(Boolean);
  if (!allowed) return json({ ok: false, code: "forbidden", error: LIBRARY_FORBIDDEN }, 403);
  return {
    churchId: r.church.id,
    storageExtraBytes: r.church.storageExtraBytes,
    userId: r.user.id,
    recordingId: null,
    alreadySaved: false,
  };
}

/**
 * "Not enough storage", naming half-sent uploads when they are part of why.
 * The library's free space does not show them, so without this the sentence
 * would contradict the page it appears on.
 */
function notEnoughStorage(free: number, partialBytes: number, fileBytes: number | null): string {
  const left = formatBytes(Math.max(0, free - partialBytes));
  const head = fileBytes
    ? `Not enough storage — this file is ${formatBytes(fileBytes)} and you have ${left} free.`
    : `Not enough storage — you have ${left} free.`;
  return partialBytes > 0
    ? `${head} ${formatBytes(partialBytes)} more is held by uploads that have not finished; one that was abandoned is cleared within two weeks.`
    : head;
}

/** Raised inside the finish transaction when the recording row would not close. */
class RecordingNotCompleted extends Error {}

/**
 * The answer for a recording that is already in the library, at ANY step.
 *
 * A finish can commit and its answer be lost, so the device never releases its
 * copy. Its next attempt starts again — and `start` used to answer
 * `received: 0` (the temp file had already been moved into storage), so the
 * uploader re-sent the whole service, hundreds of megabytes on mobile data,
 * only for `finish` to say "already saved" and throw it away. Every step now
 * says so the moment it knows, and any bytes this upload id had are surplus.
 */
async function alreadySavedAnswer(churchId: string, uploadId: string | null) {
  if (uploadId && validUploadId(uploadId)) await discardUpload(churchId, uploadId);
  return json({ ok: true, alreadySaved: true });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "append";
  const queryRecordingId = url.searchParams.get("recordingId") || null;

  /* ---------------------------------------------------------- start ---- */
  if (action === "start") {
    let body: {
      kind?: string;
      mime?: string;
      bytes?: number;
      name?: string;
      /** Supplied when resuming an upload begun in an earlier session. */
      uploadId?: string;
      /** When this file is a meeting recording. */
      recordingId?: string | null;
    };
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Could not read that request." }, 400);
    }

    const kind = kindOf(body.kind);
    const recordingId = body.recordingId ? String(body.recordingId) : null;
    const target = await resolveTarget({ recordingId, kind, checkKind: true });
    if (target instanceof Response) return target;
    if (target.alreadySaved)
      return alreadySavedAnswer(target.churchId, String(body.uploadId ?? "").trim() || null);

    /*
     * The sermon library is what Pro sells. Asked here as well as at finish,
     * so a church below Pro is told before it uploads for ten minutes. Never
     * of a meeting recording — see `sermonNeedsLibraryPlan`.
     */
    const gate = await refuseUploadKind(kind, { recordingId });
    if (gate) return json(gate, 403);

    if (!localMimeEssence(body.mime))
      return json({ ok: false, code: "format", error: unsupportedMediaMessage(body.mime) }, 415);

    const bytes = Math.max(0, Math.round(Number(body.bytes ?? 0)) || 0);
    const info = await getStorageInfo(target.churchId, target.storageExtraBytes);

    await ensureDirs();
    /*
     * The caller may bring its own id, so a recording that has been waiting in
     * this device's vault since yesterday resumes the same temp file rather
     * than starting a second one beside it.
     */
    const asked = String(body.uploadId ?? "").trim();
    const uploadId = validUploadId(asked) ? asked : randomUUID();
    const received = await heldBytes(tmpPathFor(target.churchId, uploadId));

    /*
     * Told now rather than at the first chunk: the same verdict `append`
     * enforces, with the church's other half-sent uploads counted.
     */
    const others = await partialUploadsFor(target.churchId, uploadId);
    const room = partialUploadVerdict({
      used: info.used,
      limit: info.limit,
      otherPartialBytes: others.bytes,
      endsAt: bytes,
      isNew: received === 0,
      openUploads: others.open,
    });
    if (!room.ok && room.reason === "busy")
      return json({ ok: false, code: "busy", error: TOO_MANY_OPEN_UPLOADS }, 429);
    if (!room.ok && bytes > 0)
      return json(
        {
          ok: false,
          error: `${notEnoughStorage(info.free, others.bytes, bytes)} Free up space or upgrade your storage.`,
        },
        413,
      );

    if (target.recordingId) {
      const { touchRecording } = await import("@/lib/meetings");
      await touchRecording(target.recordingId, target.churchId);
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
    const target = await resolveTarget({
      recordingId: queryRecordingId,
      kind: "sermon",
      checkKind: false,
    });
    if (target instanceof Response) return target;
    const uploadId = url.searchParams.get("uploadId") ?? "";
    if (target.alreadySaved) return alreadySavedAnswer(target.churchId, uploadId);
    if (!validUploadId(uploadId))
      return json({ ok: false, error: "Invalid upload id." }, 400);
    // Nothing yet, or it was swept: either way the answer is zero.
    const received = await heldBytes(tmpPathFor(target.churchId, uploadId));
    return json({ ok: true, received });
  }

  /* --------------------------------------------------------- append ---- */
  if (action === "append") {
    const target = await resolveTarget({
      recordingId: queryRecordingId,
      kind: "sermon",
      checkKind: false,
    });
    if (target instanceof Response) return target;

    const uploadId = url.searchParams.get("uploadId") ?? "";
    // Not one more byte for a recording that is already filed.
    if (target.alreadySaved) return alreadySavedAnswer(target.churchId, uploadId);
    if (!validUploadId(uploadId))
      return json({ ok: false, error: "Invalid upload id." }, 400);

    /*
     * Where this chunk starts, said by the client and required. Without it the
     * server can only append — which is the bug this replaced. An older page
     * still open in a tab will not send it, and is told to reload rather than
     * being allowed to corrupt a file.
     */
    const offsetRaw = url.searchParams.get("offset");
    const offset = offsetRaw === null || offsetRaw === "" ? NaN : Number(offsetRaw);
    if (!Number.isSafeInteger(offset) || offset < 0)
      return json(
        {
          ok: false,
          code: "reload",
          error: "This page is out of date. Reload it and the upload will carry on.",
        },
        400,
      );

    let tmp: string;
    try {
      // Scoped to the target church: the same id from another church is a
      // different file, so one tenant can never write to — or finish —
      // another's upload.
      tmp = tmpPathFor(target.churchId, uploadId);
    } catch {
      return json({ ok: false, error: "Bad upload id." }, 400);
    }

    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.length === 0) return json({ ok: false, error: "Empty chunk." }, 400);
    if (buf.length > CHUNK_SIZE * 2)
      return json({ ok: false, error: "That chunk is too large." }, 413);

    await mkdir(MEDIA_TMP, { recursive: true });
    const held = await heldBytes(tmp);
    const place = chunkPlacement(held, offset, buf.length);
    if (!place.ok) {
      // Past the end would leave a hole. The client resumes from what we hold.
      return json({ ok: false, conflict: true, received: place.received }, 409);
    }

    /*
     * The running total is re-checked every chunk, not just at the start.
     *
     * The size declared up front is the browser's word for it. Without this, a
     * client could announce 1 MB and then send a hundred — and the first anyone
     * would know is a full disk, which takes down every site on the box, not
     * just this one. The church's other partial uploads count too, and a new
     * file waits while too many are open: an upload id is the caller's choice,
     * so `start` alone can never be the gate (partialUploadVerdict).
     */
    const info = await getStorageInfo(target.churchId, target.storageExtraBytes);
    const others = await partialUploadsFor(target.churchId, uploadId);
    const room = partialUploadVerdict({
      used: info.used,
      limit: info.limit,
      otherPartialBytes: others.bytes,
      endsAt: place.endsAt,
      isNew: held === 0,
      openUploads: others.open,
    });
    if (!room.ok && room.reason === "busy")
      return json({ ok: false, code: "busy", error: TOO_MANY_OPEN_UPLOADS }, 429);
    if (!room.ok) {
      await discardUpload(target.churchId, uploadId);
      return json(
        {
          ok: false,
          error: `${notEnoughStorage(info.free, others.bytes, null)} Nothing was saved.`,
        },
        413,
      );
    }

    await writeChunkAt(tmp, offset, buf);
    if (target.recordingId) {
      // A sign of life, so the stalled-recording sweep never calls a slow
      // upload lost while its chunks are still arriving.
      const { touchRecording } = await import("@/lib/meetings");
      await touchRecording(target.recordingId, target.churchId);
    }
    return json({ ok: true, received: Math.max(place.endsAt, await heldBytes(tmp)) });
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

    const kind = kindOf(body.kind);
    const recordingId = body.recordingId ? String(body.recordingId) : null;
    const target = await resolveTarget({ recordingId, kind, checkKind: true });
    if (target instanceof Response) return target;
    const churchId = target.churchId;

    const gate = await refuseUploadKind(kind, { recordingId });
    if (gate) return json(gate, 403);

    /*
     * Stored as the ESSENCE ("video/webm"), never as the string the browser
     * sent. The value becomes the Content-Type of a public URL on this origin;
     * see `localMimeEssence` for the comma trick it closes.
     */
    const mime = localMimeEssence(body.mime);
    if (!mime)
      return json({ ok: false, code: "format", error: unsupportedMediaMessage(body.mime) }, 415);

    let tmp: string;
    try {
      tmp = tmpPathFor(churchId, uploadId);
    } catch {
      return json({ ok: false, error: "Bad upload id." }, 400);
    }

    /*
     * Already in the library — a finish whose answer was lost, sent again, or
     * a second tab that uploaded its own copy. The file it holds is surplus;
     * the device may let its copy go, because one is safely filed.
     */
    if (target.alreadySaved) {
      await discardUpload(churchId, uploadId);
      return json({ ok: true, alreadySaved: true });
    }

    const size = await heldBytes(tmp);
    if (size === 0) {
      await discardUpload(churchId, uploadId);
      return json(
        { ok: false, error: "That upload wasn't found — please try again." },
        404,
      );
    }

    // The bytes have to be audio or video, whatever the label says.
    let head: Uint8Array;
    try {
      head = await readHead(tmp);
    } catch (e) {
      console.error(`[media/chunk] could not read ${uploadId} for church ${churchId}`, e);
      return json({ ok: false, error: "The upload could not be read back. Please try again." }, 500);
    }
    if (!looksLikeAudioOrVideo(head)) {
      await discardUpload(churchId, uploadId);
      console.error(
        `[media/chunk] refused ${uploadId} for church ${churchId}: labelled ${mime} but not an audio or video file`,
      );
      return json(
        { ok: false, error: "That file isn't a video or audio file we can store." },
        415,
      );
    }

    const name = String(body.name ?? "").slice(0, 300);
    // From the checked type, not from the name somebody typed.
    const ext = extForMime(mime);
    const key = makeStorageKey(churchId, ext);
    await commitUpload(tmp, key);

    let row: typeof media.$inferSelect;
    try {
      /*
       * The media row and the recording's completion are one transaction. A
       * recording that would not close (gone, already saved, another church)
       * must not leave a media row behind it, and must not be answered "ok" —
       * that answer is what lets the device release its copy.
       */
      row = await db.transaction(async (tx) => {
        const [r] = await tx
          .insert(media)
          .values({
            churchId,
            kind,
            mime,
            size,
            bytes: size,
            provider: "local",
            storageKey: key,
            format: ext,
            durationSec: Math.max(0, Math.round(Number(body.durationSec ?? 0)) || 0) || null,
            // Queued, not required. The file is already here and already
            // playable; the transcode only makes it playable on more devices.
            transcodeStatus: "pending",
            title: String(body.title ?? "").slice(0, 200) || name || null,
            originalName: name || null,
            uploadedBy: target.userId,
          })
          .returning();

        /*
         * If this was a meeting recording, close its row out here.
         *
         * One upload path, one completion. Recordings used to travel a second
         * route of their own straight to Cloudinary — which could not carry
         * anything over 100 MB, i.e. any real service. Two paths for one file is
         * how a recording ends up half-saved by one and ignored by the other.
         */
        if (target.recordingId) {
          const { completeRecording } = await import("@/lib/meetings");
          const n = await completeRecording(
            {
              id: target.recordingId,
              churchId,
              mediaId: r.id,
              url: `/media/${r.id}`,
              bytes: size,
              durationSec: r.durationSec ?? 0,
              status: "ready",
            },
            tx,
          );
          if (n === 0) throw new RecordingNotCompleted();
        }
        return r;
      });
    } catch (e) {
      // Put the bytes back where a retry will find them: nothing was filed.
      try {
        await rename(resolveKey(key), tmp);
      } catch (moveErr) {
        console.error(
          `[media/chunk] could not return ${key} to its upload ${uploadId} after a failed finish`,
          moveErr,
        );
      }
      if (e instanceof RecordingNotCompleted) {
        /*
         * Lost a race, not a recording. Two finishes for one recording (two
         * browsers, or the vault's fallback when navigator.locks is missing)
         * each hold their own upload id; the one that commits first closes the
         * row and the other's completeRecording changes nothing. Telling the
         * loser "could not be saved — download it" was false, and made its
         * device keep the copy and retry for ever. Look again: if the row is
         * now in the library, this copy is surplus.
         */
        const { recordingUploadFacts } = await import("@/lib/meetings");
        const now = await recordingUploadFacts(target.recordingId!);
        if (now && now.churchId === churchId && now.status === "ready" && now.mediaId) {
          return alreadySavedAnswer(churchId, uploadId);
        }
        console.error(
          `[media/chunk] recording ${target.recordingId} for church ${churchId} would not complete; nothing filed`,
        );
        return json(
          {
            ok: false,
            code: "recording-gone",
            error:
              "That recording could not be saved to the meeting it belongs to. It is still on this device — download it to keep it.",
          },
          409,
        );
      }
      throw e;
    }

    await audit({
      churchId,
      action: "media.file.create",
      summary: `Uploaded "${row.title ?? row.originalName ?? "a file"}" (${formatBytes(size)}) to the media library`,
      targetType: "media",
      targetId: row.id,
      targetLabel: row.title ?? row.originalName ?? null,
      meta: { bytes: size, kind, storage: "local", recordingId: target.recordingId },
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
    const target = await resolveTarget({
      recordingId: queryRecordingId,
      kind: "sermon",
      checkKind: false,
    });
    if (target instanceof Response) return target;
    const uploadId = url.searchParams.get("uploadId") ?? "";
    if (validUploadId(uploadId)) await discardUpload(target.churchId, uploadId);
    return json({ ok: true });
  }

  return json({ ok: false, error: "Unknown action." }, 400);
}
