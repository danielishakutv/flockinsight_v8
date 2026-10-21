import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  meeting,
  meetingParticipant,
  meetingRecording,
  platformSetting,
} from "@/db/schema";
import { parseStage } from "@/lib/meetings-shared";
import { LiveRecording, type RecordingRow, type RoomView } from "./capture";
import type { RecorderConfig } from "./config";
import { STALLED_RECORDER_MESSAGE } from "./health";
import type { IngestTarget } from "./tokens";
import type { IngestRouter, IngestSink } from "./ws-server";

/**
 * Turns rows into recordings.
 *
 * The database is the queue and the state. A host pressing Record writes a
 * row with status "recording"; this loop notices (woken by NOTIFY, or on its
 * next pass), starts a capture, and keeps it in step with the room every
 * couple of seconds: who is here, who is publishing, what is on the screen.
 * Stop writes `stopped_at`; the meeting ending does the same; a room that has
 * been empty for a while ends its own recording. Each of those finishes the
 * capture, which files the result and says so in the row.
 *
 * It also writes two heartbeats. One on each live row, so the stalled sweep
 * can tell a recording in progress from one whose service died. And one in
 * `platform_setting`, so the app can refuse to START a server recording when
 * nothing is here to make it — and fall back to recording in the browser.
 *
 * One process, one loop, one tick at a time. There is nothing to lock.
 */

const HEARTBEAT_MS = 10_000;
export const RECORDER_ALIVE_KEY = "recorder_alive_at";
/** Anyone seen within this long is "in the room" as far as a capture is concerned. */
const PRESENCE_GRACE_MS = 90_000;
/** The app's "look at your rows" channel: Record, Stop, the meeting ending. */
const RECORDER_CHANNEL = "flockinsight_recorder";
/**
 * The app's room channel: every write in a live room (somebody publishing,
 * unmuting, joining, a new publisher session) NOTIFYs it with the meeting id.
 */
const MEETING_CHANNEL = "flockinsight_meeting";
/** A burst of room notifications becomes one pass, at most this long after the first. */
const ROOM_WAKE_MS = 250;

export class Supervisor implements IngestRouter {
  readonly live = new Map<string, LiveRecording>();
  private readonly startedAt = Date.now();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private listener: import("pg").Client | null = null;
  /** When the armed timer fires, so a later wake never pushes an earlier pass back. */
  private dueAt = Infinity;
  private ticking = false;
  /** A wake arrived mid-pass: run another as soon as this one ends. */
  private wakeAgain = false;
  private stopping = false;
  private lastTickError: string | null = null;

  constructor(
    private readonly config: RecorderConfig,
    private readonly log: (line: string) => void,
  ) {}

  /* ------------------------------------------------------- IngestRouter */

  expects(target: IngestTarget): IngestSink | null {
    const rec = this.live.get(target.recordingId);
    return rec && rec.expects(target) ? rec : null;
  }

  health(): Record<string, unknown> {
    return {
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      live: this.live.size,
      recordings: [...this.live.values()].map((r) => r.describe()),
      lastTickError: this.lastTickError,
    };
  }

  /* ------------------------------------------------------------- loop */

  async start(): Promise<void> {
    await this.listen();
    await this.heartbeat();
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    this.arm(0);
    // Catches and logs its own failures; the loop does not wait on it.
    void this.recoverStalled();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    /*
     * Synchronously, before anything is awaited. The stop signal can reach
     * ffmpeg too (PM2 signals the process tree), and an ffmpeg exit seen by a
     * capture that does not yet know it is stopping was counted as a crash and
     * answered with a fresh segment, in the middle of shutting down.
     */
    for (const r of this.live.values()) r.markStopping();
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    // Let the tick in progress finish, then put every capture down cleanly.
    while (this.ticking) await new Promise((r) => setTimeout(r, 50));
    await Promise.all([...this.live.values()].map((r) => r.abandon()));
    try {
      await this.listener?.end();
    } catch (e) {
      this.log(`closing the LISTEN connection: ${String((e as Error).message ?? e)}`);
    }
  }

