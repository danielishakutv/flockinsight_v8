/**
 * A real meeting, with real browsers, and a matrix of who could hear whom.
 *
 * `test-meetings.mjs` proves everything around the media path. This proves the
 * media path itself, which is the half that has produced every expensive bug in
 * this module — because a meeting where nobody can be heard looks, from every
 * other vantage point, completely healthy: the roster is right, the tiles are
 * lit, `getStats` reports a connected ICE pair, and no line is logged anywhere.
 *
 * So: N headless Chrome tabs join one real meeting through the real join
 * screen, in a known order, each with a fake microphone that actually makes a
 * sound. Then every RTCPeerConnection in every tab is asked what arrived. The
 * answer is printed as a grid — one row per listener, one column per speaker —
 * which is the only shape that can tell "audio is broken" apart from "ONE
 * person's audio is broken", and the two have completely different causes.
 *
 * `RTCPeerConnection` is wrapped before any page script runs, so nothing in
 * the product has to export a handle for testing and the thing measured is the
 * thing that ships.
 *
 * Usage, against a PRODUCTION build (a dev build does not hydrate headless -
 * the Join button would never respond):
 *   BETTER_AUTH_URL=http://127.0.0.1:3131 pnpm start -- -p 3131
 *   node scripts/test-meeting-call.mjs
 *
 *   PEOPLE=4 node scripts/test-meeting-call.mjs      # a bigger room
 *   SECONDS=20 node scripts/test-meeting-call.mjs    # listen for longer
 *   SETTLE_MS=60000 node scripts/test-meeting-call.mjs  # allow longer to converge
 *   HEADED=1 node scripts/test-meeting-call.mjs      # watch it happen
 *   KEEP=1 node scripts/test-meeting-call.mjs        # leave Chrome open
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";
import "dotenv/config";

const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:3131";
const PORT = Number(process.env.CDP_PORT || 9445);
const PEOPLE = Number(process.env.PEOPLE || 3);
const SECONDS = Number(process.env.SECONDS || 14);
/**
 * How long the room may take to finish negotiating after the listen period.
 *
 * Only reached when something had to be rebuilt; a healthy room is already
 * settled when the listening ends and this costs one check.
 */
const SETTLE_MS = Number(process.env.SETTLE_MS || 30_000);

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** Names in join order. The third is the one the bug report singled out. */
const NAMES = [
  "Pastor Ada",
  "Grace Okoro",
  "Samuel Adeyemi",
  "Blessing Eze",
  "Emeka Nwosu",
  "Hauwa Bello",
];

let failures = 0;
const ok = (label, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? ` - ${extra}` : ""}`);
};

/* ------------------------------------------------------------------- chrome */

/**
 * One whole browser per person, each with its own profile directory.
 *
 * Not tabs. The product gives every browser a `deviceId` in localStorage and
 * treats a second join carrying an id already in the room as the same person
 * walking back in — it retires the earlier session and tells the room to drop
 * the tile, which is correct and is what stops one phone appearing three
 * times. Tabs share localStorage, so three tabs are one device: each join
 * evicted the one before it, the roster never held more than one person, and
 * the harness "reproduced" a bug that was entirely its own. Separate profiles
 * are what make three tabs into three people.
 */
async function launchBrowser(index) {
  const bin = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!bin) {
    console.error("No Chrome or Edge found. Edit CHROME_CANDIDATES.");
    process.exit(2);
  }
  const port = PORT + index;
  const profile = await mkdtemp(join(tmpdir(), `flock-call-${index}-`));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    /*
     * Chrome normally hides a machine's local addresses behind an mDNS name
     * (`<uuid>.local`) so a web page cannot read them. Two separate browsers
     * cannot resolve each other's, so with no STUN and no TURN there is
     * nothing left to connect with and ICE sits in `checking` for ever. Real
     * participants are on different machines and reach each other over the
     * public internet; on one laptop this flag is what stands in for that.
     */
    "--disable-features=WebRtcHideLocalIpsWithMdns",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    `--window-position=${(index % 3) * 420},${Math.floor(index / 3) * 400}`,
    "--window-size=1280,900",
  ];
  if (!process.env.HEADED) args.push("--headless=new");
  const child = spawn(bin, args, { stdio: "ignore" });
  for (let i = 0; i < 150; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return { child, profile, bin, port };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Chrome never opened a debugging port on ${port}`);
}

