import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WebSocket } from "ws";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, media, meetingRecording, meetingSignal } from "@/db/schema";
import {
  closeWebSocketAdapters,
  createWebSocketAdapters,
  isSfuConfigured,
  SfuError,
  type AdapterRequest,
  type AdapterResult,
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
import { isRealFrame, pickFrame } from "./frames";
import {
  captureVerdict,
  deadAdapterReason,
  deadWindowMs,
  describeLink,
  emptyCounts,
  formatClock,
  mergeCounts,
  parseSavedStats,
  type AdapterLinkState,
  type CaptureCounts,
} from "./health";
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
 * recording. A stream that dies while we are up — the media server gives up
 * on an endpoint after those fifteen seconds and never says so — is noticed
 * from its own silence and asked for again (see health.ts).
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
  /** In the endpoint path. A socket or packet carrying any other is refused. */
  nonce: string;
  /**
   * The media server may hold an adapter aimed at this nonce — it granted one,
   * or a create's answer was lost — so the next create must not reuse it.
   */
  nonceInUse: boolean;
  adapterId: string | null;
  attempts: number;
  nextTryAt: number;
  /** When the media server granted `adapterId`. */
  createdAt: number;
  /** When the last socket went, while none has replaced it. */
  lostAt: number | null;
  /** When the current socket connected. */
  attachedAt: number;
  lastPacketAt: number;
  /** Since when the roster has said this microphone is on; null while muted. */
  micOnSince: number | null;
  /** Replacements in a row that delivered nothing; widens the dead window (deadWindowMs). */
  deadStreak: number;
  lastError: string | null;
  /** At most one: see attach(). */
  sockets: Set<WebSocket>;
};

type Wanted = Pick<Adapter, "key" | "kind" | "participantId" | "sessionId" | "trackName">;

export type FinishReason =
  | "stopped"
  | "meeting-ended"
  | "room-empty"
  | "resumed-after-stop"
  | "start-failed"
  | "recovered";

export type FinishOutcome =
  | { status: "ready"; mediaId: string; bytes: number; durationSec: number }
  | { status: "failed"; reason: string };

/**
 * Backoff for an adapter the media server would not give us. Short at first,
 * because the usual refusal is a track asked for a moment before it was
 * published, and every second of it is a second of somebody's voice.
 */
const RETRY_STEPS_MS = [1000, 2000, 4000, 8000, 15_000];
/** ffmpeg deaths inside a minute before the recording is given up on. */
const MAX_SEGMENT_CRASHES = 3;
/** Past this much unread on either pipe, ffmpeg is behind and a tick is dropped. */
const MAX_PIPE_BACKLOG = 8 * 1024 * 1024;

const adapterKey = (participantId: string, kind: IngestKind) => `${participantId}:${kind}`;
const errorText = (e: unknown) => String((e as Error)?.message ?? e);

/**
 * Whether a failed create may still have been carried out. A refusal with a
 * status the media server chose (4xx) or a per-track error created nothing; a
 * timeout or a 5xx might have, and an SFU that is not configured never sent
 * the request at all.
 */
function mayHaveReachedMediaServer(e: unknown): boolean {
  if (!(e instanceof SfuError)) return true;
  if (!isSfuConfigured()) return false;
  return e.status >= 500;
}

