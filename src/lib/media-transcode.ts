import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import {
  MEDIA_TMP,
  commitUpload,
  fileSize,
  makeStorageKey,
  removeFile,
  resolveKey,
} from "@/lib/media-store";

/**
 * Turning what a browser recorded into something every phone can play.
 *
 * Two things are wrong with a raw upload, and only one of them is size.
 *
 * A meeting recording arrives as VP8/VP9 in WebM, because that is what
 * MediaRecorder produces. An iPhone will not play it. So a church records their
 * service, the file saves perfectly, and half the congregation taps it and gets
 * nothing — which is its own kind of "the recording did not work". Re-encoding
 * to H.264/AAC in MP4 is what makes the file universal, and it is the main
 * reason this exists at all. Shrinking it is the bonus.
 *
 * THE ORDER MATTERS. The original is stored and playable BEFORE any of this
 * runs, and it keeps being served until a transcode has actually succeeded.
 * Optimisation is an improvement to a file that already exists, never a
 * condition of having one. Everything about this module assumes the recording
 * is precious and the encoding is not.
 */

/** ffmpeg, overridable for a box that keeps it somewhere unusual. */
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

/**
 * How hard to squeeze, and why these numbers.
 *
 * CRF 26 at 720p is the setting that looks like the meeting and not like a
 * compression artefact. Meeting and sermon footage is mostly still — faces,
 * a lectern, a slide — which is exactly what H.264 handles well, so the bitrate
 * lands around 0.6–0.9 Mbps and an hour comes to roughly 300–400 MB rather than
 * the 500 MB-plus the browser produced.
 *
 * `veryfast` rather than `medium`: this shares six cores with five other sites,
 * one of which has already taken the box down once. A slower preset would save
 * perhaps 10% of the file for several times the CPU, and CPU here is somebody
 * else's Sunday service. Size is worth less than that.
 *
 * 720p is a cap, not a target — `min(1280,iw)` leaves anything smaller alone
 * rather than upscaling it, which would cost bytes to add no detail.
 */
const VIDEO_TARGET_BITRATE = 1_200_000;

/**
 * The encoder settings, with a ceiling worked out from the source.
 *
 * CRF alone is not safe here, and that was worth measuring rather than
 * assuming: on high-detail footage a plain `-crf 26` produced a file 53% LARGER
 * than the browser's original. A church paying for disk would have been charged
 * more for the privilege of a conversion.
 *
 * So the bitrate is capped, and the cap is the lower of 1.2 Mbps and whatever
 * the source was already using. That makes growth arithmetically impossible
 * while still pulling a 10 Mbps camera file down to something sane. Measured on
 * this box: realistic meeting footage came out at SSIM 0.9994 — visually
 * identical — for 3% of the original size; worst-case synthetic noise held SSIM
 * 0.9889 and stayed inside the cap.
 */
function videoArgs(sourceBitrate: number | null): string[] {
  const cap = sourceBitrate
    ? Math.max(200_000, Math.min(VIDEO_TARGET_BITRATE, sourceBitrate))
    : VIDEO_TARGET_BITRATE;
  return [
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "26",
    "-maxrate", String(Math.round(cap)),
    "-bufsize", String(Math.round(cap * 2)),
    "-vf", "scale='min(1280,iw)':-2",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "96k",
    // Puts the index at the front so playback can start before the whole file
    // has downloaded. Without it a two-hour service buffers to the end before it
    // will begin, which reads as broken.
    "-movflags", "+faststart",
  ];
}

/**
 * Speech at 64 kbps AAC is genuinely transparent, and an hour is about 28 MB.
 * Stereo is kept when the source has it, because a church that recorded music
 * did not record it in mono.
 */