/** The smallest CDP client that can drive one tab. */
function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let next = 1;
  const ready = new Promise((resolve, reject) => {
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
    ready,
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

async function openTab(browser, url) {
  const res = await fetch(`http://127.0.0.1:${browser.port}/json/list`);
  const list = await res.json();
  const target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!target) throw new Error(`no page target in browser on ${browser.port}`);
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable");
  // A laptop, not the 800x600 default: the join screen's two-column layout
  // and everything positioned against it only exist above the lg breakpoint.
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const console_ = [];
  return { cdp, target, console: console_, url };
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

/**
 * Collect every peer connection the page makes, before the page makes any.
 *
 * The alternative is for the product to hang a handle on `window` for the
 * benefit of this file, which is a production change made for a test. This
 * reaches the same objects from outside and the shipped code is untouched.
 */
const SPY = `
(() => {
  window.__pcs = [];
  window.__log = [];
  const Native = window.RTCPeerConnection;
  function Wrapped(...args) {
    const pc = new Native(...args);
    window.__pcs.push(pc);
    return pc;
  }
  Wrapped.prototype = Native.prototype;
  Wrapped.generateCertificate = Native.generateCertificate;
  window.RTCPeerConnection = Wrapped;

  /*
   * Every call to the meeting API, with the shape of the answer.
   *
   * "No peer connection was ever made" has two completely different causes -
   * the roster never named anybody, or it did and the client ignored it - and
   * nothing visible on screen tells them apart.
   */
  /*
   * The watcher hands the page back the browser's own promise, untouched, and
   * reads a clone of the body on the side. An earlier version awaited the
   * clone before returning - which inserted this file into the middle of every
   * long-poll in the product and stopped the room working at all. An
   * instrument that changes the thing it is measuring measures nothing.
   */
  window.__api = [];
  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    const url = String(args[0] && args[0].url ? args[0].url : args[0]);
    const promise = nativeFetch.apply(this, args);
    if (/\\/api\\/meet\\//.test(url)) {
      const short = url.replace(/^https?:\\/\\/[^/]+/, "");
      promise.then(
        (res) => {
          res
            .clone()
            .json()
            .then(
              (body) =>
                window.__api.push({
                  url: short,
                  status: res.status,
                  ok: body.ok,
                  error: body.error,
                  roster: Array.isArray(body.roster)
                    ? body.roster.map((r) => r.peerId.slice(0, 6) + ":" + r.role)
                    : undefined,
                  signals: Array.isArray(body.signals)
                    ? body.signals.map((s) => s.type)
                    : undefined,
                  me: body.me
                    ? { peerId: body.me.peerId.slice(0, 6), role: body.me.role, micOn: body.me.micOn, admitted: body.me.admitted }
                    : undefined,
                  waitingForHost: body.waitingForHost,
                  ended: body.ended,
                }),
              (e) => window.__api.push({ url: short, status: res.status, unreadable: String(e) }),
            );
        },
        (e) => window.__api.push({ url: short, failed: String(e) }),
      );
    }
    return promise;
  };

  for (const level of ["error", "warn", "info"]) {
    const was = console[level];
    console[level] = (...a) => {
      try {
        window.__log.push(level + ": " + a.map((x) => (typeof x === "string" ? x : (x && x.message) || String(x))).join(" "));
      } catch (e) { /* a value that would not stringify */ }
      was.apply(console, a);
    };
  }
})();
`;

/** What one tab can see: what it sends, and what it hears from each peer. */
const REPORT = `
(async () => {
  const out = { peers: [], log: window.__log.slice(-40), pcCount: window.__pcs.length, api: window.__api.slice(-14) };
  for (const pc of window.__pcs) {
    const entry = {
      signalling: pc.signalingState,
      ice: pc.iceConnectionState,
      senderAudioTrack: null,
      senderAudioEnabled: null,
      audioOut: { packetsSent: 0, bytesSent: 0 },
      audioIn: { packetsReceived: 0, bytesReceived: 0, concealed: 0, total: 0 },
      receiverTrackEnabled: null,
      receiverTrackMuted: null,
      mLineAudioLocal: null,
      mLineAudioRemote: null,
      transceiverDirections: [],
    };
    const grab = (sdp) => (sdp ? (sdp.match(/^m=audio [^\\r\\n]+/m) || [""])[0] : null);
    entry.mLineAudioLocal = grab(pc.localDescription && pc.localDescription.sdp);
    entry.mLineAudioRemote = grab(pc.remoteDescription && pc.remoteDescription.sdp);

    for (const tr of pc.getTransceivers()) {
      entry.transceiverDirections.push(
        (tr.mid === null ? "?" : tr.mid) + ":" + (tr.receiver.track ? tr.receiver.track.kind : "-") +
        ":" + tr.direction + "/" + (tr.currentDirection || "-"),
      );
      if (tr.receiver.track && tr.receiver.track.kind === "audio") {
        entry.receiverTrackEnabled = tr.receiver.track.enabled;
        entry.receiverTrackMuted = tr.receiver.track.muted;
      }
      if (tr.sender.track && tr.sender.track.kind === "audio") {
        entry.senderAudioTrack = tr.sender.track.id.slice(0, 8);
        entry.senderAudioEnabled = tr.sender.track.enabled;
      }
    }

    const stats = await pc.getStats();
    stats.forEach((r) => {
      if (r.type === "outbound-rtp" && r.kind === "audio") {
        entry.audioOut.packetsSent = r.packetsSent || 0;
        entry.audioOut.bytesSent = r.bytesSent || 0;
      }
      if (r.type === "inbound-rtp" && r.kind === "audio") {
        entry.audioIn.packetsReceived = r.packetsReceived || 0;
        entry.audioIn.bytesReceived = r.bytesReceived || 0;
        entry.audioIn.concealed = r.concealedSamples || 0;
        entry.audioIn.total = r.totalSamplesReceived || 0;
      }
    });
    out.peers.push(entry);
  }

  // What the room thinks is going on, read off the DOM rather than from any
  // handle the product exported for us.
  const audios = [...document.querySelectorAll("audio")];
  out.audioSinks = audios.map((el) => ({
    paused: el.paused,
    muted: el.muted,
    volume: el.volume,
    tracks: el.srcObject ? el.srcObject.getTracks().map((t) => t.kind + (t.enabled ? "+" : "-") + (t.muted ? "m" : "")) : null,
  }));
  out.bodyText = (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 240);
  out.micButton = (() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      /mute|unmute|microphone/i.test(x.getAttribute("aria-label") || x.title || ""),
    );
    return b ? { label: b.getAttribute("aria-label") || b.title, disabled: b.disabled } : null;
  })();
  return out;
})()
`;

/* --------------------------------------------------------------- the driver */

/** Type into a React-controlled input the way a person does. */
/**
 * Type into a React-controlled input, and check that it took.
 *
 * `Input.insertText` goes to whatever is focused, and focus is not always
 * where it was just put — three browsers starting at once, a page still
 * hydrating. When it goes nowhere the field stays empty, and because the field
 * is `required` the browser then refuses to submit the form at all: the Join
 * button is pressed, nothing happens, no request is made, and the only clue is
 * an api log with nothing in it. So this verifies rather than assumes.
 */
async function typeInto(cdp, selector, text) {
  const sel = JSON.stringify(selector);
  for (let attempt = 1; attempt <= 5; attempt++) {
    // Wait for React to have claimed the element. Typing into server-rendered
    // HTML sets a value that hydration then throws away.
    await waitFor(
      cdp,
      `(() => { const el = document.querySelector(${sel});
                return el && Object.keys(el).some((k) => k.startsWith("__react")); })()`,
      `${selector} to be hydrated`,
      20000,
    );
    await evaluate(
      cdp,
      `(() => { const el = document.querySelector(${sel});
                el.focus();
                el.setSelectionRange(0, el.value.length);
                return true; })()`,
    );
    await cdp.send("Input.insertText", { text });
    const value = await evaluate(cdp, `document.querySelector(${sel}).value`);
    if (value === text) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`could not type "${text}" into ${selector}`);
}

/**
 * Press a button with real mouse events at its real coordinates.
 *
 * `element.click()` is not enough across this codebase - anything built on
 * Radix opens on pointerdown and never sees a synthetic click - so the harness
 * does what a finger does, and works whatever the button turns out to be.
 */
async function press(cdp, predicate) {
  const box = await evaluate(
    cdp,
    `(() => {
       const buttons = [...document.querySelectorAll("button, [role=button]")];
       const el = buttons.find(${predicate});
       if (!el) return null;
       el.scrollIntoView({ block: "center" });
       const r = el.getBoundingClientRect();
       return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: el.textContent.trim().slice(0, 40), disabled: !!el.disabled };
     })()`,
  );
  if (!box) throw new Error("no button matched");
  if (box.disabled) throw new Error(`button "${box.text}" is disabled`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x: box.x,
      y: box.y,
      button: "left",
      clickCount: 1,
      buttons: type === "mousePressed" ? 1 : 0,
    });
  }
  return box.text;
}

