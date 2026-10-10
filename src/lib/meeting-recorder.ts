/**
 * Recording, done entirely in the host's browser.
 *
 * A canvas is painted with whatever the meeting currently looks like — the
 * shared stage, the screen being shared, the faces — and the audio of everyone
 * in the room is mixed with the Web Audio API. `canvas.captureStream()` and
 * that mix go into a MediaRecorder, and the result is a single file.
 *
 * Nothing is uploaded while the meeting runs. That is the point: a church on a
 * connection that can barely carry the meeting itself cannot also be streaming
 * a recording of it to us. The file exists on the host's own machine the
 * moment they press stop, and saving it to the media library afterwards is a
 * separate, optional, retryable step.
 *
 * Browser only.
 */

import { formatDuration, initialsOf, type Stage } from "@/lib/meetings-shared";
import { closeAudioContext, playMedia } from "@/lib/media-errors";

export type RecorderMode = "video" | "audio";

export type RecorderPerson = {
  id: string;
  name: string;
  stream: MediaStream | null;
  muted: boolean;
  speaking: boolean;
};

export type RecorderFrame = {
  stage: Stage;
  /** A screen share, if one is running — it takes the main area. */
  screen: MediaStream | null;
  people: RecorderPerson[];
};

export type RecorderOptions = {
  mode: RecorderMode;
  /** Painted into the corner of every frame. */
  churchName: string;
  meetingTitle: string;
  /** Read once per frame — the room hands over its current shape. */
  getFrame: () => RecorderFrame;
  /** Every audio source to mix. Re-read whenever the room changes. */
  getAudioStreams: () => MediaStream[];
  onError?: (message: string) => void;
};

export type RecordingResult = {
  blob: Blob;
  mime: string;
  durationSec: number;
  bytes: number;
  /** A filename a person would recognise in their downloads folder. */
  filename: string;
};

/* ============================================================
 * Format
 * ========================================================== */

/**
 * Pick a container the browser can actually write.
 *
 * Chrome and Firefox do WebM; Safari does MP4 and nothing else, which is why
 * this is a list and not a constant. If none of them are supported the
 * recorder refuses up front rather than producing a zero-byte file an hour
 * later.
 */