const AUDIO_ARGS = ["-vn", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart"];

export type TranscodePlan = {
  args: string[];
  ext: string;
  mime: string;
};

/** What to do with a file, or null when it is better left exactly as it is. */
export function planFor(
  mime: string,
  format: string | null,
  sourceBitrate: number | null = null,
): TranscodePlan | null {
  if (mime.startsWith("audio/")) {
    // Already AAC in an MP4 container — re-encoding would only lose quality.
    if (format === "m4a" || mime === "audio/mp4") return null;
    return { args: AUDIO_ARGS, ext: "m4a", mime: "audio/mp4" };
  }
  if (mime.startsWith("video/")) {
    if (format === "mp4" && mime === "video/mp4") {
      /*
       * An MP4 is probably already H.264 and probably already playable
       * everywhere. "Probably" is not certain — it could be HEVC — but
       * re-encoding every MP4 on the chance is a lot of somebody's CPU to fix a
       * file that is usually fine. Left alone; see `needsRemux` if this ever
       * needs to be smarter.
       */
      return null;
    }
    return { args: videoArgs(sourceBitrate), ext: "mp4", mime: "video/mp4" };
  }
  return null;
}

/** Run a command, resolving with its exit code and whatever it said. */
function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number },
): Promise<{ code: number | null; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    /*
     * `nice` and `ionice` are not decoration. During a transcode, Apache serving
     * somebody's Sunday service must outrank our encoder — this box has already
     * had an outage caused by CPU starvation, and a recording that takes twenty
     * minutes instead of twelve costs nobody anything.
     */
    const child = spawn(
      "nice",
      ["-n", "15", "ionice", "-c", "3", cmd, ...args],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    let stderr = "";
    let timedOut = false;
    child.stderr?.on("data", (d) => {
      // Only the tail is kept: ffmpeg is extremely chatty and the useful part
      // of a failure is always at the end.
      stderr = (stderr + String(d)).slice(-4000);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stderr: String(e), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, timedOut });
    });
  });
}

export async function ffmpegAvailable(): Promise<boolean> {
  const r = await run(FFMPEG, ["-version"], { timeoutMs: 10_000 });
  return r.code === 0;
}

