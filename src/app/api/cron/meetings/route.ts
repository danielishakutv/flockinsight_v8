import {
  continueDueSeries,
  endAbandonedMeetings,
  expireMissedMeetings,
  failStalledRecordings,
  pruneSignals,
} from "@/lib/meetings";
import { warmScriptureCache } from "@/lib/scripture";
import { QUICK_VERSES } from "@/lib/scripture-shared";
import { withCronRun } from "@/lib/cron-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/meetings — housekeeping. Every 10 minutes.
 *
 * Three jobs, all of them about rooms nobody is looking after any more:
 *
 *  1. Close meetings whose last participant closed a laptop lid instead of
 *     pressing Leave. Without this they stay "live" for ever, show a green dot
 *     on the list, and count towards the church's live total.
 *  2. Cancel meetings that were scheduled and never opened, well after the
 *     fact, so the upcoming list is things that are actually coming up.
 *  3. Put the next occurrence of every repeating meeting on the calendar, for
 *     any series that finished one without getting one — the backstop for the
 *     roll-forward that normally happens the moment a meeting ends.
 *  4. Sweep consumed signalling rows. That table is a transport buffer — its
 *     rows are read within a second or two and are meaningless a minute later.
 *     The sweep is always age-scoped, and it is the ONLY table this touches:
 *     the record of what happened in a meeting lives in meeting_participant,
 *     meeting_message, meeting_recording and the audit log, and none of those
 *     is ever swept.
 *
 * Auth via ?key=CRON_SECRET or a Bearer header, as with every other cron here.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("key");
  if (!secret || key !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  return withCronRun("meetings", async () => {
    const ended = await endAbandonedMeetings();
    const expired = await expireMissedMeetings();
    const swept = await pruneSignals(10);
    /*
     * The backstop for a browser that never came back. A recording stuck at
     * "uploading" is the one state that lets a host believe they have something
     * they do not, so the server stops believing it after half an hour.
     */
    const stalledRecordings = await failStalledRecordings(30);

    /*
     * Every repeating meeting that has finished an occurrence and has no next
     * one. Almost always nothing: the next occurrence is created the moment one
     * ends. This is the backstop for what is not an ending — a cancelled week, a
     * worker restarted mid-insert, a database briefly out of reach — because a
     * repeating meeting that quietly stopped repeating is the one failure nobody
     * notices until the Wednesday it was needed.
     *
     * Runs AFTER expireMissedMeetings, so a meeting that has just been given up
     * on is rolled forward in the same tick rather than ten minutes later.
     */
    const seriesScheduled = await continueDueSeries();

    /*
     * Convert whatever is still waiting. Normally a transcode starts the moment
     * an upload finishes; this catches the ones whose worker was restarted
     * mid-job, and is the only thing that ever retries them. One at a time, and
     * only if no other worker holds the lock.
     */
    let transcoded: Awaited<
      ReturnType<typeof import("@/lib/media-transcode").runTranscodeQueue>
    > | null = null;
    try {
      const { runTranscodeQueue } = await import("@/lib/media-transcode");
      transcoded = await runTranscodeQueue(2);
    } catch (e) {
      console.error("[cron/meetings] transcode queue failed", e);
    }

    // Partial uploads nobody came back for. Two weeks, because an upload here
    // may legitimately span days on a poor connection.
    let staleUploads: { removed: number; bytes: number } | null = null;
    try {
      const { sweepStaleUploads } = await import("@/lib/media-store");
      staleUploads = await sweepStaleUploads(14);
    } catch (e) {
      console.error("[cron/meetings] temp sweep failed", e);
    }

    // Once a day is plenty, and it is somebody else's free service — so this
    // only runs on the first tick of the hour before most Sunday services.
    let warmed = 0;
    if (new Date().getUTCHours() === 5 && new Date().getUTCMinutes() < 10) {
      warmed = await warmScriptureCache(QUICK_VERSES);
    }

    return new Response(
      JSON.stringify({ ok: true, ended, expired, seriesScheduled, swept, warmed, stalledRecordings, transcoded, staleUploads }),
      { headers: { "Content-Type": "application/json" } },
    );
  });
}
