import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server, type Socket } from "node:net";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";

/**
 * ffmpeg, as the recording service uses it.
 *
 * Three jobs, and the shape of each is chosen for a process that must survive
 * being killed at any moment:
 *
 *   A SEGMENT is one live encode. Mixed PCM goes in on stdin, JPEG frames (for
 *   a video recording) over a loopback socket, and a fragmented MP4 comes out
 *   — fragmented, because a fragmented file is complete up to its last
 *   fragment at every instant. Kill the process and the recording so far is
 *   still playable. An ordinary MP4 is unreadable until its index is written
 *   at the very end, which would make every crash a total loss.
 *
 *   ASSEMBLY joins a recording's segments — usually one, more if the service
 *   restarted during the meeting — into one ordinary MP4 with its index at the
 *   front, with no re-encoding. Seconds, not minutes, and lossless.
 *
 *   CARDS are single JPEGs: a verse, a note, a title. Rendered once each and
 *   fed into the live encode as frames.
 *
 * Nothing here knows about meetings or the database.
 */

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
/** Frames per second the live encode is fed. The source is far slower. */
export const VIDEO_FPS = 10;

/**
 * Run under `nice` where it exists. The live encode gets a little priority
 * (it is real time, and starving it delays the file, not the meeting); the
 * finishing passes get none at all, because this box also serves every
 * church's website.
 */
function command(cmd: string, args: string[], niceness: number): [string, string[]] {
  if (process.platform === "win32" || niceness === 0) return [cmd, args];
  return ["nice", ["-n", String(niceness), cmd, ...args]];
}

/** ffmpeg's filter language takes `:` and `\` as its own; a path must not. */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export type SegmentHandle = {
  path: string;
  /** Mono s16le at 48 kHz, written as it is mixed. */
  audio: Writable;
  /** JPEG frames, one after another, at VIDEO_FPS. Null for audio-only. */
  video: Writable | null;
  /** Resolves when ffmpeg exits, however it exits. */
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>;
  /** Close the inputs and let ffmpeg finish the file. */
  end(): void;
  /** Last resort. The fragments written so far survive. */
  kill(): void;
  pid: number | undefined;
};

export type SegmentOptions = {
  mode: "audio" | "video";
  path: string;
  /** Read live by the overlay — rewritten whenever the picture changes. */
  captionFile: string;
  /** The standing mark in the corner. */
  watermarkFile: string;
  fonts: { regular: string; bold: string };
};

const FRAGMENT_ARGS = [
  "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
  // Cut a fragment every two seconds whatever the content, so an audio-only
  // file (which has no keyframes to cut on) is also complete to within two
  // seconds of a crash.
  "-frag_duration", "2000000",
];

const AUDIO_ENCODE = ["-c:a", "aac", "-b:a", "64k", "-ar", "48000", "-ac", "1"];

/**
 * Wait for one connection on a fresh loopback port, and hand back the port
 * before anybody has connected — ffmpeg is spawned afterwards and dials it.
 */
function loopbackListener(): Promise<{ port: number; server: Server; socket: Promise<Socket> }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    let settled = false;
    const socket = new Promise<Socket>((res) => {
      server.once("connection", (s) => {
        settled = true;
        // One client, ever. Anything after the first is not ffmpeg.
        server.on("connection", (other) => other.destroy());
        res(s);
      });
    });
    server.once("error", (e) => reject(e));
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("could not read the loopback port"));
        return;
      }
      resolve({ port: addr.port, server, socket });
    });
    // Belt and braces: if ffmpeg never connects, the listener must not leak.
    setTimeout(() => {
      if (!settled) server.close();
    }, 30_000).unref();
  });
}

