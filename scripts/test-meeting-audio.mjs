/**
 * Does the voice actually arrive? Measured in a real browser.
 *
 * Every audio dial this platform sets lives in the SDP or in
 * `sender.setParameters`, and both are places where being wrong is silent: a
 * description a browser quietly dislikes, or a codec preference the two ends
 * do not agree on, produces a call that connects, shows a healthy tile, and
 * carries no speech. Nothing throws and nothing is logged. That is exactly how
 * "only one person could be heard" presented, and no unit test can see it,
 * because the thing being tested is the browser's own SDP negotiation.
 *
 * So this drives the Chrome on this machine over the DevTools Protocol, loads
 * the REAL `tuneOpus`/`audioProfileFor` out of src/lib/meetings-shared.ts
 * (transpiled, not reimplemented — a copy would only test the copy), builds
 * two peer connections exactly the way meeting-client.ts does, and reads
 * getStats to answer one question per case: did audio bytes arrive.
 *
 * The asymmetric cases are the point. Two people in the same meeting measure
 * their own links separately, so one can be asking for RED while the other is
 * asking for plain Opus — and that pairing is never exercised anywhere else.
 *
 * Usage:
 *   node scripts/test-meeting-audio.mjs
 *   CDP_PORT=9444 node scripts/test-meeting-audio.mjs
 *   KEEP=1 node scripts/test-meeting-audio.mjs     # leave Chrome open
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PORT = Number(process.env.CDP_PORT || 9444);

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

let failures = 0;
const ok = (label, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? ` - ${extra}` : ""}`);
};

/* ---------------------------------------------------------------- the code */

/**
 * The real module, as JavaScript. `meetings-shared.ts` imports nothing, which
 * is what makes this honest: the file the browser runs is the file the product
 * ships, with only its type annotations removed.
 */
async function sharedModuleSource() {
  const ts = require("typescript");
  const src = await readFile("src/lib/meetings-shared.ts", "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return out.outputText;
}

/* ------------------------------------------------------------------- chrome */

async function launchChrome() {
  const bin = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!bin) {
    console.error("No Chrome or Edge found. Install one, or edit CHROME_CANDIDATES.");
    process.exit(2);
  }
  const profile = await mkdtemp(join(tmpdir(), "flock-audio-"));
  const child = spawn(
    bin,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      // A fake microphone that actually makes a sound, and no permission
      // prompt to answer. Without a real signal DTX would stop sending and a
      // broken case would look identical to a silent room.
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
    { stdio: "ignore" },
  );
  const target = await waitForTarget();
  return { child, profile, target, bin };
}