  /** Something changed: look now (or within `ms`) rather than on the next pass. */
  wake(ms = 0): void {
    if (this.stopping) return;
    this.arm(ms);
  }

  private arm(ms: number): void {
    if (this.stopping) return;
    const at = Date.now() + ms;
    if (this.timer && this.dueAt <= at) return; // a pass is already due sooner
    if (this.timer) clearTimeout(this.timer);
    this.dueAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.dueAt = Infinity;
      void this.tick();
    }, ms);
  }

  /** Whether a room notification is about a meeting being recorded right now. */
  private recordingMeeting(meetingId: string): boolean {
    for (const r of this.live.values()) if (r.meetingId === meetingId && !r.finishing) return true;
    return false;
  }

  private async listen(): Promise<void> {
    try {
      const { Client } = await import("pg");
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      client.on("error", (e) => {
        this.log(`listen connection lost (${e.message}); polling carries on`);
        this.listener = null;
        // Try again later; the poll is the safety net meanwhile.
        setTimeout(() => void this.listen(), 15_000).unref();
      });
      client.on("notification", (msg) => {
        if (msg.channel === MEETING_CHANNEL) {
          /*
           * A new speaker or a rebuilt publisher used to wait for the next
           * two-second poll, and the first seconds of what they said went with
           * it. Only rooms being recorded matter, and a burst of notifications
           * (they come in flurries) becomes one pass.
           */
          if (msg.payload && this.recordingMeeting(msg.payload)) this.wake(ROOM_WAKE_MS);
          return;
        }
        this.wake();
      });
      await client.connect();
      await client.query(`LISTEN ${RECORDER_CHANNEL}`);
      await client.query(`LISTEN ${MEETING_CHANNEL}`);
      this.listener = client;
    } catch (e) {
      this.log(`LISTEN unavailable (${String((e as Error).message ?? e)}); polling only`);
    }
  }

  private async tick(): Promise<void> {
    if (this.stopping) return;
    if (this.ticking) {
      // Dropping this wake would leave the change it announced until the next poll.
      this.wakeAgain = true;
      return;
    }
    this.ticking = true;
    try {
      await this.pass();
      this.lastTickError = null;
    } catch (e) {
      this.lastTickError = String((e as Error).message ?? e);
      this.log(`tick failed: ${this.lastTickError}`);
    } finally {
      this.ticking = false;
      const again = this.wakeAgain;
      this.wakeAgain = false;
      this.arm(again ? 0 : this.config.pollMs);
    }
  }

  private adopt(row: RecordingRow): LiveRecording {
    const rec = new LiveRecording({ row, config: this.config, log: this.log, onSettled: (r) => this.forget(r) });
    this.live.set(row.id, rec);
    return rec;
  }

  /** Let go of a capture whose finish has settled, however it finished. */
  private forget(rec: LiveRecording): void {
    if (this.live.get(rec.id) === rec) this.live.delete(rec.id);
  }

  private async pass(): Promise<void> {
    const rows = await db
      .select({
        id: meetingRecording.id,
        meetingId: meetingRecording.meetingId,
        churchId: meetingRecording.churchId,
        mode: meetingRecording.mode,
        title: meetingRecording.title,
        createdBy: meetingRecording.createdBy,
        startedAt: meetingRecording.startedAt,
        stoppedAt: meetingRecording.stoppedAt,
        status: meetingRecording.status,
      })
      .from(meetingRecording)
      .where(
        and(
          eq(meetingRecording.source, "server"),
          inArray(meetingRecording.status, ["recording", "processing"]),
        ),
      );

    const seen = new Set<string>();
    for (const raw of rows) {
      /*
       * stop() marks every capture it can see as stopping and then waits for
       * this pass. Carrying on adopted rows after that: a fresh segment opened
       * (up to fifteen seconds for a video one to connect), adapters asked for
       * and finishes begun, all inside the forty seconds the shutdown has. The
       * next process picks these rows up.
       */
      if (this.stopping) return;
      seen.add(raw.id);
      const row: RecordingRow = { ...raw, mode: raw.mode === "video" ? "video" : "audio" };
      let rec = this.live.get(row.id);
      if (rec?.finishing) continue;

      const room = await this.loadRoom(row.meetingId);
      const over = room.status === "ended" || room.status === "cancelled";

      if (!rec) {
        rec = this.adopt(row);
        /*
         * A row that was already told to stop before we came back — Stop was
         * pressed while the service was down, or a finish was cut short —
         * needs no new capture. It needs the segments on disk filed.
         */
        if (row.stoppedAt || over || row.status === "processing") {
          this.finishAndForget(rec, "resumed-after-stop");
          continue;
        }
        try {
          await rec.start(room);
        } catch (e) {
          const why = String((e as Error).message ?? e);
          this.log(`[${row.id.slice(0, 8)}] could not start: ${why}`);
          /*
           * A resumed recording already has segments from before the restart,
           * and they are the recording up to that point. File them, with the
           * reason beside them, rather than marking the whole thing failed.
           */
          if (await rec.hasSegments()) {
            this.finishAndForget(
              rec,
              "start-failed",
              `The recording service restarted during this recording and could not carry on (${why.slice(0, 200)}); this is what it captured before that.`,
            );
            continue;
          }
          this.forget(rec);
          await db
            .update(meetingRecording)
            .set({ status: "failed", error: `The recording could not start: ${why}`.slice(0, 300), lastActivityAt: new Date() })
            .where(and(eq(meetingRecording.id, row.id), eq(meetingRecording.status, "recording")));
          continue;
        }
      }

      if (row.stoppedAt) {
        this.finishAndForget(rec, "stopped");
        continue;
      }
      if (over) {
        this.finishAndForget(rec, "meeting-ended");
        continue;
      }
      if (room.people.length === 0) {
        rec.emptySince ??= Date.now();
        if (Date.now() - rec.emptySince >= this.config.emptyRoomMs) {
          this.log(`[${row.id.slice(0, 8)}] the room has been empty for ${Math.round(this.config.emptyRoomMs / 1000)}s; stopping`);
          await db
            .update(meetingRecording)
            .set({ stoppedAt: new Date(), lastActivityAt: new Date() })
            .where(and(eq(meetingRecording.id, row.id), isNull(meetingRecording.stoppedAt)));
          this.finishAndForget(rec, "room-empty");
          continue;
        }
      } else {
        rec.emptySince = null;
      }
      await rec.reconcile(room);
    }

    // A row that vanished from under a live capture — deleted with its
    // meeting, or moved to a state we do not drive. Put the capture down.
    for (const [id, rec] of this.live) {
      if (seen.has(id) || rec.finishing) continue;
      this.log(`[${id.slice(0, 8)}] its row is no longer being recorded; finishing`);
      this.finishAndForget(rec, "stopped");
    }
  }

  private finishAndForget(rec: LiveRecording, reason: Parameters<LiveRecording["finish"]>[0], note?: string): void {
    void rec
      .finish(reason, note)
      .catch((e) => this.log(`[${rec.id.slice(0, 8)}] finish threw: ${String((e as Error).message ?? e)}`))
      .finally(() => this.forget(rec));
  }

  /**
   * Rows the app's stalled sweep gave up on while this service was away
   * (fifteen minutes without a heartbeat) whose segments are still on disk.
   * The sweep's words promise that what was captured is kept; this keeps the
   * promise by filing it, at start-up. One at a time and in the background:
   * assembling is the heaviest thing this process does, on a box that also
   * serves every church's website. A row that cannot be recovered gets our
   * reason in place of the sweep's (see markFailed), so it is not tried again.
   */
  private async recoverStalled(): Promise<void> {
    let rows: (Omit<RecordingRow, "mode"> & { mode: string })[];
    try {
      rows = await db
        .select({
          id: meetingRecording.id,
          meetingId: meetingRecording.meetingId,
          churchId: meetingRecording.churchId,
          mode: meetingRecording.mode,
          title: meetingRecording.title,
          createdBy: meetingRecording.createdBy,
          startedAt: meetingRecording.startedAt,
          stoppedAt: meetingRecording.stoppedAt,
          status: meetingRecording.status,
        })
        .from(meetingRecording)
        .where(
          and(
            eq(meetingRecording.source, "server"),
            eq(meetingRecording.status, "failed"),
            eq(meetingRecording.error, STALLED_RECORDER_MESSAGE),
          ),
        )
        .orderBy(desc(meetingRecording.createdAt))
        .limit(100);
    } catch (e) {
      this.log(`could not look for recordings the stalled sweep gave up on: ${String((e as Error).message ?? e)}`);
      return;
    }
    for (const raw of rows) {
      if (this.stopping) return;
      if (this.live.has(raw.id)) continue;
      const row: RecordingRow = { ...raw, mode: raw.mode === "video" ? "video" : "audio" };
      const rec = new LiveRecording({ row, config: this.config, log: this.log, onSettled: (r) => this.forget(r) });
      if (!(await rec.hasSegments())) continue;
      this.log(`[${row.id.slice(0, 8)}] marked stalled while this service was away; filing the segments it left`);
      this.live.set(row.id, rec);
      try {
        await rec.finish(
          "recovered",
          "The recording service stopped responding during this recording; this is what it captured before that.",
        );
      } catch (e) {
        this.log(`[${row.id.slice(0, 8)}] recovery threw: ${String((e as Error).message ?? e)}`);
      } finally {
        this.forget(rec);
      }
    }
  }

  private async loadRoom(meetingId: string): Promise<RoomView> {
    const [m] = await db
      .select({
        status: meeting.status,
        title: meeting.title,
        stage: meeting.stage,
        spotlightPeerId: meeting.spotlightPeerId,
        churchName: church.name,
      })
      .from(meeting)
      .innerJoin(church, eq(church.id, meeting.churchId))
      .where(eq(meeting.id, meetingId))
      .limit(1);

    const people = await db
      .select({
        participantId: meetingParticipant.id,
        peerId: meetingParticipant.peerId,
        name: meetingParticipant.displayName,
        role: meetingParticipant.role,
        sfuSessionId: meetingParticipant.sfuSessionId,
        micOn: meetingParticipant.micOn,
        cameraOn: meetingParticipant.cameraOn,
        sharing: meetingParticipant.sharing,
        joinedAt: meetingParticipant.joinedAt,
      })
      .from(meetingParticipant)
      .where(
        and(
          eq(meetingParticipant.meetingId, meetingId),
          eq(meetingParticipant.admitted, true),
          eq(meetingParticipant.removed, false),
          isNull(meetingParticipant.leftAt),
          gte(meetingParticipant.lastSeenAt, new Date(Date.now() - PRESENCE_GRACE_MS)),
        ),
      );

    return {
      status: m?.status ?? "ended",
      title: m?.title ?? "",
      churchName: m?.churchName ?? "",
      stage: parseStage(m?.stage),
      spotlightPeerId: m?.spotlightPeerId ?? null,
      people: people.map((p) => ({ ...p, joinedAt: p.joinedAt.toISOString() })),
    };
  }

  private async heartbeat(): Promise<void> {
    // Each capture's counts, so a restart can tell "nothing was captured" from
    // "not counted by this process". Each saves and logs on its own.
    await Promise.all([...this.live.values()].map((r) => r.saveStats()));
    try {
      const ids = [...this.live.keys()];
      if (ids.length > 0) {
        await db
          .update(meetingRecording)
          .set({ recorderHeartbeatAt: new Date(), lastActivityAt: new Date() })
          .where(inArray(meetingRecording.id, ids));
      }
      const now = new Date().toISOString();
      await db
        .insert(platformSetting)
        .values({ key: RECORDER_ALIVE_KEY, value: now })
        .onConflictDoUpdate({
          target: platformSetting.key,
          set: { value: now, updatedAt: sql`now()` },
        });
    } catch (e) {
      this.log(`heartbeat failed: ${String((e as Error).message ?? e)}`);
    }
  }
}