async function waitFor(cdp, expression, what, ms = 25000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, `!!(${expression})`)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/* ------------------------------------------------------------------ the run */

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const { rows: churches } = await db.query(
  "select id, name from church order by created_at limit 1",
);
if (churches.length === 0) {
  console.log("No church in this database - nothing to join.");
  process.exit(0);
}
const church = churches[0];

const code = `zzz-call-${Date.now().toString(36).slice(-3)}`.slice(0, 20);
const hostKey = `hk-${Date.now().toString(36)}-call`;
const { rows: made } = await db.query(
  `insert into meeting (church_id, code, title, kind, status, access, allow_chat,
                        allow_recording, max_participants, host_key, mute_on_entry,
                        low_data_default)
   values ($1, $2, 'Audio matrix test', 'prayer', 'scheduled', 'open', true, true, 12, $3, false, false)
   returning id, code, allow_attendee_mic, allow_attendee_camera, mute_on_entry`,
  [church.id, code, hostKey],
);
const meeting = made[0];
console.log(`Church: ${church.name}`);
console.log(
  `Meeting ${meeting.code} - attendee mic: ${meeting.allow_attendee_mic}, ` +
    `attendee camera: ${meeting.allow_attendee_camera}, mute on entry: ${meeting.mute_on_entry}\n`,
);