async function waitForTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* not up yet - the only expected failure in this loop */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Chrome never opened a debugging port on ${PORT}`);
}

/** The smallest CDP client that can evaluate an expression and read it back. */
function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let next = 1;
  const open = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP socket failed")), {
      once: true,
    });
  });
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  });
  return {
    ready: open,
    send(method, params = {}) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

async function evaluate(cdp, expression) {
  const res = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      res.exceptionDetails.exception?.description ?? res.exceptionDetails.text,
    );
  }
  return res.result.value;
}

/* --------------------------------------------------------------- the probe */

/**
 * One call, start to finish, and what arrived.
 *
 * Mirrors meeting-client.ts deliberately: three transceivers in the same
 * order, `tuneOpus` on both the offer and the answer, and the sender ceiling
 * from `audioWireBitrate`. A probe that negotiated more simply than the
 * product would pass while the product failed.
 */
const PROBE = String.raw`
window.__probe = async function probe(caseName, offerProfile, answerProfile, seconds) {
  const S = window.__shared;
  const log = [];
  const result = {
    case: caseName,
    offerShape: S.audioShapeKey(offerProfile),
    answerShape: S.audioShapeKey(answerProfile),
    sldOfferError: null, sldAnswerError: null, setParamsError: null,
    offerMLine: null, answerMLine: null, offerFmtp: null, negotiatedCodec: null,
    lfOnlyLines: 0,
    packetsReceived: 0, bytesReceived: 0,
    concealedSamples: 0, totalSamplesReceived: 0,
    iceState: null, log,
  };

  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });

  const a = new RTCPeerConnection({ iceServers: [] });
  const b = new RTCPeerConnection({ iceServers: [] });
  a.onicecandidate = (e) => { if (e.candidate) b.addIceCandidate(e.candidate).catch(() => log.push("b rejected a candidate")); };
  b.onicecandidate = (e) => { if (e.candidate) a.addIceCandidate(e.candidate).catch(() => log.push("a rejected a candidate")); };

  // The same three slots, in the same order, as createPeer().
  const slotA = {
    audio: a.addTransceiver("audio", { direction: "sendrecv" }),
    camera: a.addTransceiver("video", { direction: "sendrecv" }),
    screen: a.addTransceiver("video", { direction: "sendrecv" }),
  };
  b.addTransceiver("audio", { direction: "sendrecv" });
  b.addTransceiver("video", { direction: "sendrecv" });
  b.addTransceiver("video", { direction: "sendrecv" });
  await slotA.audio.sender.replaceTrack(mic.getAudioTracks()[0]);

  let inbound = null;
  b.ontrack = (e) => { if (e.track.kind === "audio") inbound = e.track; };

  const finish = () => {
    try { mic.getTracks().forEach((t) => t.stop()); a.close(); b.close(); } catch (e) { log.push(String(e)); }
    return result;
  };

  const offer = await a.createOffer();
  const tunedOffer = S.tuneOpus(offer.sdp, offerProfile);
  result.offerMLine = (tunedOffer.match(/^m=audio [^\r\n]+/m) || [""])[0];
  result.offerFmtp = (tunedOffer.match(/^a=fmtp:\d+ [^\r\n]*(?:stereo|minptime)[^\r\n]*/m) || [""])[0];
  // Lines the munge left ending in a bare LF while the rest of the SDP is CRLF.
  result.lfOnlyLines = (tunedOffer.match(/[^\r]\n/g) || []).length;
  try {
    await a.setLocalDescription({ type: "offer", sdp: tunedOffer });
  } catch (e) { result.sldOfferError = String(e); return finish(); }

  await b.setRemoteDescription(a.localDescription);
  const answer = await b.createAnswer();
  const tunedAnswer = S.tuneOpus(answer.sdp, answerProfile);
  result.answerMLine = (tunedAnswer.match(/^m=audio [^\r\n]+/m) || [""])[0];
  try {
    await b.setLocalDescription({ type: "answer", sdp: tunedAnswer });
  } catch (e) { result.sldAnswerError = String(e); return finish(); }
  await a.setRemoteDescription(b.localDescription);

  // The ceiling, exactly as applyProfileTo sets it.
  try {
    const params = slotA.audio.sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = S.audioWireBitrate(offerProfile);
    params.encodings[0].priority = "high";
    params.encodings[0].networkPriority = "high";
    await slotA.audio.sender.setParameters(params);
    result.maxBitrate = S.audioWireBitrate(offerProfile);
  } catch (e) { result.setParamsError = String(e); }

  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  result.iceState = a.iceConnectionState;
  result.inboundTrackMuted = inbound ? inbound.muted : null;

  const stats = await b.getStats();
  stats.forEach((r) => {
    if (r.type === "inbound-rtp" && r.kind === "audio") {
      result.packetsReceived = r.packetsReceived || 0;
      result.bytesReceived = r.bytesReceived || 0;
      result.concealedSamples = r.concealedSamples || 0;
      result.totalSamplesReceived = r.totalSamplesReceived || 0;
      const codec = stats.get(r.codecId);
      result.negotiatedCodec = codec ? codec.mimeType + " " + (codec.sdpFmtpLine || "") : null;
    }
  });

  return finish();
};
true;
`;

/* ----------------------------------------------------------------- the run */

const { child, profile, target } = await launchChrome();
const cdp = connect(target.webSocketDebuggerUrl);
await cdp.ready;
await cdp.send("Runtime.enable");
await cdp.send("Page.enable");
// A real origin: getUserMedia is refused on about:blank.
await cdp.send("Page.navigate", { url: "https://example.com/" });
await new Promise((r) => setTimeout(r, 2000));

const moduleSource = await sharedModuleSource();
const exported = await evaluate(
  cdp,
  `(async () => {
     const url = URL.createObjectURL(new Blob([${JSON.stringify(
       moduleSource,
     )}], { type: "text/javascript" }));
     window.__shared = await import(url);
     return Object.keys(window.__shared).length;
   })()`,
);
console.log(`Loaded the real meetings-shared module: ${exported} exports.\n`);
await evaluate(cdp, PROBE);

const P = (lowData, link) =>
  evaluate(cdp, `window.__shared.audioProfileFor(${JSON.stringify({ lowData, link })})`);

const profiles = {
  good: await P(false, "good"),
  fair: await P(false, "fair"),
  poor: await P(false, "poor"),
  "saver-good": await P(true, "good"),
  "saver-poor": await P(true, "poor"),
};

console.log("The five voices this product negotiates with:\n");
for (const [name, p] of Object.entries(profiles)) {
  console.log(
    `  ${name.padEnd(12)} ${p.label.padEnd(18)} ${String(p.bitrate).padStart(5)}bps  ` +
      `band=${p.maxBandwidth || "free"}  red=${p.redundancy ? "on " : "off"}  dtx=${
        p.dtx ? "on" : "off"
      }  jitter=${p.jitterBufferMs}ms`,
  );
}

/*
 * Symmetric first - both ends measuring the same link quality - then the
 * mixed pairs, which is the ordinary case in a real meeting and the one
 * nothing else tests.
 */
const CASES = [
  ["good -> good", "good", "good"],
  ["fair -> fair", "fair", "fair"],
  ["poor -> poor", "poor", "poor"],
  ["saver-good -> saver-good", "saver-good", "saver-good"],
  ["saver-poor -> saver-poor", "saver-poor", "saver-poor"],
  ["good -> fair   (plain offer, RED answer)", "good", "fair"],
  ["fair -> good   (RED offer, plain answer)", "fair", "good"],
  ["poor -> good   (RED offer, plain answer)", "poor", "good"],
  ["saver-poor -> good", "saver-poor", "good"],
];

console.log("\nWhat arrives, over 4 seconds of a real fake microphone:\n");
const rows = [];
for (const [name, offerKey, answerKey] of CASES) {
  const r = await evaluate(
    cdp,
    `window.__probe(${JSON.stringify(name)}, ${JSON.stringify(
      profiles[offerKey],
    )}, ${JSON.stringify(profiles[answerKey])}, 4)`,
  );
  rows.push(r);
  const err = r.sldOfferError || r.sldAnswerError;
  console.log(`  ${name}`);
  console.log(`      m=audio (offer):  ${r.offerMLine}`);
  console.log(`      m=audio (answer): ${r.answerMLine}`);
  console.log(`      negotiated:       ${r.negotiatedCodec ?? "-"}`);
  console.log(
    `      arrived:          ${r.packetsReceived} packets, ${r.bytesReceived} bytes, ` +
      `ice=${r.iceState}, concealed=${
        r.totalSamplesReceived
          ? ((100 * r.concealedSamples) / r.totalSamplesReceived).toFixed(1) + "%"
          : "?"
      }`,
  );
  if (r.lfOnlyLines) console.log(`      lines ending in a bare LF: ${r.lfOnlyLines}`);
  if (err) console.log(`      REFUSED:          ${err}`);
  if (r.setParamsError) console.log(`      setParameters:    ${r.setParamsError}`);
  if (r.offerFmtp) console.log(`      fmtp:             ${r.offerFmtp}`);
  console.log("");
}

console.log("Verdicts:\n");
for (const r of rows) {
  ok(
    `${r.case}: the description was accepted`,
    !r.sldOfferError && !r.sldAnswerError,
    r.sldOfferError || r.sldAnswerError || "",
  );
  if (r.sldOfferError || r.sldAnswerError) continue;
  ok(
    `${r.case}: audio actually arrived`,
    r.packetsReceived > 20 && r.bytesReceived > 1000,
    `${r.packetsReceived} packets / ${r.bytesReceived} bytes`,
  );
}

cdp.close();
if (!process.env.KEEP) {
  child.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${failures === 0 ? "All clear." : `${failures} failing check(s).`}`);
process.exitCode = failures === 0 ? 0 : 1;
