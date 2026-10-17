import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
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

export class Supervisor implements IngestRouter {
  readonly live = new Map<string, LiveRecording>();
  private readonly startedAt = Date.now();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private listener: import("pg").Client | null = null;
  private ticking = false;
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
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    // Let the tick in progress finish, then put every capture down cleanly.
    while (this.ticking) await new Promise((r) => setTimeout(r, 50));
    await Promise.all([...this.live.values()].map((r) => r.abandon()));
    try {
      await this.listener?.end();
    } catch {
      /* closing */
    }
  }

  /** Something changed: look now rather than on the next pass. */
  wake(): void {
    if (this.stopping) return;
    this.arm(0);
  }

  private arm(ms: number): void {
    if (this.stopping) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
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
      client.on("notification", () => this.wake());
      await client.connect();
      await client.query("LISTEN flockinsight_recorder");
      this.listener = client;
    } catch (e) {
      this.log(`LISTEN unavailable (${String((e as Error).message ?? e)}); polling only`);
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.stopping) return;
    this.ticking = true;
    try {
      await this.pass();
      this.lastTickError = null;
    } catch (e) {
      this.lastTickError = String((e as Error).message ?? e);
      this.log(`tick failed: ${this.lastTickError}`);
    } finally {
      this.ticking = false;
      this.arm(this.config.pollMs);
    }
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
      seen.add(raw.id);
      const row: RecordingRow = { ...raw, mode: raw.mode === "video" ? "video" : "audio" };
      let rec = this.live.get(row.id);
      if (rec?.finishing) continue;

      const room = await this.loadRoom(row.meetingId);
      const over = room.status === "ended" || room.status === "cancelled";

      if (!rec) {
        rec = new LiveRecording({ row, config: this.config, log: this.log });
        this.live.set(row.id, rec);
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
          this.live.delete(row.id);
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

  private finishAndForget(rec: LiveRecording, reason: Parameters<LiveRecording["finish"]>[0]): void {
    void rec
      .finish(reason)
      .catch((e) => this.log(`[${rec.id.slice(0, 8)}] finish threw: ${String((e as Error).message ?? e)}`))
      .finally(() => this.live.delete(rec.id));
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