const browsers = [];
const tabs = [];

try {
  for (let i = 0; i < PEOPLE; i++) {
    const isHost = i === 0;
    const url = `${BASE}/meet/${meeting.code}${isHost ? `?h=${hostKey}` : ""}`;
    const browser = await launchBrowser(i);
    browsers.push(browser);
    const tab = await openTab(browser, url);
    tab.name = NAMES[i];
    tab.order = i + 1;
    tab.isHost = isHost;
    tabs.push(tab);

    await tab.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SPY });
    await tab.cdp.send("Page.navigate", { url });
    await waitFor(
      tab.cdp,
      `document.querySelector("#join-name")`,
      `${tab.name}'s join screen`,
    );
    await typeInto(tab.cdp, "#join-name", tab.name);

    /*
     * Wait for the join screen to have finished opening its devices.
     *
     * It asks for the microphone and camera on mount and holds the rest of
     * itself back until that settles. Pressing Join in the middle of that is
     * how three browsers on one laptop produced a run where somebody never got
     * into the room: the press landed, the handler had a half-built state, and
     * the screen simply stayed put. Waiting for the preview to be carrying
     * something is the signal; the timeout is generous because three browsers
     * contending for one fake camera are slower than one.
     */
    await waitFor(
      tab.cdp,
      `[...document.querySelectorAll("video")].some((v) => v.srcObject)`,
      `${tab.name}'s camera preview`,
      20000,
    ).catch((e) => console.log(`      (${tab.name}: ${e.message}; pressing anyway)`));

    /*
     * And press until it takes. A join is one POST; if it is refused or lost
     * the screen stays where it is, and a harness that gave up at that point
     * would report a product bug that is really a busy laptop.
     */
    let pressed = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      pressed = await press(tab.cdp, `(b) => /join/i.test(b.textContent) && !b.disabled`);
      const inside = await waitFor(
        tab.cdp,
        `document.querySelector("#join-name") === null`,
        `${tab.name} to get past the join screen`,
        10000,
      ).then(
        () => true,
        () => false,
      );
      if (inside) break;
      if (attempt === 3) {
        // Say why, rather than just that. A join that will not take is either
        // the product refusing it or the harness mistiming it, and the answer
        // is in the response the page got.
        const why = await evaluate(
          tab.cdp,
          `JSON.stringify({ screen: (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 300), api: window.__api, log: window.__log })`,
        );
        console.log(`      ${tab.name} could not join: ${why}`);
        throw new Error(`${tab.name} never got past the join screen after 3 presses`);
      }
      console.log(`      (${tab.name}: the join did not take; pressing again)`);
    }
    console.log(`  ${tab.order}. ${tab.name}${isHost ? " (host)" : ""} joined - pressed "${pressed}"`);
    // Staggered, because join order is the one detail the bug report gave.
    await new Promise((r) => setTimeout(r, 2500));
  }

  console.log(`\nAll ${PEOPLE} in the room. Listening for ${SECONDS}s...`);
  await new Promise((r) => setTimeout(r, SECONDS * 1000));

  /*
   * Then wait for the room to be finished negotiating.
   *
   * A connection that was thrown away and dialled again takes a second or two
   * to come back, and measuring in the middle of that reports a call as broken
   * when what it is, is recovering. The question worth asking is whether the
   * room CONVERGES — so this waits for every connection in every browser to be
   * settled and connected, and fails if it never is. How long it took is
   * printed, because a room that needs twenty seconds to settle is a different
   * animal from one that needs none, even though both end up working.
   */
  const settleDeadline = Date.now() + SETTLE_MS;
  let settledAfter = null;
  const startedSettling = Date.now();
  while (Date.now() < settleDeadline) {
    const states = [];
    for (const tab of tabs) {
      states.push(
        await evaluate(
          tab.cdp,
          `JSON.stringify(window.__pcs.filter((pc) => pc.signalingState !== "closed")
             .map((pc) => pc.signalingState + "/" + pc.iceConnectionState))`,
        ),
      );
    }
    const all = states.flatMap((s) => JSON.parse(s));
    const ready =
      all.length === PEOPLE * (PEOPLE - 1) &&
      all.every((s) => s === "stable/connected" || s === "stable/completed");
    if (ready) {
      settledAfter = Date.now() - startedSettling;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(
    settledAfter === null
      ? `The room never settled within ${SETTLE_MS / 1000}s.\n`
      : `Settled after a further ${(settledAfter / 1000).toFixed(1)}s.\n`,
  );

  /* ----------------------------------------------------------- the matrix */

  const reports = [];
  for (const tab of tabs) {
    reports.push({ tab, report: await evaluate(tab.cdp, REPORT) });
  }

  console.log("Each person, and every connection they hold:\n");
  for (const { tab, report } of reports) {
    console.log(`  ${tab.order}. ${tab.name}${tab.isHost ? " (host)" : ""} - ${report.pcCount} connection(s)`);
    if (report.pcCount === 0) console.log("      (none - this tab never made a peer connection)");
    report.peers.forEach((p, n) => {
      const heard = p.audioIn.bytesReceived;
      const sent = p.audioOut.bytesSent;
      console.log(
        `      [${n}] ice=${p.ice} sig=${p.signalling}  ` +
          `sending: ${p.senderAudioTrack ? `track ${p.senderAudioTrack} enabled=${p.senderAudioEnabled}` : "NO AUDIO TRACK"}  ` +
          `out=${sent}B/${p.audioOut.packetsSent}pkt  in=${heard}B/${p.audioIn.packetsReceived}pkt  ` +
          `remote track enabled=${p.receiverTrackEnabled} muted=${p.receiverTrackMuted}`,
      );
      console.log(`           local  m=audio: ${p.mLineAudioLocal}`);
      console.log(`           remote m=audio: ${p.mLineAudioRemote}`);
      console.log(`           transceivers:   ${p.transceiverDirections.join("  ")}`);
    });
    console.log(
      `      audio sinks: ${JSON.stringify(report.audioSinks)}  mic button: ${JSON.stringify(report.micButton)}`,
    );
    console.log(`      screen says: ${report.bodyText}`);
    console.log("      meeting API calls:");
    for (const c of report.api ?? []) console.log(`        ${c.status} ${c.url} ${JSON.stringify({ ok: c.ok, error: c.error, me: c.me, roster: c.roster, signals: c.signals, waitingForHost: c.waitingForHost, unreadable: c.unreadable })}`);
    if (report.log.length) {
      console.log("      what the page logged:");
      for (const l of report.log.slice(-20)) console.log(`        ${l}`);
    }
    console.log("");
  }

  /* ---------------------------------------------------------- the verdicts */

  console.log("Verdicts:\n");
  for (const { tab, report } of reports) {
    const expected = PEOPLE - 1;

    /*
     * Live connections only.
     *
     * A connection that was thrown away and dialled again leaves the closed
     * one behind in `window.__pcs`, carrying no bytes because it is shut. The
     * first version of these verdicts counted it, so a call that had recovered
     * from a rebuild and was working perfectly was reported as "2 of 3
     * connections carried audio" — the harness grading its own history rather
     * than the meeting in front of it. How many rebuilds happened is worth
     * knowing, and is reported separately rather than failed on.
     */
    const open = report.peers.filter((p) => p.signalling !== "closed");
    const discarded = report.peers.length - open.length;
    ok(
      `${tab.name} holds a live connection to each of the other ${expected}`,
      open.length === expected,
      `${open.length} live${discarded ? `, ${discarded} rebuilt and discarded` : ""}`,
    );
    const sending = open.filter((p) => p.audioOut.bytesSent > 500);
    ok(
      `${tab.name}'s microphone is reaching every peer`,
      open.length > 0 && sending.length === open.length,
      `${sending.length} of ${open.length} live connections carried audio out`,
    );
    const hearing = open.filter((p) => p.audioIn.bytesReceived > 500);
    ok(
      `${tab.name} can hear every peer`,
      open.length > 0 && hearing.length === open.length,
      `${hearing.length} of ${open.length} live connections carried audio in`,
    );
    const live = open.filter((p) => p.receiverTrackEnabled === true);
    ok(
      `${tab.name}'s remote audio tracks are all enabled`,
      open.length > 0 && live.length === open.length,
      `${live.length} of ${open.length} enabled`,
    );
    const playing = (report.audioSinks ?? []).filter((s) => !s.paused && !s.muted);
    ok(
      `${tab.name} has an unmuted, playing audio element per peer`,
      playing.length === expected,
      `${playing.length} playing of ${(report.audioSinks ?? []).length} sinks`,
    );
  }
} finally {
  for (const tab of tabs) tab.cdp.close();
  if (!process.env.KEEP) {
    for (const b of browsers) b.child.kill();
    // Chrome holds its crash-metrics file open for a moment after it is told
    // to go, so removing the profile immediately fails on Windows with EBUSY.
    await new Promise((r) => setTimeout(r, 1500));
    for (const b of browsers) {
      // A few megabytes per person per run: left behind they add up to real disk.
      await rm(b.profile, { recursive: true, force: true }).catch((e) =>
        console.warn(`could not remove ${b.profile}: ${e.message}`),
      );
    }
  } else {
    console.log(
      `\nLeft ${browsers.length} browser(s) open: ${browsers
        .map((b) => `http://127.0.0.1:${b.port}`)
        .join(" ")}`,
    );
  }
  await db
    .query("update meeting set status = 'ended' where id = $1", [meeting.id])
    .catch((e) => console.warn(`could not end the test meeting: ${e.message}`));
  await db.end();
}

console.log(`\n${failures === 0 ? "All clear." : `${failures} failing check(s).`}`);
process.exitCode = failures === 0 ? 0 : 1;
