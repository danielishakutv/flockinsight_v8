import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WebSocket } from "ws";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, media, meetingRecording, meetingSignal } from "@/db/schema";
import {
  closeWebSocketAdapters,
  createWebSocketAdapters,
  type AdapterRequest,
} from "@/lib/sfu";
import { commitUpload, makeStorageKey } from "@/lib/media-store";
import type { Stage } from "@/lib/meetings-shared";
import type { RecorderConfig } from "./config";
import {
  assembleSegments,
  probeDuration,
  readJpeg,
  renderCard,
  renderSlide,
  spawnSegment,
  VIDEO_FPS,
  type SegmentHandle,
} from "./ffmpeg";
import { AudioMixer, FRAME_MS, toPcmBytes } from "./mixer";
import type { MediaPacket } from "./protobuf";
import {
  chooseStage,
  stageCaption,
  stageKey,
  type StageChoice,
  type StagePerson,
} from "./stage";
import { ingestPath, newNonce, type IngestKind, type IngestTarget } from "./tokens";
import type { IngestSink } from "./ws-server";

/**
 * One recording, from Record to a row in the media library.
 *
 * WHAT IT DOES. For every microphone in the room it asks the media server to
 * stream that track to our ingest endpoint, mixes the voices as they arrive
 * (see mixer.ts) and pushes the mix into a live ffmpeg encode (ffmpeg.ts).
 * For a video recording it also follows what the room is looking at — a
 * shared screen, a verse, a slide, the spotlit camera — and feeds that
 * picture, one frame at a time, beside the audio. When the host presses Stop
 * (or the meeting ends, or the room empties), it closes everything, joins
 * whatever segments it wrote into one file, and files that in the library.
 *
 * WHAT IT SURVIVES. Its own process being killed at any moment. Every
 * segment is a fragmented MP4 that is complete to within two seconds of a
 * crash; a restarted service finds the segments on disk, starts a new one,
 * and joins them all at the end. The media server retries our endpoint for
 * fifteen seconds while we are away and the new process asks for fresh
 * adapters regardless, so a restart costs the seconds it takes, not the
 * recording.
 *
 * WHAT IT NEVER DOES. It never deletes. A failed recording leaves its
 * segments where an operator can find them, and says in the row why it
 * failed.
 */

export type RecordingRow = {
  id: string;
  meetingId: string;
  churchId: string;
  mode: "audio" | "video";
  title: string;
  createdBy: string | null;
  startedAt: Date | null;
  stoppedAt: Date | null;
  status: string;
};

export type RoomView = {
  status: string;
  title: string;
  churchName: string;
  stage: Stage;
  spotlightPeerId: string | null;
  people: StagePerson[];
};

type Adapter = {
  key: string;
  kind: IngestKind;
  participantId: string;
  sessionId: string;
  trackName: string;
  nonce: string;
  adapterId: string | null;
  attempts: number;
  nextTryAt: number;
  lastPacketAt: number;
  lastError: string | null;
  sockets: Set<WebSocket>;
};

export type FinishReason = "stopped" | "meeting-ended" | "room-empty" | "resumed-after-stop";

export type FinishOutcome =
  | { status: "ready"; mediaId: string; bytes: number; durationSec: number }
  | { status: "failed"; reason: string };

/** How long a muted microphone's adapter is kept before it is handed back. */
const QUIET_MIC_MS = 60_000;
/** Backoff for an adapter the media server would not give us. */
const RETRY_STEPS_MS = [3000, 6000, 12000, 20000, 30000];
/** ffmpeg deaths inside a minute before the recording is given up on. */
const MAX_SEGMENT_CRASHES = 3;

const adapterKey = (participantId: string, kind: IngestKind) => `${participantId}:${kind}`;

export class LiveRecording implements IngestSink {
  readonly id: string;
  readonly meetingId: string;
  readonly churchId: string;
  readonly mode: "audio" | "video";
  readonly dir: string;

  /** Set by the supervisor while the room has nobody in it. */
  emptySince: number | null = null;
  /** The finish in progress, so a tick never starts a second one. */
  finishing: Promise<FinishOutcome> | null = null;