export async function spawnSegment(opts: SegmentOptions): Promise<SegmentHandle> {
  await mkdir(path.dirname(opts.path), { recursive: true });

  const args = ["-nostdin", "-hide_banner", "-loglevel", "warning", "-y"];
  const audioInput = ["-f", "s16le", "-ar", "48000", "-ac", "1", "-i", "pipe:0"];

  let listener: Awaited<ReturnType<typeof loopbackListener>> | null = null;
  if (opts.mode === "video") {
    listener = await loopbackListener();
    const caption = escapeFilterPath(opts.captionFile);
    const watermark = escapeFilterPath(opts.watermarkFile);
    const bold = escapeFilterPath(opts.fonts.bold);
    const regular = escapeFilterPath(opts.fonts.regular);
    const filter = [
      `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease`,
      `pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x0a0f1c`,
      "format=yuv420p",
      // Who or what is on screen, bottom left. `reload=1` re-reads the file
      // every frame, so changing the picture changes the line.
      `drawtext=fontfile='${bold}':textfile='${caption}':reload=1:x=24:y=h-th-28:fontsize=28:fontcolor=white:box=1:boxcolor=0x020617@0.6:boxborderw=12`,
      `drawtext=fontfile='${regular}':textfile='${watermark}':x=w-tw-24:y=h-th-28:fontsize=18:fontcolor=0xcbd5e1:box=1:boxcolor=0x020617@0.5:boxborderw=8`,
    ].join(",");
    /*
     * The video socket is input 0 and the audio pipe input 1, and the order
     * is load-bearing. ffmpeg 4.4 (what Ubuntu 22.04 ships, and what the VPS
     * runs) opens its inputs one at a time and probes each before dialling
     * the next. With the audio pipe first it sat probing stdin, while we wait
     * for its video connection before sending a single sample: each side
     * waiting for the other, and every video recording failed with "ffmpeg
     * never connected". Newer ffmpeg does not probe raw PCM that way, which
     * is how it passed on a laptop. Video first: ffmpeg dials us, the clock
     * starts, frames and samples both flow, and every probe completes.
     */
    args.push(
      "-f", "image2pipe", "-framerate", String(VIDEO_FPS), "-c:v", "mjpeg",
      "-i", `tcp://127.0.0.1:${listener.port}`,
      ...audioInput,
      "-map", "0:v:0", "-map", "1:a:0",
      "-vf", filter,
      "-r", String(VIDEO_FPS),
      // A meeting is mostly still: faces, a slide, a verse. `stillimage`
      // spends the bits on sharpness; `veryfast` because this box is shared.
      "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage",
      "-crf", "27", "-g", String(VIDEO_FPS * 3), "-pix_fmt", "yuv420p",
      ...AUDIO_ENCODE,
    );
  } else {
    args.push(...audioInput, ...AUDIO_ENCODE);
  }
  args.push(...FRAGMENT_ARGS, "-f", "mp4", opts.path);

  const [cmd, full] = command(FFMPEG, args, 5);
  const child: ChildProcess = spawn(cmd, full, { stdio: ["pipe", "ignore", "pipe"] });

  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr = (stderr + String(d)).slice(-6000);
  });
  // A pipe closed by ffmpeg dying must not take the service down with EPIPE.
  child.stdin?.on("error", () => {});

  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>(
    (resolve) => {
      child.on("error", (e) => resolve({ code: null, signal: null, stderr: `${stderr}\n${String(e)}` }));
      child.on("close", (code, signal) => resolve({ code, signal, stderr }));
    },
  );

  let video: Socket | null = null;
  if (listener) {
    const connected = await Promise.race([
      listener.socket,
      done.then(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
    ]);
    listener.server.close();
    if (!connected) {
      child.kill("SIGKILL");
      const out = await done;
      throw new Error(`ffmpeg never connected for video frames: ${out.stderr.trim().split("\n").pop() ?? ""}`);
    }
    video = connected;
    video.on("error", () => {});
  }

  return {
    path: opts.path,
    audio: child.stdin as Writable,
    video,
    done,
    pid: child.pid,
    end() {
      try {
        child.stdin?.end();
      } catch {
        /* already closed */
      }
      try {
        video?.end();
      } catch {
        /* already closed */
      }
    },
    kill() {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    },
  };
}

/* ============================================================
 * Finishing
 * ========================================================== */

/** Run a command to completion; the tail of stderr on failure. */
function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; niceness?: number },
): Promise<{ code: number | null; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const [bin, full] = command(cmd, args, opts.niceness ?? 15);
    const child = spawn(bin, full, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let timedOut = false;
    child.stderr?.on("data", (d) => {
      stderr = (stderr + String(d)).slice(-4000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stderr: `${stderr}\n${String(e)}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, timedOut });
    });
  });
}

function lastLine(stderr: string): string {
  return stderr.trim().split("\n").filter(Boolean).pop() ?? "ffmpeg failed";
}

/**
 * One ordinary MP4 from one or more fragmented segments, index at the front,
 * no re-encode. Throws with ffmpeg's last line on failure.
 */
export async function assembleSegments(segments: string[], out: string): Promise<void> {
  if (segments.length === 0) throw new Error("no segments to assemble");
  await mkdir(path.dirname(out), { recursive: true });

  let result;
  if (segments.length === 1) {
    result = await run(
      FFMPEG,
      ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", segments[0], "-c", "copy", "-movflags", "+faststart", out],
      { timeoutMs: 20 * 60_000 },
    );
  } else {
    const list = path.join(path.dirname(out), "segments.txt");
    await writeFile(
      list,
      segments.map((s) => `file '${s.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n") + "\n",
    );
    result = await run(
      FFMPEG,
      ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out],
      { timeoutMs: 20 * 60_000 },
    );
  }
  if (result.code !== 0) {
    throw new Error(result.timedOut ? "assembling the recording took too long" : lastLine(result.stderr));
  }
  const s = await stat(out);
  if (s.size === 0) throw new Error("the assembled recording is empty");
}

/** Duration in whole seconds, read from the file. Null if ffprobe cannot say. */
export async function probeDuration(file: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(FFPROBE, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    let out = "";
    child.stdout?.on("data", (d) => (out += String(d)));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const n = Number(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? Math.round(n) : null);
    });
  });
}