function pickMime(mode: RecorderMode): string | null {
  const candidates =
    mode === "audio"
      ? ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
      : [
          "video/webm;codecs=vp8,opus",
          "video/webm;codecs=vp9,opus",
          "video/webm",
          "video/mp4;codecs=h264,aac",
          "video/mp4",
        ];
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

export function recordingSupported(mode: RecorderMode = "video"): boolean {
  if (typeof MediaRecorder === "undefined") return false;
  if (mode === "video" && typeof HTMLCanvasElement === "undefined") return false;
  return pickMime(mode) !== null;
}

/* ============================================================
 * Canvas painting
 * ========================================================== */

const CANVAS = { width: 1280, height: 720 };
const FPS = 12;
const BG = "#0a0f1c";
const PANEL = "#151c2e";
const TEXT = "#f8fafc";
const DIM = "#94a3b8";
const ACCENT = "#6366f1";

export class MeetingRecorder {
  private readonly opts: RecorderOptions;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private paintTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private mime = "";

  private audioCtx: AudioContext | null = null;
  private mixDest: MediaStreamAudioDestinationNode | null = null;
  /**
   * What is in the mix, and the CLONES it is fed from.
   *
   * The clone is the whole point, and it is the fix for a recording that
   * silenced the host's own microphone for the rest of the meeting. The
   * streams handed to this class include the live local microphone — the very
   * track attached to the sender that the rest of the room hears — and
   * connecting that track to a WebAudio graph puts a second consumer on a
   * capture device that is already being processed for echo cancellation.
   * Chrome's behaviour when that happens is not something to rely on, and what
   * it did here was stop sending it: the host went on talking and nobody heard
   * a word, through leaving and rejoining, because the page was never
   * reloaded and the graph was still holding the device.
   *
   * So the recorder never touches a track it did not create. It clones what it
   * is given, mixes the clones, and stops the clones when it is done — and the
   * original goes on reaching the meeting, untouched, whatever WebAudio makes
   * of the copy.
   */
  private wired = new Map<
    string,
    { node: MediaStreamAudioSourceNode; clone: MediaStream }
  >();

  /**
   * The last laid-out passage, so a verse is wrapped once rather than per frame.
   */
  private laidOut: { key: string; size: number; lines: string[] } | null = null;

  /** Hidden <video> elements, one per stream we need to paint. */
  private videos = new Map<string, HTMLVideoElement>();
  private images = new Map<string, HTMLImageElement>();

  constructor(opts: RecorderOptions) {
    this.opts = opts;
  }

  get running(): boolean {
    return this.recorder?.state === "recording";
  }

  get elapsedSec(): number {
    return this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0;
  }

  /* ---------------------------------------------------------- start */

  async start(): Promise<boolean> {
    if (this.recorder) return false;

    const mime = pickMime(this.opts.mode);
    if (!mime) {
      this.opts.onError?.(
        "This browser can't record. Chrome or Firefox on a laptop works best.",
      );
      return false;
    }
    this.mime = mime;

    const tracks: MediaStreamTrack[] = [];

    // ---- audio: everyone in the room, mixed into one track
    try {
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtor) throw new Error("no AudioContext");
      this.audioCtx = new AudioCtor();
      /*
       * A context can be created suspended — a tab that was in the background,
       * Safari before a gesture — and a suspended context produces nothing.
       * The recording then runs for an hour and contains uninterrupted
       * silence, with no error anywhere. Asked to resume, and said out loud if
       * it will not.
       */
      if (this.audioCtx.state === "suspended") {
        void this.audioCtx.resume().catch((e: unknown) => {
          console.error("[recorder] the audio mix would not start", e);
          this.opts.onError?.(
            "The recording could not start its audio. Tap the page and try again.",
          );
        });
      }
      this.mixDest = this.audioCtx.createMediaStreamDestination();
      this.syncAudio();
      tracks.push(...this.mixDest.stream.getAudioTracks());
    } catch {
      this.opts.onError?.("We couldn't set up the audio mix for the recording.");
      return false;
    }

    // ---- video: the composited stage
    if (this.opts.mode === "video") {
      this.canvas = document.createElement("canvas");
      this.canvas.width = CANVAS.width;
      this.canvas.height = CANVAS.height;
      this.ctx = this.canvas.getContext("2d", { alpha: false });
      if (!this.ctx) {
        this.opts.onError?.("We couldn't set up the recording canvas.");
        return false;
      }
      this.paint();
      this.paintTimer = setInterval(() => this.paint(), Math.round(1000 / FPS));
      tracks.push(...this.canvas.captureStream(FPS).getVideoTracks());
    } else {
      /*
       * An audio-only recording has no paint loop, and `syncAudio` used to be
       * called only from there — so the mix was whatever the room happened to
       * be at the instant Record was pressed. Anybody who joined afterwards
       * was missing from the whole file, and a host who was muted at that
       * moment was missing from their own recording. Cheap: a map comparison,
       * twice a second.
       */
      this.paintTimer = setInterval(() => this.syncAudio(), 500);
    }

    try {
      this.recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType: mime,
        // A meeting is faces and speech, not a film. These are chosen so an
        // hour of video lands near 500 MB and an hour of audio near 30 MB.
        videoBitsPerSecond: 700_000,
        audioBitsPerSecond: 64_000,
      });
    } catch {
      this.opts.onError?.("This browser refused to start the recording.");
      this.cleanup();
      return false;
    }

    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onerror = () => {
      this.opts.onError?.("The recording stopped unexpectedly.");
    };

    // A timeslice means the chunks exist as the meeting goes, so a crash costs
    // the last few seconds rather than the whole hour.
    this.recorder.start(5000);
    this.startedAt = Date.now();
    return true;
  }

  /* ----------------------------------------------------------- stop */

  async stop(): Promise<RecordingResult | null> {
    const rec = this.recorder;
    if (!rec) return null;

    const durationSec = this.elapsedSec;
    const finished = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      // Never hang the UI on a recorder that will not fire onstop.
      setTimeout(resolve, 4000);
    });

    try {
      if (rec.state !== "inactive") rec.stop();
    } catch {
      /* already stopped */
    }
    await finished;

    const blob = new Blob(this.chunks, { type: this.mime });
    this.cleanup();

    if (blob.size === 0) {
      this.opts.onError?.("The recording came out empty, so there's nothing to save.");
      return null;
    }

    const ext = this.mime.includes("mp4") ? "mp4" : this.mime.startsWith("audio") ? "webm" : "webm";
    const safeTitle =
      this.opts.meetingTitle.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) ||
      "meeting";
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

    return {
      blob,
      mime: this.mime,
      durationSec,
      bytes: blob.size,
      filename: `${safeTitle}-${stamp}.${ext}`,
    };
  }

  private cleanup(): void {
    if (this.paintTimer) clearInterval(this.paintTimer);
    this.paintTimer = null;
    this.recorder = null;
    for (const [, v] of this.videos) {
      v.srcObject = null;
      v.remove();
    }
    this.videos.clear();
    this.images.clear();
    for (const [id, entry] of [...this.wired]) this.unwire(id, entry);
    this.wired.clear();
    closeAudioContext(this.audioCtx, "meeting recorder");
    this.audioCtx = null;
    this.mixDest = null;
    this.canvas = null;
    this.ctx = null;
    this.laidOut = null;
  }

  /* ---------------------------------------------------------- audio */

  /**
   * Keep the mix in step with who is in the room.
   *
   * Called on every painted frame, which sounds wasteful and is not: it is a
   * map comparison, and it means somebody joining twenty minutes into a
   * recording is simply in it, with nothing to remember to call.
   */
  private syncAudio(): void {
    if (!this.audioCtx || !this.mixDest) return;
    const streams = this.opts.getAudioStreams();
    const seen = new Set<string>();

    for (const stream of streams) {
      const live = stream.getAudioTracks().filter((t) => t.readyState === "live");
      if (live.length === 0) continue;
      seen.add(stream.id);
      if (this.wired.has(stream.id)) continue;
      let clone: MediaStream | null = null;
      try {
        // A copy, never the original. See the note on `wired`.
        clone = new MediaStream(live.map((t) => t.clone()));
        const src = this.audioCtx.createMediaStreamSource(clone);
        src.connect(this.mixDest);
        this.wired.set(stream.id, { node: src, clone });
      } catch (e) {
        // A track that ended between the filter above and the clone. Stop
        // whatever was cloned so a failed attempt cannot leak a capture.
        clone?.getTracks().forEach((t) => t.stop());
        console.info("[recorder] a voice could not be added to the mix", e);
      }
    }

    for (const [id, entry] of this.wired) {
      if (seen.has(id)) continue;
      this.unwire(id, entry);
    }
  }

  /** Take one source out of the mix and release the copy it was reading. */
  private unwire(
    id: string,
    entry: { node: MediaStreamAudioSourceNode; clone: MediaStream },
  ): void {
    try {
      entry.node.disconnect();
    } catch (e) {
      console.info("[recorder] a mix source would not disconnect", e);
    }
    // The clones are ours, so stopping them is both safe and necessary: a
    // clone left running holds the device open as surely as the original.
    for (const t of entry.clone.getTracks()) t.stop();
    this.wired.delete(id);
  }

  /* -------------------------------------------------------- painting */

  private videoFor(stream: MediaStream): HTMLVideoElement | null {
    if (stream.getVideoTracks().length === 0) return null;
    const existing = this.videos.get(stream.id);
    if (existing) return existing;

    const el = document.createElement("video");
    el.srcObject = stream;
    el.muted = true;
    el.autoplay = true;
    el.playsInline = true;
    // Off-screen rather than display:none — a hidden video is allowed to stop
    // decoding, and then every frame we paint from it is the same frame.
    el.style.cssText = "position:fixed;left:-10000px;top:0;width:2px;height:2px;";
    document.body.appendChild(el);
    playMedia(el, "recorder off-screen source");
    this.videos.set(stream.id, el);
    return el;
  }

  /**
   * Let go of the off-screen players for streams that are no longer painted.
   *
   * Each one is a real, decoding `<video>` in the document, and they were only
   * ever removed when the recording stopped. The room hands over a NEW
   * MediaStream object whenever a person's set of tracks changes — a camera
   * swapped, a screen share starting, a connection rebuilt — and the id is
   * what these are keyed on, so an hour of a busy meeting left an hour's worth
   * of decoders attached to the page. On a laptop that is a recording that
   * gets slower and slower; on a phone it is the tab going down.
   */
  private reapVideos(frame: RecorderFrame): void {
    if (this.videos.size === 0) return;
    const painted = new Set<string>();
    if (frame.screen) painted.add(frame.screen.id);
    for (const p of frame.people) if (p.stream) painted.add(p.stream.id);

    for (const [id, el] of [...this.videos]) {
      if (painted.has(id)) continue;
      el.srcObject = null;
      el.remove();
      this.videos.delete(id);
    }
  }

  private imageFor(url: string): HTMLImageElement | null {
    const existing = this.images.get(url);
    if (existing) return existing.complete && existing.naturalWidth > 0 ? existing : null;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    this.images.set(url, img);
    return null;
  }

  private paint(): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;

    this.syncAudio();
    const frame = this.opts.getFrame();
    this.reapVideos(frame);
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    const hasMain =
      !!frame.screen || (frame.stage && frame.stage.kind !== "none");

    if (hasMain) {
      const stripH = Math.round(H * 0.2);
      this.paintMain(ctx, frame, 0, 0, W, H - stripH);
      this.paintStrip(ctx, frame.people, 0, H - stripH, W, stripH);
    } else {
      this.paintGrid(ctx, frame.people, 0, 0, W, H);
    }

    this.paintChrome(ctx, W, H);
  }

  /** The big area: a screen share, a slide, a verse, or a note. */
  private paintMain(
    ctx: CanvasRenderingContext2D,
    frame: RecorderFrame,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    ctx.fillStyle = PANEL;
    ctx.fillRect(x, y, w, h);

    if (frame.screen) {
      const el = this.videoFor(frame.screen);
      if (el && el.videoWidth > 0) {
        this.drawContain(ctx, el, el.videoWidth, el.videoHeight, x, y, w, h);
        return;
      }
    }

    const stage = frame.stage;
    if (stage.kind === "slide") {
      const url = stage.urls[stage.index];
      const img = url ? this.imageFor(url) : null;
      if (img) {
        this.drawContain(ctx, img, img.naturalWidth, img.naturalHeight, x, y, w, h);
        return;
      }
      this.centeredText(ctx, "Loading slide…", x, y, w, h, 28, DIM);
      return;
    }

    if (stage.kind === "verse") {
      this.paintVerse(ctx, stage.reference, stage.body, stage.translation, x, y, w, h);
      return;
    }

    if (stage.kind === "text") {
      this.paintVerse(ctx, stage.title ?? "", stage.body, "", x, y, w, h);
      return;
    }
  }

  private paintVerse(
    ctx: CanvasRenderingContext2D,
    heading: string,
    body: string,
    footnote: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const pad = Math.round(w * 0.07);
    let cursor = y + pad + 20;

    if (heading) {
      ctx.fillStyle = ACCENT;
      ctx.font = "700 34px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(heading, x + pad, cursor);
      cursor += 52;
    }

    /*
     * Shrink the body until it fits, rather than clipping it — but work it out
     * ONCE per passage, not once per frame.
     *
     * This loop tries up to eight sizes, and each try re-wraps the whole
     * passage, which is a `measureText` per word. On a long reading that is
     * several thousand text measurements, and it ran twelve times a second for
     * the length of the recording, on the main thread, beside everything else
     * a meeting is doing. A verse stays on screen for minutes; the layout
     * cannot change between frames unless the passage or the box does.
     */
    const maxWidth = w - pad * 2;
    const maxHeight = h - (cursor - y) - pad - 30;
    const key = `${body.length}:${body.slice(0, 64)}:${Math.round(maxWidth)}:${Math.round(maxHeight)}`;
    let laid = this.laidOut;
    if (!laid || laid.key !== key) {
      let size = 40;
      let lines: string[] = [];
      while (size >= 18) {
        ctx.font = `500 ${size}px Georgia, 'Times New Roman', serif`;
        lines = wrap(ctx, body, maxWidth);
        if (lines.length * (size * 1.4) <= maxHeight) break;
        size -= 3;
      }
      laid = { key, size, lines };
      this.laidOut = laid;
    }
    const { size, lines } = laid;

    ctx.fillStyle = TEXT;
    ctx.font = `500 ${size}px Georgia, 'Times New Roman', serif`;
    for (const line of lines.slice(0, Math.floor(maxHeight / (size * 1.4)))) {
      ctx.fillText(line, x + pad, cursor);
      cursor += size * 1.4;
    }

    if (footnote) {
      ctx.fillStyle = DIM;
      ctx.font = "600 20px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText(footnote.toUpperCase(), x + pad, y + h - pad + 10);
    }
  }

  private paintGrid(
    ctx: CanvasRenderingContext2D,
    people: RecorderPerson[],
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const n = Math.max(1, people.length);
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const cw = w / cols;
    const ch = h / rows;

    people.forEach((p, i) => {
      const cx = x + (i % cols) * cw;
      const cy = y + Math.floor(i / cols) * ch;
      this.paintTile(ctx, p, cx + 6, cy + 6, cw - 12, ch - 12);
    });
  }

  private paintStrip(
    ctx: CanvasRenderingContext2D,
    people: RecorderPerson[],
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const shown = people.slice(0, 6);
    if (shown.length === 0) return;
    const tw = Math.min(w / shown.length, h * (16 / 9));
    shown.forEach((p, i) => {
      this.paintTile(ctx, p, x + i * tw + 5, y + 5, tw - 10, h - 10);
    });
  }

  private paintTile(
    ctx: CanvasRenderingContext2D,
    person: RecorderPerson,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (w < 12 || h < 12) return;

    ctx.save();
    roundRect(ctx, x, y, w, h, 12);
    ctx.clip();
    ctx.fillStyle = PANEL;
    ctx.fillRect(x, y, w, h);

    const el = person.stream ? this.videoFor(person.stream) : null;
    if (el && el.videoWidth > 0) {
      this.drawCover(ctx, el, el.videoWidth, el.videoHeight, x, y, w, h);
    } else {
      // No camera: the initials, the same as the room shows.
      const r = Math.min(w, h) * 0.22;
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2 - h * 0.05, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = TEXT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.round(r * 0.8)}px system-ui, sans-serif`;
      ctx.fillText(initialsOf(person.name), x + w / 2, y + h / 2 - h * 0.05);
      ctx.textBaseline = "alphabetic";
    }

    // Name plate
    const label = person.muted ? `${person.name}  ·  muted` : person.name;
    ctx.font = `600 ${Math.max(11, Math.round(h * 0.075))}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(2,6,23,0.66)";
    roundRect(ctx, x + 8, y + h - 34, Math.min(tw + 18, w - 16), 26, 8);
    ctx.fill();
    ctx.fillStyle = TEXT;
    ctx.textAlign = "left";
    ctx.fillText(label, x + 17, y + h - 16);

    if (person.speaking) {
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 3;
      roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 12);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * The bits that are on every frame: the recording clock, and the mark saying
   * whose meeting this is and what made the file. A recording gets forwarded,
   * re-shared and found on a hard drive years later, so it should be able to
   * say for itself where it came from.
   */
  private paintChrome(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    // REC pill, top left
    ctx.fillStyle = "rgba(2,6,23,0.6)";
    roundRect(ctx, 20, 18, 168, 38, 19);
    ctx.fill();
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(43, 37, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = TEXT;
    ctx.font = "700 17px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`REC  ${formatDuration(this.elapsedSec)}`, 60, 43);

    // Watermark, bottom right
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(248,250,252,0.92)";
    ctx.font = "700 20px system-ui, sans-serif";
    ctx.fillText(this.opts.churchName || this.opts.meetingTitle, W - 24, H - 40);
    ctx.fillStyle = "rgba(148,163,184,0.85)";
    ctx.font = "600 15px system-ui, sans-serif";
    ctx.fillText("Recorded with FlockInsight", W - 24, H - 18);
    ctx.textAlign = "left";
  }

  /* --------------------------------------------------------- drawing */

  private drawCover(
    ctx: CanvasRenderingContext2D,
    src: CanvasImageSource,
    sw: number,
    sh: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const scale = Math.max(w / sw, h / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  private drawContain(
    ctx: CanvasRenderingContext2D,
    src: CanvasImageSource,
    sw: number,
    sh: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const scale = Math.min(w / sw, h / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  private centeredText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    size: number,
    colour: string,
  ): void {
    ctx.fillStyle = colour;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(text, x + w / 2, y + h / 2);
    ctx.textAlign = "left";
  }
}

/* ============================================================
 * Canvas helpers
 * ========================================================== */

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Greedy word wrap against the canvas's own measurement. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Hand a finished recording to the person's downloads folder. */
export function downloadRecording(result: RecordingResult): void {
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before the blob goes.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