  private readonly title: string;
  private readonly createdBy: string | null;
  private churchName = "";
  private meetingTitle = "";
  private readonly config: RecorderConfig;
  private readonly log: (line: string) => void;

  private readonly mixer = new AudioMixer();
  private readonly adapters = new Map<string, Adapter>();

  private segment: SegmentHandle | null = null;
  private segmentIndex = 0;
  private segmentCrashes: number[] = [];
  private clock = { startedAt: 0, audioFrames: 0, videoFrames: 0 };
  private ticker: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private droppedWrites = 0;

  /* The picture, for a video recording. */
  private stageCurrent: StageChoice | null = null;
  private stageCurrentKey: string | null = null;
  private videoAdapterKey: string | null = null;
  private latestJpeg: Buffer | null = null;
  private placeholder: Buffer | null = null;
  private readonly frameCache = new Map<string, Buffer>();
  private readonly framePending = new Set<string>();
  private readonly captionFile: string;
  private readonly watermarkFile: string;

  readonly stats = { audioPackets: 0, videoPackets: 0, audioBytes: 0, attaches: 0 };

  constructor(opts: {
    row: RecordingRow;
    config: RecorderConfig;
    log: (line: string) => void;
  }) {
    this.id = opts.row.id;
    this.meetingId = opts.row.meetingId;
    this.churchId = opts.row.churchId;
    this.mode = opts.row.mode;
    this.title = opts.row.title;
    this.createdBy = opts.row.createdBy;
    this.config = opts.config;
    this.log = (line) => opts.log(`[${this.id.slice(0, 8)}] ${line}`);
    this.dir = path.join(opts.config.workDir, this.id);
    this.captionFile = path.join(this.dir, "caption.txt");
    this.watermarkFile = path.join(this.dir, "watermark.txt");
  }

  /* ============================================================
   * Starting
   * ========================================================== */

  async start(room: RoomView): Promise<void> {
    this.churchName = room.churchName;
    this.meetingTitle = room.title;
    await mkdir(this.dir, { recursive: true });

    // Resume: continue the numbering after whatever an earlier process left.
    const existing = await this.segmentFiles();
    this.segmentIndex = existing.length;
    if (existing.length > 0) this.log(`resuming after ${existing.length} earlier segment(s)`);

    await writeFile(this.captionFile, "");
    await writeFile(
      this.watermarkFile,
      this.churchName ? `${this.churchName} · Recorded with FlockInsight` : "Recorded with FlockInsight",
    );

    if (this.mode === "video") {
      const file = path.join(this.dir, "card-title.jpg");
      await renderCard(
        { title: this.meetingTitle, body: this.churchName, footnote: "" },
        file,
        this.config.fonts,
      );
      this.placeholder = await readJpeg(file);
      this.latestJpeg = this.placeholder;
    }

    await this.openSegment();
    this.ticker = setInterval(() => this.tick(), FRAME_MS);
    this.log(`capturing (${this.mode})`);
  }

  private segmentExt(): string {
    return this.mode === "video" ? "mp4" : "m4a";
  }