/* ============================================================
 * Cards
 * ========================================================== */

/**
 * Wrap a passage for a 1280-wide card and pick a size it fits at. drawtext
 * does not wrap, so the lines are decided here, the way the browser recorder
 * did it on its canvas.
 */
export function layoutCard(body: string): { fontSize: number; lines: string[] } {
  const words = body.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const usableWidth = VIDEO_WIDTH - 180;
  const usableHeight = VIDEO_HEIGHT - 260;
  for (const size of [40, 36, 32, 28, 24, 20, 18]) {
    // Noto Sans averages a touch over half an em per character.
    const perLine = Math.max(10, Math.floor(usableWidth / (size * 0.55)));
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (candidate.length > perLine && line) {
        lines.push(line);
        line = w;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    if (lines.length * size * 1.45 <= usableHeight) return { fontSize: size, lines };
  }
  // Too long even at the smallest size: show what fits.
  const size = 18;
  const perLine = Math.floor(usableWidth / (size * 0.55));
  const maxLines = Math.floor(usableHeight / (size * 1.45));
  const all = body.replace(/\s+/g, " ").match(new RegExp(`.{1,${perLine}}(\\s|$)`, "g")) ?? [];
  return { fontSize: size, lines: all.slice(0, maxLines).map((l) => l.trim()) };
}

export type CardSpec = { title: string; body: string; footnote: string };

/**
 * Render one card to a JPEG. The text goes through files rather than the
 * command line, because a verse can contain every character ffmpeg's filter
 * parser treats as its own.
 */
export async function renderCard(
  spec: CardSpec,
  out: string,
  fonts: { regular: string; bold: string },
): Promise<void> {
  await mkdir(path.dirname(out), { recursive: true });
  const base = out.replace(/\.jpg$/i, "");
  const titleFile = `${base}.title.txt`;
  const bodyFile = `${base}.body.txt`;
  const footFile = `${base}.foot.txt`;
  const { fontSize, lines } = layoutCard(spec.body);
  await Promise.all([
    writeFile(titleFile, spec.title.replace(/\s+/g, " ").trim()),
    writeFile(bodyFile, lines.join("\n")),
    writeFile(footFile, spec.footnote.trim()),
  ]);

  const bold = escapeFilterPath(fonts.bold);
  const regular = escapeFilterPath(fonts.regular);
  const parts: string[] = [];
  if (spec.title.trim()) {
    parts.push(
      `drawtext=fontfile='${bold}':textfile='${escapeFilterPath(titleFile)}':x=90:y=80:fontsize=38:fontcolor=0x818cf8`,
    );
  }
  if (lines.length > 0) {
    parts.push(
      `drawtext=fontfile='${regular}':textfile='${escapeFilterPath(bodyFile)}':x=90:y=${spec.title.trim() ? 150 : 110}:fontsize=${fontSize}:fontcolor=white:line_spacing=${Math.round(fontSize * 0.45)}`,
    );
  }
  if (spec.footnote.trim()) {
    parts.push(
      `drawtext=fontfile='${regular}':textfile='${escapeFilterPath(footFile)}':x=90:y=h-80:fontsize=22:fontcolor=0x94a3b8`,
    );
  }

  const args = [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=0x151c2e:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:d=1:r=1`,
    ...(parts.length > 0 ? ["-vf", parts.join(",")] : []),
    "-frames:v", "1", "-q:v", "3", out,
  ];
  const result = await run(FFMPEG, args, { timeoutMs: 60_000, niceness: 5 });
  if (result.code !== 0) throw new Error(`card render failed: ${lastLine(result.stderr)}`);
}

/** A slide image from the library, scaled onto a 1280x720 JPEG. */
export async function renderSlide(
  url: string,
  out: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await mkdir(path.dirname(out), { recursive: true });
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`slide fetch ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) {
    throw new Error(`slide is ${bytes.length} bytes`);
  }
  const src = out.replace(/\.jpg$/i, ".src");
  await writeFile(src, bytes);
  const result = await run(
    FFMPEG,
    [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", src,
      "-vf", `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x0a0f1c`,
      "-frames:v", "1", "-q:v", "3", out,
    ],
    { timeoutMs: 60_000, niceness: 5 },
  );
  if (result.code !== 0) throw new Error(`slide render failed: ${lastLine(result.stderr)}`);
}

export async function readJpeg(file: string): Promise<Buffer> {
  return readFile(file);
}

export async function ffmpegAvailable(): Promise<boolean> {
  const r = await run(FFMPEG, ["-version"], { timeoutMs: 10_000, niceness: 0 });
  return r.code === 0;
}