function linkState(a: Adapter): AdapterLinkState {
  return {
    kind: a.kind,
    adapterId: a.adapterId,
    sockets: a.sockets.size,
    createdAt: a.createdAt,
    lostAt: a.lostAt,
    attachedAt: a.attachedAt,
    lastPacketAt: a.lastPacketAt,
    micOnSince: a.micOnSince,
  };
}

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
  /** Told when a finish (or an early failure) has settled, so the supervisor lets go of this capture. */
  private readonly onSettled?: (rec: LiveRecording) => void;

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
  /** The still for what is on stage: a card, a slide, or a track's name card. */
  private latestJpeg: Buffer | null = null;
  /** Which frameCache entry `latestJpeg` should be, so a late render lands only where it belongs. */
  private stillKey: string | null = null;
  /** The last REAL frame from the track on stage, and when it arrived. */
  private cameraJpeg: Buffer | null = null;
  private cameraFrameAt = 0;
  private placeholder: Buffer | null = null;
  private readonly frameCache = new Map<string, Buffer>();
  private readonly framePending = new Set<string>();
  private frameSeq = 0;
  private readonly captionFile: string;
  private readonly watermarkFile: string;

  /**
   * What this recording has captured, across restarts: `stats.json` in the
   * work directory carries the counts from one process to the next.
   */
  readonly stats: CaptureCounts = emptyCounts();
  private readonly statsFile: string;
  private statsLoading: Promise<void> | null = null;
  private statsLoaded = false;
  /** Whether the counts cover every segment on disk. See parseSavedStats. */
  private countsComplete = false;
  /**
   * Set once the segment is closed and nothing more can be counted. Until
   * then a save says "incomplete": a process that dies after a heartbeat save
   * has captured up to ten seconds the file never counted, and a verdict on
   * those counts could fail a recording whose only sound was in that gap.
   */
  private captureEnded = false;
  private statsWrites = 0;
  private retired = false;

  constructor(opts: {
    row: RecordingRow;
    config: RecorderConfig;
    log: (line: string) => void;
    onSettled?: (rec: LiveRecording) => void;
  }) {
    this.id = opts.row.id;
    this.meetingId = opts.row.meetingId;
    this.churchId = opts.row.churchId;
    this.mode = opts.row.mode;
    this.title = opts.row.title;
    this.createdBy = opts.row.createdBy;
    this.config = opts.config;
    this.log = (line) => opts.log(`[${this.id.slice(0, 8)}] ${line}`);
    this.onSettled = opts.onSettled;
    this.dir = path.join(opts.config.workDir, this.id);
    this.captionFile = path.join(this.dir, "caption.txt");
    this.watermarkFile = path.join(this.dir, "watermark.txt");
    this.statsFile = path.join(this.dir, "stats.json");
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
    await this.loadStats(existing.length);

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

  /** Segments with something in them: an ffmpeg that died before its first fragment leaves a stub. */
  private async usableSegments(): Promise<string[]> {
    const out: string[] = [];
    for (const f of await this.segmentFiles()) {
      try {
        if ((await stat(f)).size > 1024) out.push(f);
      } catch (e) {
        this.log(`segment ${path.basename(f)} could not be read: ${errorText(e)}`);
      }
    }
    return out;
  }

  /** Whether there is anything on disk worth filing — for a capture that cannot carry on. */
  async hasSegments(): Promise<boolean> {
    return (await this.usableSegments()).length > 0;
  }

  /**
   * Take up the counts an earlier process saved. Once only; `earlierSegments`
   * is how many segments were already on disk before this process captured
   * anything, because with none our own counts are the whole story and with
   * some but no saved counts they are not.
   */
  private loadStats(earlierSegments: number): Promise<void> {
    this.statsLoading ??= this.readStats(earlierSegments);
    return this.statsLoading;
  }

  private async readStats(earlierSegments: number): Promise<void> {
    // `statsLoaded` is set only once the read is done: a heartbeat saving in
    // the meantime would otherwise replace the file with zeros before we read it.
    let text: string;
    try {
      text = await readFile(this.statsFile, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        this.log(`could not read the saved capture counts: ${errorText(e)}`);
      }
      this.countsComplete = earlierSegments === 0;
      this.statsLoaded = true;
      return;
    }
    const saved = parseSavedStats(text);
    if (saved) {
      Object.assign(this.stats, mergeCounts(saved.counts, this.stats));
      this.countsComplete = saved.complete;
    } else {
      this.log("the saved capture counts are unreadable; judging this recording on its file alone");
      this.countsComplete = false;
    }
    this.statsLoaded = true;
  }

  /** Written on every heartbeat and when capture stops, so a restart knows what came before it. */
  async saveStats(): Promise<void> {
    if (!this.statsLoaded || this.retired) return;
    // Written aside and renamed into place, so a crash mid-write leaves the
    // previous counts rather than half a file. A name of its own per write,
    // because a heartbeat and a finish can save at the same moment.
    this.statsWrites += 1;
    const tmp = `${this.statsFile}.${this.statsWrites}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify({ complete: this.countsComplete && this.captureEnded, counts: this.stats }));
      await rename(tmp, this.statsFile);
    } catch (e) {
      this.log(`could not save the capture counts: ${errorText(e)}`);
    }
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
        this.failNow(`The encoder kept stopping: ${why}`);
        return;
      }
      void this.openSegment().catch((e) => {
        this.log(`could not start a new segment: ${String(e)}`);
        this.failNow(`The encoder could not be restarted: ${errorText(e)}`);
      });
    });
  }

  /* ============================================================
   * The clock: exactly 48,000 samples and VIDEO_FPS frames per second
   * ========================================================== */

  private tick(): void {
    const segment = this.segment;
    if (!segment || this.stopped) return;
    const now = Date.now();
    const elapsed = now - this.clock.startedAt;

    const dueAudio = Math.floor(elapsed / FRAME_MS) - this.clock.audioFrames;
    const dueVideo = segment.video ? Math.floor(elapsed / (1000 / VIDEO_FPS)) - this.clock.videoFrames : 0;
    if (dueAudio <= 0 && dueVideo <= 0) return;

    // The mixer is pulled whatever happens below, so every voice's queue
    // stays in step with the clock even through a dropped tick.
    const pcm = dueAudio > 0 ? toPcmBytes(this.mixer.pull(dueAudio)) : null;
    if (dueAudio > 0) this.clock.audioFrames += dueAudio;
    if (dueVideo > 0) this.clock.videoFrames += dueVideo;

    /*
     * ffmpeg consumes in real time, so the pipes are normally empty. If one is
     * not — a starved box, a stalled encoder — the backlog must not pile up in
     * memory for ever. Past eight megabytes on EITHER pipe the whole tick is
     * dropped from BOTH and counted: the file loses a moment, rather than the
     * sound and the picture drifting apart for the rest of the recording, which
     * is what dropping from one pipe and not the other did.
     */
    const behind =
      segment.audio.writableLength > MAX_PIPE_BACKLOG ||
      (segment.video !== null && segment.video.writableLength > MAX_PIPE_BACKLOG);
    if (behind) {
      this.droppedWrites += 1;
      if (this.droppedWrites % 250 === 1) this.log(`encoder is behind; dropped ${this.droppedWrites} tick(s)`);
      return;
    }

    if (pcm) this.write(segment.audio, pcm);
    if (segment.video && dueVideo > 0) {
      const stage = this.stageCurrent;
      const frame = pickFrame({
        onTrack: stage?.kind === "track",
        camera: this.cameraJpeg,
        cameraAt: this.cameraFrameAt,
        still: this.latestJpeg ?? this.placeholder,
        now,
        /*
         * A shared screen's last real frame is held for as long as the share
         * is on stage. A still screen sends few frames or none (a source that
         * does not change produces nothing), so the camera rule put the
         * sharer's name card over the slides they were showing. Its end is
         * the stage changing, which clears the frame anyway.
         */
        freshMs: stage?.kind === "track" && stage.trackName === "screen" ? Infinity : undefined,
      });
      if (frame) {
        for (let i = 0; i < dueVideo; i++) this.write(segment.video, frame);
      }
    }
  }

  private write(stream: NodeJS.WritableStream, bytes: Uint8Array): void {
    try {
      stream.write(bytes);
    } catch (e) {
      this.log(`write failed: ${errorText(e)}`);
    }
  }

  /* ============================================================
   * Frames in
   * ========================================================== */

  /**
   * The adapter this target is for, only if its nonce is the current one. An
   * older adapter for the same voice — a create that timed out here but that
   * the media server carried out, or one still retrying after a restart —
   * signs a valid path, so the nonce is what tells it apart. Taking its frames
   * too would feed the same voice twice: interleaved PCM, a half-speed stutter.
   */
  private current(target: IngestTarget): Adapter | null {
    const a = this.adapters.get(adapterKey(target.participantId, target.kind));
    return a && a.nonce === target.nonce ? a : null;
  }

  expects(target: IngestTarget): boolean {
    return !this.stopped && this.current(target) !== null;
  }

  attach(target: IngestTarget, ws: WebSocket): void {
    const a = this.current(target);
    if (!a || this.stopped) {
      // Handed back, or replaced by a newer adapter, since the upgrade began.
      this.closeSocket(ws, false);
      return;
    }
    /*
     * One socket per adapter. A second on the same path is the media server
     * reconnecting while we still hold the old, half-dead one; both at once
     * would feed the same voice twice. Terminated rather than closed, so not
     * one more message is read from it.
     */
    const replacing = a.sockets.size;
    for (const old of a.sockets) this.closeSocket(old, true);
    a.sockets.clear();
    a.sockets.add(ws);
    a.attachedAt = Date.now();
    a.lostAt = null;
    if (a.kind === "mic") this.stats.micAttaches += 1;
    else this.stats.videoAttaches += 1;
    this.log(
      `${target.kind} stream connected for ${target.participantId.slice(0, 8)}` +
        (replacing ? ` (replacing ${replacing} older socket(s))` : ""),
    );
  }

  detach(target: IngestTarget, ws: WebSocket): void {
    const a = this.current(target);
    // A socket we already let go of (replaced, handed back) says nothing about the current one.
    if (!a || !a.sockets.delete(ws)) return;
    if (a.sockets.size === 0) {
      a.lostAt = Date.now();
      this.log(`${target.kind} stream for ${target.participantId.slice(0, 8)} disconnected`);
    }
  }

  packet(target: IngestTarget, packet: MediaPacket): void {
    const a = this.current(target);
    if (!a) return;
    const now = Date.now();
    a.lastPacketAt = now;
    a.deadStreak = 0; // this link delivers
    if (target.kind === "mic") {
      this.stats.audioPackets += 1;
      this.stats.audioBytes += packet.payload.length;
      this.mixer.push(target.participantId, packet.payload);
      return;
    }
    this.stats.videoPackets += 1;
    if (a.key !== this.videoAdapterKey || packet.payload.length === 0) return;
    // An OFF camera or screen sends a tiny black placeholder to keep its
    // publication alive. It is counted and never shown (see frames.ts).
    if (!isRealFrame(packet.payload)) {
      this.stats.placeholderFrames += 1;
      return;
    }
    this.stats.videoFrames += 1;
    // Copied: the socket's buffer is reused for the next message.
    this.cameraJpeg = Buffer.from(packet.payload);
    this.cameraFrameAt = now;
  }

  private closeSocket(ws: WebSocket, hard: boolean): void {
    try {
      if (hard) ws.terminate();
      else ws.close();
    } catch (e) {
      this.log(`could not close an ingest socket: ${errorText(e)}`);
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
    const people = new Map(room.people.map((p) => [p.participantId, p]));

    const wanted = new Map<string, Wanted>();

    /*
     * Every voice: anyone publishing whose microphone is on, and anyone whose
     * microphone we already have on the session they are still on. A mute is
     * a quiet track now — the client keeps sending silence — so it is kept for
     * as long as the person is here, rather than handed back after a minute and
     * asked for again on unmute, which lost the first seconds of every long
     * mute. A microphone that truly stopped is caught by the dead-adapter check
     * below, not by a timer.
     */
    for (const p of room.people) {
      if (!p.sfuSessionId) continue;
      const key = adapterKey(p.participantId, "mic");
      const have = this.adapters.get(key);
      const sameSession = !!have && have.sessionId === p.sfuSessionId;
      if (!p.micOn && !sameSession) continue;
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
      const videoKind: IngestKind | null =
        choice.kind === "track" ? (choice.trackName === "screen" ? "screen" : "cam") : null;
      const videoKey = choice.kind === "track" && videoKind ? adapterKey(choice.participantId, videoKind) : null;
      if (videoKey !== this.videoAdapterKey) {
        // Before anything is awaited: a frame from the previous track landing
        // while the caption is rewritten must not be shown under the new name.
        this.videoAdapterKey = videoKey;
        this.cameraJpeg = null;
        this.cameraFrameAt = 0;
      }
      await this.showStage(choice);
      if (choice.kind === "track" && videoKey && videoKind) {
        wanted.set(videoKey, {
          key: videoKey,
          kind: videoKind,
          participantId: choice.participantId,
          sessionId: choice.sessionId,
          trackName: choice.trackName,
        });
      }
      if (this.stopped) return;
    }

    /*
     * Hand back what is no longer wanted, or belongs to a session that has been
     * replaced — a publisher rebuilt on a new session mid-meeting. A voice whose
     * session changed keeps its place in the mix: its replacement below reuses
     * the mixer source. That is why the source is removed here, only for a
     * voice nobody wants, and not when the old adapter is closed — which now
     * happens after the replacement exists, and would otherwise take the new
     * adapter's source with it.
     */
    const toClose: Adapter[] = [];
    for (const [key, a] of this.adapters) {
      const want = wanted.get(key);
      if (want && want.sessionId === a.sessionId) continue;
      toClose.push(a);
      this.adapters.delete(key);
      if (a.kind === "mic" && !want) this.mixer.removeSource(a.participantId);
    }

    // Everything wanted gets an entry; a new one has no adapter yet.
    for (const [key, want] of wanted) {
      if (this.adapters.has(key)) continue;
      this.adapters.set(key, {
        ...want,
        nonce: newNonce(),
        nonceInUse: false,
        adapterId: null,
        attempts: 0,
        nextTryAt: 0,
        createdAt: 0,
        lostAt: null,
        attachedAt: 0,
        lastPacketAt: 0,
        micOnSince: null,
        deadStreak: 0,
        lastError: null,
        sockets: new Set(),
      });
      if (want.kind === "mic") this.mixer.addSource(want.participantId);
    }

    // A dead adapter is asked for again in this same pass.
    for (const a of this.adapters.values()) {
      if (a.kind === "mic") {
        a.micOnSince = people.get(a.participantId)?.micOn ? (a.micOnSince ?? now) : null;
      }
      const why = deadAdapterReason(linkState(a), now, deadWindowMs(a.deadStreak));
      if (why) this.replaceDead(a, why, now);
    }

    /*
     * Ask for what is missing — and only then let go of what it replaces, without
     * waiting on it. Closing first put a network round trip between a voice's
     * old session going and its new one arriving. A socket still attached with
     * no adapter id is a create whose answer we lost but the media server
     * carried out: the voice is flowing, so it is not asked for twice.
     */
    const toCreate = [...this.adapters.values()].filter(
      (a) => a.adapterId === null && a.sockets.size === 0 && now >= a.nextTryAt,
    );
    await this.createAdapters(toCreate);
    // closeAdapters logs its own failures; nothing is left to handle here.
    void this.closeAdapters(toClose);
  }

  /** Give up on an adapter that is not delivering, and set it up to be asked for afresh. */
  private replaceDead(a: Adapter, why: string, now: number): void {
    this.stats.adapterResets += 1;
    a.deadStreak += 1;
    const ago = (t: number) => (t ? `${Math.round((now - t) / 1000)}s ago` : "never");
    this.log(
      `${a.kind} adapter ${a.adapterId?.slice(0, 8) ?? "(no id)"} for ${a.participantId.slice(0, 8)} is dead: ${why} ` +
        `[sockets ${a.sockets.size}, granted ${ago(a.createdAt)}, connected ${ago(a.attachedAt)}, ` +
        `lost ${a.lostAt ? ago(a.lostAt) : "no"}, last packet ${ago(a.lastPacketAt)}]; asking again ` +
        `(dead streak ${a.deadStreak}, next judged after ${deadWindowMs(a.deadStreak) / 1000}s)`,
    );
    for (const ws of a.sockets) this.closeSocket(ws, true);
    a.sockets.clear();
    const old = a.adapterId;
    if (old) {
      // Not awaited: the replacement must not wait on the media server
      // confirming the old one is gone.
      closeWebSocketAdapters([old]).catch((e) =>
        this.log(`could not close dead adapter ${old.slice(0, 8)}: ${errorText(e)}`),
      );
    }
    a.adapterId = null;
    a.nonce = newNonce();
    a.nonceInUse = false;
    a.attempts = 0;
    a.nextTryAt = 0;
    a.createdAt = 0;
    a.lostAt = null;
    a.attachedAt = 0;
    a.lastError = null;
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
    // Microphones first, and never in one request with a picture: a refusal or
    // a slow answer about a camera must not hold up, or back off, a voice.
    const mics = list.filter((a) => a.kind === "mic");
    const pictures = list.filter((a) => a.kind !== "mic");
    for (const group of [mics, pictures]) {
      for (let i = 0; i < group.length; i += 4) {
        if (this.stopped) return;
        await this.createBatch(group.slice(i, i + 4));
      }
    }
  }

  private async createBatch(batch: Adapter[]): Promise<void> {
    // A nonce the media server may already be using is never offered again,
    // so a duplicate adapter can only ever connect with a path we refuse.
    for (const a of batch) {
      if (a.nonceInUse) a.nonce = newNonce();
      a.nonceInUse = false;
      if (a.kind === "mic") this.stats.micRequested += 1;
    }
    const byEndpoint = new Map(batch.map((a) => [this.endpointFor(a), a]));
    const request: AdapterRequest[] = [...byEndpoint].map(([endpoint, a]) => ({
      location: "remote",
      sessionId: a.sessionId,
      trackName: a.trackName,
      endpoint,
      outputCodec: a.kind === "mic" ? "pcm" : "jpeg",
    }));

    let results: AdapterResult[];
    try {
      results = (await createWebSocketAdapters(request)).tracks;
    } catch (e) {
      const why = errorText(e);
      const unknown = mayHaveReachedMediaServer(e);
      for (const a of batch) {
        a.nonceInUse = unknown;
        this.refused(a, why);
      }
      return;
    }

    /*
     * Matched by endpoint, which carries the nonce and so names exactly one
     * adapter; by session and track if the answer leaves the endpoint out; by
     * position only if it carries neither.
     */
    const answered = new Set<Adapter>();
    results.forEach((r, n) => {
      const a =
        (r.endpoint ? byEndpoint.get(r.endpoint) : undefined) ??
        batch.find((x) => !answered.has(x) && !!r.sessionId && x.sessionId === r.sessionId && x.trackName === r.trackName) ??
        (!r.endpoint && !r.sessionId ? batch[n] : undefined);
      if (!a || answered.has(a)) {
        this.log(`the media server answered for a track we did not ask for (${r.trackName ?? "?"}); ignored`);
        if (r.adapterId) this.closeOrphan(r.adapterId);
        return;
      }
      answered.add(a);
      if (!r.adapterId) {
        a.nonceInUse = false; // a per-track refusal created nothing
        this.refused(a, r.errorDescription ?? r.errorCode ?? "no adapter id in the answer");
        return;
      }
      if (this.stopped || this.adapters.get(a.key) !== a) {
        // Handed back while we waited for the answer.
        this.closeOrphan(r.adapterId);
        return;
      }
      a.adapterId = r.adapterId;
      a.nonceInUse = true;
      a.createdAt = Date.now();
      a.attempts = 0;
      a.lastError = null;
      if (a.kind === "mic") this.stats.micGranted += 1;
      else this.stats.videoGranted += 1;
      this.log(`${a.kind} adapter ${r.adapterId.slice(0, 8)} for ${a.participantId.slice(0, 8)}`);
    });
    for (const a of batch) {
      if (answered.has(a)) continue;
      a.nonceInUse = true; // no word either way: it may exist
      this.refused(a, "no answer for this track");
    }
  }

  private closeOrphan(adapterId: string): void {
    closeWebSocketAdapters([adapterId]).catch((e) =>
      this.log(`could not close unwanted adapter ${adapterId.slice(0, 8)}: ${errorText(e)}`),
    );
  }

  private refused(a: Adapter, why: string): void {
    if (a.kind === "mic") this.stats.lastRefusal = why.slice(0, 200);
    this.backOff(a, why);
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
      for (const ws of a.sockets) this.closeSocket(ws, false);
      a.sockets.clear();
    }
    const ids = list.map((a) => a.adapterId).filter((x): x is string => !!x);
    for (let i = 0; i < ids.length; i += 4) {
      try {
        await closeWebSocketAdapters(ids.slice(i, i + 4));
      } catch (e) {
        // Best effort: the media server closes an adapter whose endpoint has
        // gone within fifteen seconds anyway.
        this.log(`could not close ${ids.slice(i, i + 4).length} adapter(s): ${errorText(e)}`);
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

    // The picture is decided before the caption is awaited, so no tick in
    // between can pair the new caption with the old picture.
    if (choice.kind === "track") {
      /*
       * Never the previous picture under a new name. Until a real frame of
       * this track arrives (and whenever none has for a few seconds — see
       * tick), the person's name card is shown instead.
       */
      this.cameraJpeg = null;
      this.cameraFrameAt = 0;
      const name = choice.name;
      this.showStill(
        `name:${choice.participantId}:${name}`,
        (file) => renderCard({ title: name, body: this.churchName, footnote: "" }, file, this.config.fonts),
        true,
      );
    } else if (choice.kind === "empty") {
      this.stillKey = null;
      this.latestJpeg = this.placeholder;
    } else if (choice.kind === "card") {
      const spec = { title: choice.title, body: choice.body, footnote: choice.footnote };
      this.showStill(key, (file) => renderCard(spec, file, this.config.fonts), false);
    } else {
      const url = choice.url;
      this.showStill(key, (file) => renderSlide(url, file), false);
    }

    try {
      await writeFile(this.captionFile, stageCaption(choice));
    } catch (e) {
      this.log(`caption write failed: ${errorText(e)}`);
    }
  }

  /**
   * Show a rendered still — from the cache, or once it has been rendered. A
   * verse or slide keeps the previous still on screen while it renders; a name
   * card does not (`blankWhileRendering`), because the previous one may be
   * somebody else's name.
   */
  private showStill(key: string, render: (file: string) => Promise<void>, blankWhileRendering: boolean): void {
    this.stillKey = key;
    const cached = this.frameCache.get(key);
    if (cached) {
      this.latestJpeg = cached;
      return;
    }
    if (blankWhileRendering) this.latestJpeg = this.placeholder;
    if (this.framePending.has(key)) return;
    this.framePending.add(key);
    // A counter, not the cache's size: two renders in flight must not share a file.
    this.frameSeq += 1;
    const file = path.join(this.dir, `frame-${this.frameSeq}.jpg`);
    void render(file)
      .then(() => readJpeg(file))
      .then((jpeg) => {
        this.frameCache.set(key, jpeg);
        if (this.stillKey === key) this.latestJpeg = jpeg;
      })
      .catch((e) => {
        this.log(`could not render ${key.slice(0, 40)}: ${errorText(e)}`);
        if (this.stillKey === key) this.latestJpeg = this.placeholder;
      })
      .finally(() => this.framePending.delete(key));
  }

  /* ============================================================
   * Finishing
   * ========================================================== */

  /**
   * Stop capturing. Idempotent; the first caller's reason wins. `note` is said
   * beside the filed recording — why it is shorter than the meeting, say.
   */
  finish(reason: FinishReason, note?: string): Promise<FinishOutcome> {
    this.finishing ??= this.settle(this.finishOnce(reason, note ?? null));
    return this.finishing;
  }

  private settle(p: Promise<FinishOutcome>): Promise<FinishOutcome> {
    return p.finally(() => this.onSettled?.(this));
  }

  /**
   * The process is going down. Called synchronously before anything is
   * awaited: from here an ffmpeg exit is expected rather than a crash to answer
   * with a fresh segment, and nothing more is written or accepted.
   */
  markStopping(): void {
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** Put the capture down: segment ended alongside the adapters, never a round trip after. */
  private async putDown(): Promise<void> {
    this.markStopping();
    const adapters = [...this.adapters.values()];
    this.adapters.clear();
    // In parallel, not in turn: the file should end when the recording did,
    // not after the media server has confirmed every adapter closed.
    await Promise.all([this.endSegment(), this.closeAdapters(adapters)]);
    this.captureEnded = true;
    await this.saveStats();
  }

  /** Stop was pressed, or something like it: tell the room "being saved". Best effort. */
  private async markProcessing(): Promise<void> {
    try {
      await db
        .update(meetingRecording)
        .set({ status: "processing", stoppedAt: sql`coalesce(${meetingRecording.stoppedAt}, now())`, lastActivityAt: new Date(), recorderHeartbeatAt: new Date() })
        .where(and(eq(meetingRecording.id, this.id), eq(meetingRecording.status, "recording")));
    } catch (e) {
      // The capture is put down regardless. Adapters left streaming and an
      // ffmpeg left running for want of one row update are worse than a row
      // that says "recording" a little longer.
      this.log(`could not mark the row as being saved: ${errorText(e)}`);
    }
  }

  private async finishOnce(reason: FinishReason, note: string | null): Promise<FinishOutcome> {
    this.log(`finishing (${reason})`);
    this.markStopping();
    await this.markProcessing();
    await this.putDown();

    try {
      const outcome = await this.assembleAndFile(note ? () => note : undefined);
      this.log(`ready: ${outcome.bytes} bytes, ${outcome.durationSec}s`);
      await this.retireDir();
      return outcome;
    } catch (e) {
      // Room for the media server's own words in an empty-capture verdict.
      const reason = errorText(e).slice(0, 500);
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

  /**
   * Join the segments and file them. Throws — and files nothing — when there
   * is nothing to file. `extraNote` is given the file's length and says why
   * the recording is what it is, beside it in the row.
   */
  private async assembleAndFile(
    extraNote?: (durationSec: number) => string,
  ): Promise<FinishOutcome & { status: "ready" }> {
    // A finish with no capture of its own (resumed after a stop, recovered)
    // takes up what the earlier processes counted; every segment is theirs.
    const allSegments = await this.segmentFiles();
    await this.loadStats(allSegments.length);

    /*
     * The encode is fed silence and the held picture on the wall clock whatever
     * arrives, so a recording that heard nobody is still a file of the right
     * length. Only the counts can tell — and only when they cover the whole
     * recording; without that, the file is judged on its own as before.
     */
    const verdict = this.countsComplete ? captureVerdict(this.stats) : null;
    if (verdict?.kind === "fail") {
      this.log(`not filing: ${verdict.reason} [${JSON.stringify(this.stats)}]`);
      throw new Error(verdict.reason);
    }

    const segments = await this.usableSegments();
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

    // Filed, but with a line beside it saying what is (or is not) in it.
    const notes = [verdict?.kind === "note" ? verdict.note : null, extraNote?.(durationSec) ?? null].filter(
      (n): n is string => !!n,
    );
    const note = notes.length > 0 ? notes.join(" ").slice(0, 500) : null;

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
          error: note,
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
      { mode: this.mode, bytes: size, durationSec, mediaId: row.id, source: "server", note, counts: this.stats },
    );
    return { status: "ready", mediaId: row.id, bytes: size, durationSec };
  }

  private async markFailed(reason: string): Promise<void> {
    try {
      await db
        .update(meetingRecording)
        .set({ status: "failed", error: reason, lastActivityAt: new Date(), recorderHeartbeatAt: new Date() })
        // "failed" too: a row the stalled sweep marked, that we then could not
        // recover, gets our reason in place of the sweep's guess — which also
        // stops the next start-up trying it again.
        .where(and(eq(meetingRecording.id, this.id), inArray(meetingRecording.status, ["recording", "processing", "failed"])));
      await this.announce({ state: "failed", recordingId: this.id, reason });
      await this.audit(
        `A ${this.mode} recording of "${this.meetingTitle || this.title}" did not save — ${reason}`,
        "meetings.recording.failed",
        "warning",
        { mode: this.mode, reason, source: "server", counts: this.stats },
      );
    } catch (e) {
      this.log(`could not record the failure: ${errorText(e)}`);
    }
  }

  /** Something went badly wrong mid-capture: stop, keep what exists, say why. */
  private failNow(reason: string): void {
    if (this.finishing) return;
    this.finishing = this.settle(this.failOnce(reason));
  }

  private async failOnce(reason: string): Promise<FinishOutcome> {
    this.log(`stopping early: ${reason}`);
    this.markStopping();
    await this.markProcessing();
    await this.putDown();
    /*
     * Everything up to the failure is on disk and playable, so it is filed as
     * a partial recording with the reason beside it. Only a recording with
     * nothing in it is marked failed — marking the whole service failed threw
     * away an hour of sermon for an encoder that died in the last minute.
     */
    try {
      const outcome = await this.assembleAndFile((d) => `Stopped early at ${formatClock(d)}: ${reason}`);
      this.log(`filed what was captured before that: ${outcome.bytes} bytes, ${outcome.durationSec}s`);
      await this.retireDir();
      return outcome;
    } catch (e) {
      const why = errorText(e);
      this.log(`nothing could be filed: ${why}`);
      const full = `${reason} Nothing could be saved: ${why}`.slice(0, 500);
      await this.markFailed(full);
      return { status: "failed", reason: full };
    }
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
    await this.putDown();
  }

  private async retireDir(): Promise<void> {
    // Kept, renamed: the segments are an operator's second chance for a week.
    // The temp sweep removes `*.done` directories after that.
    try {
      await rename(this.dir, `${this.dir}.done`);
      this.retired = true;
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
    const now = Date.now();
    return {
      id: this.id,
      meetingId: this.meetingId,
      mode: this.mode,
      segment: this.segmentIndex,
      adapters: [...this.adapters.values()].map((a) => ({
        kind: a.kind,
        participant: a.participantId.slice(0, 8),
        // Granted is not the same as delivering: "link" says whether the
        // media server's stream is actually connected to us.
        adapter: a.adapterId
          ? "up"
          : a.sockets.size > 0
            ? "streaming (its id was never answered)"
            : `waiting (${a.lastError ?? "not asked yet"})`,
        link: describeLink(linkState(a), now),
        deadStreak: a.deadStreak,
        sockets: a.sockets.size,
        heardAgoMs: a.lastPacketAt ? now - a.lastPacketAt : null,
        depthMs: a.kind === "mic" ? Math.round(this.mixer.depthMs(a.participantId)) : null,
        framesMixed: a.kind === "mic" ? this.mixer.framesMixed(a.participantId) : null,
        // The signed ingest path, for the local smoke test ONLY. It is a
        // credential; it is never shown unless this is set, and /health is
        // loopback-only in any case.
        ...(process.env.RECORDER_DEBUG_TOKENS === "1" ? { endpoint: this.endpointFor(a) } : {}),
      })),
      stage: this.stageCurrentKey,
      cameraFrameAgoMs: this.cameraFrameAt ? now - this.cameraFrameAt : null,
      stats: this.stats,
      countsComplete: this.countsComplete,
      droppedWrites: this.droppedWrites,
      elapsedSec: this.clock.startedAt ? Math.round((now - this.clock.startedAt) / 1000) : 0,
    };
  }
}
