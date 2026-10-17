/**
 * The recording service, end to end, on this machine.
 *
 * Starts the real recorder process against the local database, pretends to be
 * the media server's WebSocket adapter — a tone streamed as protobuf PCM
 * packets over the real ingest socket, with a real signed path — presses Stop
 * by writing the row the way the app does, and then checks what the recorder
 * filed: a "ready" row, a media row, a file on disk of about the right length.
 *
 * It needs ffmpeg. On the VPS it is on PATH; on a laptop point at a build:
 *
 *   FFMPEG_PATH=C:/tools/ffmpeg/bin/ffmpeg.exe FFPROBE_PATH=C:/tools/ffmpeg/bin/ffprobe.exe \
 *     pnpm exec tsx --tsconfig tsconfig.recorder.json scripts/test-recorder-local.mts
 *
 *   VIDEO=1 ...     a video recording: a camera stream of JPEG frames too
 *   SECONDS=20 ...  stream for longer
 *   KEEP=1 ...      leave the recorder running and the rows in place
 *
 * The media server itself is not involved: the recorder's adapter requests
 * fail locally (no Cloudflare credentials) and are retried on their backoff,
 * exactly as they would be through a Cloudflare outage, while this script
 * connects where the adapter would have. What is proved is everything on OUR
 * side of that socket.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import WebSocket from "ws";
import { encodePacket } from "../src/recorder/protobuf";

const PORT = Number(process.env.RECORDER_TEST_PORT || 3961);
const SECONDS = Number(process.env.SECONDS || 8);
const VIDEO = process.env.VIDEO === "1";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const MEDIA_ROOT = path.resolve(process.env.RECORDER_TEST_MEDIA_ROOT || path.join(os.tmpdir(), "flockinsight-recorder-test"));

let failures = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? ` - ${extra}` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function health(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function probeDuration(file: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
    let out = "";
    child.stdout?.on("data", (d) => (out += String(d)));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const n = Number(out.trim());
      resolve(Number.isFinite(n) ? n : null);
    });
  });
}

/** 20 ms of a tone, stereo s16le at 48 kHz, continuing from `phase`. */
function toneFrame(phase: { t: number }, hz: number): Uint8Array {
  const samples = 960;
  const out = new Uint8Array(samples * 4);
  for (let i = 0; i < samples; i++) {
    const v = Math.round(Math.sin(phase.t * 2 * Math.PI * hz) * 12000);
    phase.t += 1 / 48000;
    out[i * 4] = v & 0xff;
    out[i * 4 + 1] = (v >> 8) & 0xff;
    out[i * 4 + 2] = v & 0xff;
    out[i * 4 + 3] = (v >> 8) & 0xff;
  }
  return out;
}

async function makeJpeg(file: string): Promise<Buffer> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(FFMPEG, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=1", "-frames:v", "1", "-q:v", "4", file]);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
  return readFile(file);
}

/* ------------------------------------------------------------------ run */