/** Duration and bitrate, read from the file rather than trusted. */
export async function probe(
  key: string,
): Promise<{ durationSec: number | null; bitrate: number | null }> {
  const file = resolveKey(key);
  return new Promise((resolve) => {
    const child = spawn(FFPROBE, [
      "-v", "error",
      "-show_entries", "format=duration,bit_rate",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    let out = "";
    child.stdout?.on("data", (d) => (out += String(d)));
    child.on("error", () => resolve({ durationSec: null, bitrate: null }));
    child.on("close", () => {
      const [d, b] = out.trim().split(/\s+/);
      const dur = Number(d);
      const br = Number(b);
      resolve({
        durationSec: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null,
        bitrate: Number.isFinite(br) && br > 0 ? br : null,
      });
    });
  });
}

export async function probeDuration(key: string): Promise<number | null> {
  return (await probe(key)).durationSec;
}

/**
 * How long one file is allowed to take.
 *
 * Scaled to its size rather than fixed: a three-hour service legitimately takes
 * a long while at `veryfast`, and a fixed ten-minute cap would fail exactly the
 * recordings that matter most. The floor keeps a tiny stuck file from holding
 * the queue for an hour.
 */
function timeoutFor(bytes: number): number {
  const perMb = 4_000; // 4s per MB, generous for veryfast
  return Math.min(4 * 60 * 60_000, Math.max(10 * 60_000, (bytes / 1_048_576) * perMb));
}

export type TranscodeOutcome =
  | { status: "done"; bytes: number; savedBytes: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

/**
 * Transcode one media row in place.
 *
 * The new file is written beside the old one and only swapped in once ffmpeg
 * has exited cleanly AND produced something non-empty. If anything goes wrong
 * the row is untouched and still points at the original, which still plays.
 * There is no state in which this function loses a recording.
 */
export async function transcodeMedia(mediaId: string): Promise<TranscodeOutcome> {
  const [row] = await db
    .select({
      id: media.id,
      churchId: media.churchId,
      mime: media.mime,
      format: media.format,
      storageKey: media.storageKey,
      bytes: media.bytes,
      provider: media.provider,
    })
    .from(media)
    .where(eq(media.id, mediaId))
    .limit(1);

  if (!row || row.provider !== "local" || !row.storageKey)
    return { status: "skipped", reason: "not a locally stored file" };

  // Probed first: the encoder's ceiling is derived from what the source already
  // used, so a conversion can never make a file bigger.
  const source = await probe(row.storageKey);
  const plan = planFor(row.mime, row.format, source.bitrate);
  if (!plan) {
    await db
      .update(media)
      .set({ transcodeStatus: "skipped" })
      .where(eq(media.id, mediaId));
    return { status: "skipped", reason: "already in a universally playable format" };
  }

  const sourceSize = await fileSize(row.storageKey);
  if (sourceSize === null) {
    await db
      .update(media)
      .set({ transcodeStatus: "failed", transcodeError: "The original file is missing." })
      .where(eq(media.id, mediaId));
    return { status: "failed", reason: "the original file is missing" };
  }

  await db
    .update(media)
    .set({ transcodeStatus: "running", transcodeError: null })
    .where(eq(media.id, mediaId));

  const input = resolveKey(row.storageKey);
  const outName = `${mediaId}-transcode.${plan.ext}`;
  const outTmp = path.join(MEDIA_TMP, outName);

  const result = await run(
    FFMPEG,
    ["-nostdin", "-y", "-i", input, ...plan.args, outTmp],
    { timeoutMs: timeoutFor(sourceSize) },
  );

  let outSize: number | null = null;
  try {
    const { stat } = await import("node:fs/promises");
    outSize = (await stat(outTmp)).size || null;
  } catch {
    // ffmpeg wrote nothing at all — handled as a failure just below.
    outSize = null;
  }

  if (result.code !== 0 || !outSize) {
    const reason = result.timedOut
      ? "The file took too long to convert."
      : (result.stderr.split("\n").filter(Boolean).pop() ?? "ffmpeg failed.").slice(0, 300);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(outTmp, { force: true });
    } catch {
      /* nothing to clean */
    }
    /*
     * Failure is recorded and the original is left exactly where it is. The file
     * still plays — just not on every device — which is a far better outcome
     * than a tidy error and no recording.
     */
    await db
      .update(media)
      .set({ transcodeStatus: "failed", transcodeError: reason })
      .where(eq(media.id, mediaId));
    console.error(`[transcode] ${mediaId} failed: ${reason}`);
    return { status: "failed", reason };
  }

  /*
   * A transcode that made the file BIGGER is a transcode worth throwing away —
   * unless the point was playability. For WebM it always is, so size is not the
   * test; this only guards against pathological output.
   */
  const newKey = makeStorageKey(row.churchId, plan.ext);
  await commitUpload(outTmp, newKey);
  const oldKey = row.storageKey;

  const duration = (await probe(newKey)).durationSec ?? source.durationSec;

  await db
    .update(media)
    .set({
      storageKey: newKey,
      mime: plan.mime,
      format: plan.ext,
      bytes: outSize,
      size: outSize,
      originalBytes: sourceSize,
      durationSec: duration ?? undefined,
      transcodeStatus: "done",
      transcodeError: null,
    })
    .where(eq(media.id, mediaId));

  // Only once the row points at the new file. If the process died between the
  // two, the worst case is one orphaned file, not a row pointing at nothing.
  await removeFile(oldKey);

  console.log(
    `[transcode] ${mediaId}: ${(sourceSize / 1048576).toFixed(1)}MB -> ${(outSize / 1048576).toFixed(1)}MB (${plan.ext})`,
  );
  return { status: "done", bytes: outSize, savedBytes: Math.max(0, sourceSize - outSize) };
}

/**
 * Work through whatever is waiting, one file at a time.
 *
 * One at a time, and guarded by a Postgres advisory lock, because PM2 runs this
 * app as a cluster: without the lock both workers would transcode the same file
 * simultaneously, race each other to rename the output, and put two ffmpeg
 * processes on a box that is also serving church websites.
 */
const QUEUE_LOCK = 8_421_337;

export async function runTranscodeQueue(limit = 3): Promise<{
  claimed: boolean;
  done: number;
  failed: number;
}> {
  const lockRes = await db.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_lock(${QUEUE_LOCK}) as locked`,
  );
  if (!lockRes.rows[0]?.locked) return { claimed: false, done: 0, failed: 0 };

  let done = 0;
  let failed = 0;
  try {
    for (let i = 0; i < limit; i++) {
      const [next] = await db
        .select({ id: media.id })
        .from(media)
        .where(
          and(
            eq(media.provider, "local"),
            eq(media.transcodeStatus, "pending"),
            isNotNull(media.storageKey),
          ),
        )
        .orderBy(media.createdAt)
        .limit(1);
      if (!next) break;

      const out = await transcodeMedia(next.id);
      if (out.status === "done") done++;
      else if (out.status === "failed") failed++;
    }
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${QUEUE_LOCK})`);
  }

  return { claimed: true, done, failed };
}