  private async segmentFiles(): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    return names
      .filter((n) => /^seg-\d{3}\.(m4a|mp4)$/.test(n))
      .sort()
      .map((n) => path.join(this.dir, n));
  }

  private async openSegment(): Promise<void> {
    this.segmentIndex += 1;
    const file = path.join(this.dir, `seg-${String(this.segmentIndex).padStart(3, "0")}.${this.segmentExt()}`);
    const segment = await spawnSegment({
      mode: this.mode,
      path: file,
      captionFile: this.captionFile,
      watermarkFile: this.watermarkFile,
      fonts: this.config.fonts,
    });
    this.segment = segment;
    this.clock = { startedAt: Date.now(), audioFrames: 0, videoFrames: 0 };

    void segment.done.then((out) => {
      if (this.segment !== segment) return; // retired on purpose
      if (this.stopped) return;
      /*
       * ffmpeg went away under a live recording. Its file is complete up to
       * the last fragment; start another beside it and carry on. Three in a
       * minute is not bad luck, it is a box that cannot encode, and the
       * recording is failed with ffmpeg's own last words.
       */
      const now = Date.now();
      this.segmentCrashes = this.segmentCrashes.filter((t) => now - t < 60_000);
      this.segmentCrashes.push(now);
      const why = out.stderr.trim().split("\n").filter(Boolean).pop() ?? `exit ${out.code ?? out.signal}`;
      this.log(`ffmpeg stopped mid-recording: ${why}`);
      if (this.segmentCrashes.length >= MAX_SEGMENT_CRASHES) {
        this.segment = null;
        void this.failNow(`The encoder kept stopping: ${why}`);
        return;
      }
      void this.openSegment().catch((e) => {
        this.log(`could not start a new segment: ${String(e)}`);
        void this.failNow(`The encoder could not be restarted: ${String((e as Error).message ?? e)}`);
      });
    });
  }

  /* ============================================================
   * The clock: exactly 48,000 samples and VIDEO_FPS frames per second
   * ========================================================== */

  private tick(): void {
    const segment = this.segment;
    if (!segment || this.stopped) return;
    const elapsed = Date.now() - this.clock.startedAt;

    const dueAudio = Math.floor(elapsed / FRAME_MS) - this.clock.audioFrames;
    if (dueAudio > 0) {
      const pcm = toPcmBytes(this.mixer.pull(dueAudio));
      this.clock.audioFrames += dueAudio;
      this.write(segment.audio, pcm);
    }

    if (segment.video) {
      const dueVideo = Math.floor(elapsed / (1000 / VIDEO_FPS)) - this.clock.videoFrames;
      if (dueVideo > 0) {
        const frame = this.latestJpeg ?? this.placeholder;
        this.clock.videoFrames += dueVideo;
        if (frame) {
          for (let i = 0; i < dueVideo; i++) this.write(segment.video, frame);
        }
      }
    }
  }

  private write(stream: NodeJS.WritableStream & { writableLength?: number }, bytes: Uint8Array): void {
    /*
     * ffmpeg consumes in real time, so the pipe is normally empty. If it is
     * not — a starved box, a stalled encoder — the mix must not pile up in
     * memory for ever. Past eight megabytes the frame is dropped and counted;
     * the file loses a moment rather than the process losing the box.
     */
    if ((stream.writableLength ?? 0) > 8 * 1024 * 1024) {
      this.droppedWrites += 1;
      if (this.droppedWrites % 250 === 1) this.log(`encoder is behind; dropped ${this.droppedWrites} write(s)`);
      return;
    }
    try {
      stream.write(bytes);
    } catch (e) {
      this.log(`write failed: ${String((e as Error).message ?? e)}`);
    }
  }

  /* ============================================================
   * Frames in
   * ========================================================== */

  expects(target: IngestTarget): boolean {
    return !this.stopped && this.adapters.has(adapterKey(target.participantId, target.kind));
  }

  attach(target: IngestTarget, ws: WebSocket): void {
    const a = this.adapters.get(adapterKey(target.participantId, target.kind));
    if (!a) {
      ws.close();
      return;
    }
    a.sockets.add(ws);
    this.stats.attaches += 1;
    this.log(`${target.kind} stream connected for ${target.participantId.slice(0, 8)} (${a.sockets.size} socket(s))`);
  }

  detach(target: IngestTarget, ws: WebSocket): void {
    const a = this.adapters.get(adapterKey(target.participantId, target.kind));
    a?.sockets.delete(ws);
  }

  packet(target: IngestTarget, packet: MediaPacket): void {
    const key = adapterKey(target.participantId, target.kind);
    const a = this.adapters.get(key);
    if (!a) return;
    a.lastPacketAt = Date.now();
    if (target.kind === "mic") {
      this.stats.audioPackets += 1;
      this.stats.audioBytes += packet.payload.length;
      this.mixer.push(target.participantId, packet.payload);
      return;
    }
    this.stats.videoPackets += 1;
    if (key === this.videoAdapterKey && packet.payload.length > 0) {
      // Copied: the socket's buffer is reused for the next message.
      this.latestJpeg = Buffer.from(packet.payload);
    }
  }

  /* ============================================================
   * Following the room
   * ========================================================== */

  async reconcile(room: RoomView): Promise<void> {
    if (this.stopped) return;
    this.churchName = room.churchName || this.churchName;
    this.meetingTitle = room.title || this.meetingTitle;
    const now = Date.now();

    const wanted = new Map<string, Omit<Adapter, "nonce" | "adapterId" | "attempts" | "nextTryAt" | "lastPacketAt" | "lastError" | "sockets">>();

    // Every voice: anyone publishing whose microphone is on, plus anyone
    // whose microphone we are still hearing from (a mute is a quiet track,
    // not a track to hand back and ask for again a minute later).
    for (const p of room.people) {
      if (!p.sfuSessionId) continue;
      const key = adapterKey(p.participantId, "mic");
      const have = this.adapters.get(key);
      const recentlyHeard = !!have && now - have.lastPacketAt < QUIET_MIC_MS;
      if (!p.micOn && !recentlyHeard && !(have && have.adapterId === null)) continue;
      wanted.set(key, {
        key,
        kind: "mic",
        participantId: p.participantId,
        sessionId: p.sfuSessionId,
        trackName: "mic",
      });
    }

    // The picture.
    if (this.mode === "video") {
      const choice = chooseStage({
        people: room.people,
        stage: room.stage,
        spotlightPeerId: room.spotlightPeerId,
        meetingTitle: this.meetingTitle,
        churchName: this.churchName,
      });
      await this.showStage(choice);
      if (choice.kind === "track") {
        const kind: IngestKind = choice.trackName === "screen" ? "screen" : "cam";
        const key = adapterKey(choice.participantId, kind);
        wanted.set(key, {
          key,
          kind,
          participantId: choice.participantId,
          sessionId: choice.sessionId,
          trackName: choice.trackName,
        });
        this.videoAdapterKey = key;
      } else {
        this.videoAdapterKey = null;
      }
    }

    // Hand back what is no longer wanted, or belongs to a session that has
    // been replaced (a rejoin is a new participant row, so this is rare).
    const toClose: Adapter[] = [];
    for (const [key, a] of this.adapters) {
      const want = wanted.get(key);
      if (!want || want.sessionId !== a.sessionId) {
        toClose.push(a);
        this.adapters.delete(key);
      }
    }
    await this.closeAdapters(toClose);

    // And ask for what is missing.
    const toCreate: Adapter[] = [];
    for (const [key, want] of wanted) {
      let a = this.adapters.get(key);
      if (!a) {
        a = {
          ...want,
          nonce: newNonce(),
          adapterId: null,
          attempts: 0,
          nextTryAt: 0,
          lastPacketAt: 0,
          lastError: null,
          sockets: new Set(),
        };
        this.adapters.set(key, a);
        if (want.kind === "mic") this.mixer.addSource(want.participantId);
      }
      if (a.adapterId === null && now >= a.nextTryAt) toCreate.push(a);
    }
    await this.createAdapters(toCreate);
  }

  private endpointFor(a: Adapter): string {
    return (
      this.config.ingestBase +
      ingestPath(this.config.secret, {
        recordingId: this.id,
        participantId: a.participantId,
        kind: a.kind,
        nonce: a.nonce,
      })
    );
  }

  private async createAdapters(list: Adapter[]): Promise<void> {
    for (let i = 0; i < list.length; i += 4) {
      const batch = list.slice(i, i + 4);
      const request: AdapterRequest[] = batch.map((a) => ({
        location: "remote",
        sessionId: a.sessionId,
        trackName: a.trackName,
        endpoint: this.endpointFor(a),
        outputCodec: a.kind === "mic" ? "pcm" : "jpeg",
      }));
      let results: { adapterId?: string; errorCode?: string; errorDescription?: string }[];
      try {
        results = (await createWebSocketAdapters(request)).tracks;
      } catch (e) {
        const why = String((e as Error).message ?? e);
        for (const a of batch) this.backOff(a, why);
        continue;
      }
      batch.forEach((a, n) => {
        const r = results[n];
        if (!r || !r.adapterId) {
          this.backOff(a, r?.errorDescription ?? r?.errorCode ?? "no adapter id in the answer");
          return;
        }
        a.adapterId = r.adapterId;
        a.attempts = 0;
        a.lastError = null;
        this.log(`${a.kind} adapter ${r.adapterId.slice(0, 8)} for ${a.participantId.slice(0, 8)}`);
      });
    }
  }

  private backOff(a: Adapter, why: string): void {
    a.attempts += 1;
    const wait = RETRY_STEPS_MS[Math.min(a.attempts - 1, RETRY_STEPS_MS.length - 1)];
    a.nextTryAt = Date.now() + wait;
    if (a.lastError !== why) {
      a.lastError = why;
      this.log(`${a.kind} for ${a.participantId.slice(0, 8)} refused (${why}); trying again in ${wait / 1000}s`);
    }
  }

  private async closeAdapters(list: Adapter[]): Promise<void> {
    for (const a of list) {
      for (const ws of a.sockets) {
        try {
          ws.close();
        } catch {
          /* closing */
        }
      }
      a.sockets.clear();
      if (a.kind === "mic") this.mixer.removeSource(a.participantId);
    }
    const ids = list.map((a) => a.adapterId).filter((x): x is string => !!x);
    for (let i = 0; i < ids.length; i += 4) {
      try {
        await closeWebSocketAdapters(ids.slice(i, i + 4));
      } catch (e) {
        // Best effort: the media server closes an adapter whose endpoint has
        // gone within fifteen seconds anyway.
        this.log(`could not close ${ids.slice(i, i + 4).length} adapter(s): ${String((e as Error).message ?? e)}`);
      }
    }
  }

  /* ============================================================
   * The picture
   * ========================================================== */

  private async showStage(choice: StageChoice): Promise<void> {
    const key = stageKey(choice);
    if (key === this.stageCurrentKey) return;
    this.stageCurrent = choice;
    this.stageCurrentKey = key;
    this.log(`showing ${key.slice(0, 60)}`);

    try {
      await writeFile(this.captionFile, stageCaption(choice));
    } catch (e) {
      this.log(`caption write failed: ${String((e as Error).message ?? e)}`);
    }

    if (choice.kind === "track") {
      // Keep the last picture until the first frame of the new one lands.
      return;
    }
    if (choice.kind === "empty") {
      this.latestJpeg = this.placeholder;
      return;
    }

    const cached = this.frameCache.get(key);
    if (cached) {
      this.latestJpeg = cached;
      return;
    }
    if (this.framePending.has(key)) return;
    this.framePending.add(key);
    const file = path.join(this.dir, `frame-${this.frameCache.size + this.framePending.size}.jpg`);
    const render =
      choice.kind === "card"
        ? renderCard(
            { title: choice.title, body: choice.body, footnote: choice.footnote },
            file,
            this.config.fonts,
          )
        : renderSlide(choice.url, file);
    void render
      .then(() => readJpeg(file))
      .then((jpeg) => {
        this.frameCache.set(key, jpeg);
        if (this.stageCurrentKey === key) this.latestJpeg = jpeg;
      })
      .catch((e) => {
        this.log(`could not render ${key.slice(0, 40)}: ${String((e as Error).message ?? e)}`);
        if (this.stageCurrentKey === key) this.latestJpeg = this.placeholder;
      })
      .finally(() => this.framePending.delete(key));
  }

  /* ============================================================
   * Finishing
   * ========================================================== */

  /** Stop capturing. Idempotent; the first caller's reason wins. */
  finish(reason: FinishReason): Promise<FinishOutcome> {
    this.finishing ??= this.finishOnce(reason);
    return this.finishing;
  }

  private async finishOnce(reason: FinishReason): Promise<FinishOutcome> {
    this.log(`finishing (${reason})`);
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;

    await db
      .update(meetingRecording)
      .set({ status: "processing", stoppedAt: sql`coalesce(${meetingRecording.stoppedAt}, now())`, lastActivityAt: new Date(), recorderHeartbeatAt: new Date() })
      .where(and(eq(meetingRecording.id, this.id), eq(meetingRecording.status, "recording")));

    await this.closeAdapters([...this.adapters.values()]);
    this.adapters.clear();
    await this.endSegment();

    try {
      const outcome = await this.assembleAndFile();
      this.log(`ready: ${outcome.bytes} bytes, ${outcome.durationSec}s`);
      await this.retireDir();
      return outcome;
    } catch (e) {
      const reason = String((e as Error).message ?? e).slice(0, 300);
      this.log(`failed: ${reason}`);
      await this.markFailed(reason);
      return { status: "failed", reason };
    }
  }

  private async endSegment(): Promise<void> {
    const segment = this.segment;
    this.segment = null;
    if (!segment) return;
    segment.end();
    const out = await Promise.race([
      segment.done,
      new Promise<null>((r) => setTimeout(() => r(null), 30_000)),
    ]);
    if (out === null) {
      this.log("ffmpeg did not finish in 30s; killing it (the fragments so far are kept)");
      segment.kill();
      await segment.done;
    } else if (out.code !== 0) {
      this.log(`ffmpeg exited ${out.code ?? out.signal}: ${out.stderr.trim().split("\n").pop() ?? ""}`);
    }
  }

  private async assembleAndFile(): Promise<FinishOutcome & { status: "ready" }> {
    const segments: string[] = [];
    for (const f of await this.segmentFiles()) {
      try {
        if ((await stat(f)).size > 1024) segments.push(f);
      } catch {
        /* vanished */
      }
    }
    if (segments.length === 0) {
      throw new Error(
        "Nothing was captured. The recording service was not receiving the meeting's audio — check that the media server can reach it.",
      );
    }

    const ext = this.segmentExt();
    const finalFile = path.join(this.dir, `final.${ext}`);
    await assembleSegments(segments, finalFile);
    const size = (await stat(finalFile)).size;
    const durationSec = (await probeDuration(finalFile)) ?? 0;
    if (durationSec < 1 && size < 50_000) {
      throw new Error("The recording came out empty — no audio reached the recording service.");
    }

    const mime = this.mode === "video" ? "video/mp4" : "audio/mp4";
    const key = makeStorageKey(this.churchId, ext);
    await commitUpload(finalFile, key);

    const row = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(media)
        .values({
          churchId: this.churchId,
          kind: "sermon",
          mime,
          size,
          bytes: size,
          provider: "local",
          storageKey: key,
          format: ext,
          durationSec: durationSec || null,
          // Encoded here as H.264/AAC in MP4 already — nothing to convert.
          transcodeStatus: "skipped",
          title: this.title.slice(0, 200),
          originalName: `${this.id}.${ext}`,
          uploadedBy: this.createdBy ?? undefined,
        })
        .returning({ id: media.id });

      await tx
        .update(meetingRecording)
        .set({
          status: "ready",
          mediaId: m.id,
          url: `/media/${m.id}`,
          bytes: size,
          durationSec,
          error: null,
          lastActivityAt: new Date(),
          recorderHeartbeatAt: new Date(),
        })
        // A finished file is the truth, even for a row a sweep gave up on.
        .where(and(eq(meetingRecording.id, this.id), inArray(meetingRecording.status, ["recording", "processing", "failed"])));
      return m;
    });

    await this.announce({ state: "saved", recordingId: this.id, mediaId: row.id });
    await this.audit(
      `Saved a ${this.mode} recording of "${this.meetingTitle || this.title}" to the media library`,
      "meetings.recording.update",
      "notice",
      { mode: this.mode, bytes: size, durationSec, mediaId: row.id, source: "server" },
    );
    return { status: "ready", mediaId: row.id, bytes: size, durationSec };
  }

  private async markFailed(reason: string): Promise<void> {
    try {
      await db
        .update(meetingRecording)
        .set({ status: "failed", error: reason, lastActivityAt: new Date(), recorderHeartbeatAt: new Date() })
        .where(and(eq(meetingRecording.id, this.id), inArray(meetingRecording.status, ["recording", "processing"])));
      await this.announce({ state: "failed", recordingId: this.id, reason });
      await this.audit(
        `A ${this.mode} recording of "${this.meetingTitle || this.title}" did not save — ${reason}`,
        "meetings.recording.failed",
        "warning",
        { mode: this.mode, reason, source: "server" },
      );
    } catch (e) {
      this.log(`could not record the failure: ${String((e as Error).message ?? e)}`);
    }
  }

  /** Something went badly wrong mid-capture: stop, keep what exists, say why. */
  private async failNow(reason: string): Promise<void> {
    if (this.finishing) return;
    this.finishing = (async () => {
      this.stopped = true;
      if (this.ticker) clearInterval(this.ticker);
      this.ticker = null;
      await this.closeAdapters([...this.adapters.values()]);
      this.adapters.clear();
      await this.endSegment();
      await this.markFailed(reason);
      return { status: "failed" as const, reason };
    })();
  }

  /**
   * The process is going down. End the segment cleanly and hand the adapters
   * back; the row stays "recording" so the next process resumes it.
   */
  async abandon(): Promise<void> {
    if (this.finishing) {
      await this.finishing;
      return;
    }
    this.log("process stopping; closing this segment to be resumed");
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    await this.closeAdapters([...this.adapters.values()]);
    this.adapters.clear();
    await this.endSegment();
  }

  private async retireDir(): Promise<void> {
    // Kept, renamed: the segments are an operator's second chance for a week.
    // The temp sweep removes `*.done` directories after that.
    try {
      await rename(this.dir, `${this.dir}.done`);
    } catch (e) {
      this.log(`could not retire the work directory: ${String((e as Error).message ?? e)}`);
    }
  }

  private async announce(payload: Record<string, unknown>): Promise<void> {
    try {
      await db.insert(meetingSignal).values({
        meetingId: this.meetingId,
        fromPeer: "recorder",
        toPeer: null,
        type: "recording",
        payload,
      });
      await db.execute(sql`select pg_notify('flockinsight_meeting', ${this.meetingId})`);
    } catch (e) {
      this.log(`could not tell the room: ${String((e as Error).message ?? e)}`);
    }
  }

  private async audit(
    summary: string,
    action: string,
    severity: "notice" | "warning",
    meta: Record<string, unknown>,
  ): Promise<void> {
    try {
      await db.insert(auditLog).values({
        scope: "church",
        churchId: this.churchId,
        actorUserId: null,
        actorName: "Recording service",
        actorEmail: null,
        actorRole: "system",
        viaImpersonation: false,
        action,
        module: "meetings",
        severity,
        summary,
        targetType: "meeting",
        targetId: this.meetingId,
        targetLabel: this.meetingTitle || this.title,
        meta: { ...meta, recordingId: this.id },
      });
    } catch (e) {
      this.log(`could not write the audit row: ${String((e as Error).message ?? e)}`);
    }
  }

  /** For /health. */
  describe(): Record<string, unknown> {
    return {
      id: this.id,
      meetingId: this.meetingId,
      mode: this.mode,
      segment: this.segmentIndex,
      adapters: [...this.adapters.values()].map((a) => ({
        kind: a.kind,
        participant: a.participantId.slice(0, 8),
        adapter: a.adapterId ? "up" : `waiting (${a.lastError ?? "not asked yet"})`,
        sockets: a.sockets.size,
        heardAgoMs: a.lastPacketAt ? Date.now() - a.lastPacketAt : null,
        depthMs: a.kind === "mic" ? Math.round(this.mixer.depthMs(a.participantId)) : null,
        framesMixed: a.kind === "mic" ? this.mixer.framesMixed(a.participantId) : null,
        // The signed ingest path, for the local smoke test ONLY. It is a
        // credential; it is never shown unless this is set, and /health is
        // loopback-only in any case.
        ...(process.env.RECORDER_DEBUG_TOKENS === "1" ? { endpoint: this.endpointFor(a) } : {}),
      })),
      stage: this.stageCurrentKey,
      stats: this.stats,
      droppedWrites: this.droppedWrites,
      elapsedSec: this.clock.startedAt ? Math.round((Date.now() - this.clock.startedAt) / 1000) : 0,
    };
  }
}