await mkdir(MEDIA_ROOT, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const { rows: churches } = await db.query("select id, name from church order by created_at limit 1");
if (churches.length === 0) {
  console.log("No church in this database - nothing to record.");
  process.exit(0);
}
const church = churches[0];

console.log(`Starting the recorder on port ${PORT}, media root ${MEDIA_ROOT}`);
const recorder = spawn(
  process.execPath,
  [path.join("node_modules", "tsx", "dist", "cli.mjs"), "--tsconfig", "tsconfig.recorder.json", path.join("src", "recorder", "main.ts")],
  {
    env: {
      ...process.env,
      RECORDER_PORT: String(PORT),
      RECORDER_INGEST_URL: "wss://recorder-test.invalid",
      RECORDER_SECRET: process.env.RECORDER_SECRET || process.env.BETTER_AUTH_SECRET || "recorder-test-secret",
      RECORDER_DEBUG_TOKENS: "1",
      RECORDER_POLL_MS: "500",
      MEDIA_ROOT,
      FFMPEG_PATH: FFMPEG,
      FFPROBE_PATH: FFPROBE,
      // No media server here: adapter requests fail and back off, as designed.
      CLOUDFLARE_REALTIME_APP_ID: "",
      CLOUDFLARE_REALTIME_APP_SECRET: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const recorderLog: string[] = [];
recorder.stdout?.on("data", (d) => {
  for (const line of String(d).split("\n").filter(Boolean)) {
    recorderLog.push(line);
    console.log(`    ${line}`);
  }
});
recorder.stderr?.on("data", (d) => console.log(`    [stderr] ${String(d).trim()}`));

let meetingId = "";
let recordingId = "";

try {
  let up = false;
  for (let i = 0; i < 100; i++) {
    if (await health()) {
      up = true;
      break;
    }
    if (recorder.exitCode !== null) break;
    await sleep(200);
  }
  ok("the recorder answers /health", up);
  if (!up) throw new Error("recorder never came up");

  const stamp = Date.now().toString(36).slice(-5);
  const { rows: made } = await db.query(
    `insert into meeting (church_id, code, title, kind, status, access, transport, max_participants, started_at)
     values ($1, $2, 'zzrec recorder smoke test', 'prayer', 'live', 'open', 'sfu', 12, now())
     returning id`,
    [church.id, `zzr-${stamp}-rec`],
  );
  meetingId = made[0].id;
  const { rows: part } = await db.query(
    `insert into meeting_participant (meeting_id, church_id, peer_id, secret, display_name, role, admitted, mic_on, camera_on, sfu_session_id, last_seen_at)
     values ($1, $2, $3, 'zz-secret', 'Pastor Ada', 'host', true, true, $4, 'cf-test-session', now())
     returning id`,
    [meetingId, church.id, `peer-${stamp}`, VIDEO],
  );
  const participantId = part[0].id;
  const { rows: rec } = await db.query(
    `insert into meeting_recording (meeting_id, church_id, title, mode, status, source, started_at, last_activity_at)
     values ($1, $2, 'zzrec smoke recording', $3, 'recording', 'server', now(), now())
     returning id`,
    [meetingId, church.id, VIDEO ? "video" : "audio"],
  );
  recordingId = rec[0].id;
  await db.query("select pg_notify('flockinsight_recorder', $1)", [meetingId]);
  console.log(`Meeting ${meetingId.slice(0, 8)}, recording ${recordingId.slice(0, 8)} (${VIDEO ? "video" : "audio"})`);

  // Wait for the recorder to pick the row up and mint ingest paths.
  type Adapter = { kind: string; endpoint?: string };
  let adapters: Adapter[] = [];
  for (let i = 0; i < 60; i++) {
    const h = (await health()) as { recordings?: { id: string; adapters: Adapter[] }[] } | null;
    const mine = h?.recordings?.find((r) => r.id === recordingId);
    if (mine && mine.adapters.some((a) => a.kind === "mic" && a.endpoint)) {
      adapters = mine.adapters;
      break;
    }
    await sleep(500);
  }
  const mic = adapters.find((a) => a.kind === "mic");
  ok("the recorder asked for the participant's microphone", !!mic, `${adapters.length} adapter(s)`);
  if (!mic?.endpoint) throw new Error("no microphone ingest path");
  const cam = adapters.find((a) => a.kind === "cam");
  if (VIDEO) ok("the recorder asked for the host's camera", !!cam?.endpoint);

  const local = (endpoint: string) => endpoint.replace(/^wss?:\/\/[^/]+/, `ws://127.0.0.1:${PORT}`);

  // A wrong signature must be refused before a frame is read.
  const bad = await new Promise<number>((resolve) => {
    const ws = new WebSocket(local(mic.endpoint!).replace(/[A-Za-z0-9_-]{43}$/, "x".repeat(43)));
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("open", () => resolve(101));
    ws.on("error", () => {});
  });
  ok("a forged ingest path is refused", bad === 401, `status ${bad}`);

  // The real one: stream a tone for SECONDS seconds, in real time.
  const ws = new WebSocket(local(mic.endpoint!));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ok("the signed ingest path is accepted", ws.readyState === WebSocket.OPEN);

  let camWs: WebSocket | null = null;
  let jpeg: Buffer | null = null;
  if (VIDEO && cam?.endpoint) {
    jpeg = await makeJpeg(path.join(MEDIA_ROOT, "test-frame.jpg"));
    camWs = new WebSocket(local(cam.endpoint));
    await new Promise<void>((resolve, reject) => {
      camWs!.once("open", () => resolve());
      camWs!.once("error", reject);
    });
  }

  const phase = { t: 0 };
  const started = Date.now();
  let seq = 0;
  let sentFrames = 0;
  while (Date.now() - started < SECONDS * 1000) {
    const due = Math.floor((Date.now() - started) / 20) - sentFrames;
    for (let i = 0; i < due; i++) {
      ws.send(encodePacket({ sequenceNumber: seq++, timestamp: sentFrames * 960, payload: toneFrame(phase, 440) }));
      sentFrames++;
    }
    if (camWs && jpeg && sentFrames % 50 === 0 && due > 0) {
      camWs.send(encodePacket({ timestamp: sentFrames * 960, payload: jpeg }));
    }
    await sleep(10);
  }
  console.log(`Streamed ${sentFrames} frames (${(sentFrames * 20) / 1000}s) of tone`);

  const during = (await health()) as { recordings?: { id: string; stats: { audioPackets: number }; adapters: { kind: string; framesMixed: number | null }[] }[] } | null;
  const live = during?.recordings?.find((r) => r.id === recordingId);
  ok("the recorder received the packets", (live?.stats.audioPackets ?? 0) >= sentFrames * 0.95, `${live?.stats.audioPackets} of ${sentFrames}`);
  const mixed = live?.adapters.find((a) => a.kind === "mic")?.framesMixed ?? 0;
  ok("the mixer put them into the file", mixed >= sentFrames * 0.8, `${mixed} frames mixed`);

  ws.close();
  camWs?.close();

  // Stop, the way the app does it.
  await db.query("update meeting_recording set stopped_at = now() where id = $1", [recordingId]);
  await db.query("select pg_notify('flockinsight_recorder', $1)", [meetingId]);

  let row: { status: string; bytes: string; duration_sec: number; media_id: string | null; error: string | null; url: string | null } | null = null;
  for (let i = 0; i < 120; i++) {
    const { rows } = await db.query("select status, bytes, duration_sec, media_id, error, url from meeting_recording where id = $1", [recordingId]);
    row = rows[0];
    if (row && (row.status === "ready" || row.status === "failed")) break;
    await sleep(500);
  }
  ok("the recording row ends up ready", row?.status === "ready", `${row?.status}${row?.error ? ` - ${row.error}` : ""}`);
  if (row?.status === "ready") {
    ok("with a media row and a URL", !!row.media_id && !!row.url, `${row.url}`);
    ok("with a plausible size", Number(row.bytes) > 10_000, `${row.bytes} bytes`);
    ok("with about the right duration", Math.abs(row.duration_sec - SECONDS) <= 2, `${row.duration_sec}s for ${SECONDS}s streamed`);

    const { rows: m } = await db.query("select provider, storage_key, mime, format, transcode_status from media where id = $1", [row.media_id]);
    const media = m[0];
    ok("the media row is a local file", media?.provider === "local" && !!media?.storage_key, `${media?.mime} ${media?.format}`);
    ok("that needs no conversion", media?.transcode_status === "skipped", media?.transcode_status);
    const file = path.join(MEDIA_ROOT, media.storage_key);
    const size = await stat(file).then((s) => s.size).catch(() => -1);
    ok("and the file is on disk", size > 0, `${size} bytes at ${file}`);
    const dur = await probeDuration(file);
    ok("and ffprobe agrees about its length", dur !== null && Math.abs(dur - SECONDS) <= 2, `${dur}s`);
  }
} catch (e) {
  failures++;
  console.log(`FAIL  ${String((e as Error).message ?? e)}`);
  console.log("--- recorder log ---");
  for (const l of recorderLog.slice(-30)) console.log(l);
} finally {
  if (!process.env.KEEP) {
    recorder.kill();
    if (meetingId) {
      await db.query("update meeting set status = 'ended', ended_at = now() where id = $1", [meetingId]).catch(() => {});
    }
  }
  await db.end();
  await writeFile(path.join(MEDIA_ROOT, "last-run.log"), recorderLog.join("\n")).catch(() => {});
}

console.log(`\n${failures === 0 ? "All clear." : `${failures} failing check(s).`}`);
process.exit(failures === 0 ? 0 : 1);
