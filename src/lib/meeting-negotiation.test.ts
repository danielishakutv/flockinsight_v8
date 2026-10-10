import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingClient } from "@/lib/meeting-client";
import { isPolite, type MeetingRole, type RosterEntry } from "@/lib/meetings-shared";

/**
 * Who offers, and what happens when an offer goes nowhere.
 *
 * This file exists because of a meeting in which one person could be heard and
 * nobody else could. Everything that is usually worth looking at was fine: the
 * roster was right, every tile was lit, ICE was connected, chat worked, and the
 * video was perfect. What had happened was that two peers decided to
 * renegotiate their audio at the same moment — which they do, because they are
 * both measuring the same bad link — and each collision rolled an offer back.
 * Rollbacks leave transceivers behind, so after a few the two sides no longer
 * agreed on the order of their m-lines, and from then on every description
 * either one built was refused by the other:
 *
 *     The order of m-lines in answer doesn't match order in offer
 *
 * The connection then sat in `have-local-offer` for the rest of the call with
 * one direction of audio dead. Nothing threw where a person could see it.
 *
 * The three rules below are what prevent and recover that, and all three are
 * the kind that look like pedantry right up until they do not:
 *
 *   one nominated offerer per pair, so the collision cannot happen;
 *   a description for a negotiation that has moved on is dropped, not applied;
 *   a connection that stops negotiating at all is thrown away and dialled again.
 *
 * `scripts/test-meeting-call.mjs` is the other half of this: three real
 * browsers in one real meeting, which is where the bug was actually caught and
 * is the only place the browser's own SDP machinery is in the loop. This file
 * is the fast half — it pins the decisions, not the renegotiation itself.
 */

/* ============================================================
 * A peer connection that enforces the state machine
 * ========================================================== */

/**
 * The point of this fake is that it REFUSES things, the way Chrome does.
 *
 * A permissive fake would have passed every version of this code, including
 * the one that shipped. So `setRemoteDescription` throws on an answer that
 * arrives out of state, with the browser's own wording, because that sentence
 * is the whole subject of the second rule.
 */
const SDP = [
  "v=0",
  "o=- 0 0 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:63 red/48000/2",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "a=rtpmap:96 VP8/90000",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "a=rtpmap:96 VP8/90000",
  "",
].join("\r\n");

type Pc = RTCPeerConnection & {
  /** Drive the state machine the way a browser's own answer would. */
  fakeAnswerOurOffer: () => Promise<void>;
};

/** Node has no MediaStream, and the engine keeps one per peer. */
class FakeMediaStream {
  private tracks: MediaStreamTrack[];
  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks = () => this.tracks;
  getAudioTracks = () => this.tracks.filter((t) => t.kind === "audio");
  getVideoTracks = () => this.tracks.filter((t) => t.kind === "video");
  addTrack = (t: MediaStreamTrack) => {
    if (!this.tracks.includes(t)) this.tracks.push(t);
  };
  removeTrack = (t: MediaStreamTrack) => {
    this.tracks = this.tracks.filter((x) => x !== t);
  };
}

const pcs: Pc[] = [];

/** A writable view of a peer connection, whose real properties are read-only. */
function mutable(pc: Pc) {
  return pc as unknown as {
    signalingState: RTCSignalingState;
    localDescription: RTCSessionDescription | null;
    remoteDescription: RTCSessionDescription | null;
  };
}

function transceiver(kind: "audio" | "video", mid: string) {
  const track = { kind, enabled: true, id: `t-${mid}`, muted: true } as MediaStreamTrack;
  return {
    mid,
    direction: "sendrecv",
    currentDirection: null,
    stop: () => {},
    sender: {
      track: null as MediaStreamTrack | null,
      replaceTrack(next: MediaStreamTrack | null) {
        this.track = next;
        return Promise.resolve();
      },
      getParameters: () => ({ encodings: [{}] }),
      setParameters: () => Promise.resolve(),
    },
    receiver: { track, jitterBufferTarget: null, playoutDelayHint: null },
  } as unknown as RTCRtpTransceiver;
}

function fakePc(): Pc {
  const transceivers: RTCRtpTransceiver[] = [];
  let signalingState: RTCSignalingState = "stable";
  let pending = false;
  let mid = 0;

  const pc = {
    signalingState,
    iceConnectionState: "connected" as RTCIceConnectionState,
    connectionState: "connected" as RTCPeerConnectionState,
    localDescription: null as RTCSessionDescription | null,
    remoteDescription: null as RTCSessionDescription | null,
    onicecandidate: null as ((e: RTCPeerConnectionIceEvent) => void) | null,
    ontrack: null as ((e: RTCTrackEvent) => void) | null,
    onnegotiationneeded: null as (() => void) | null,
    oniceconnectionstatechange: null as (() => void) | null,
    onsignalingstatechange: null as (() => void) | null,

    addTransceiver(kind: "audio" | "video") {
      const t = transceiver(kind, String(mid++));
      transceivers.push(t);
      /*
       * And raise `negotiationneeded`, as a browser does — once for the batch,
       * on a later turn. Without this the fake never asks for a first offer,
       * and every test here would run against a connection that had quietly
       * skipped the negotiation it was supposed to be about.
       */
      if (!pending) {
        pending = true;
        setTimeout(() => {
          pending = false;
          if (pc.signalingState === "stable") pc.onnegotiationneeded?.call(pc, new Event("x"));
        }, 0);
      }
      return t;
    },
    getTransceivers: () => transceivers,
    getStats: () => Promise.resolve(new Map()),
    addIceCandidate: () => Promise.resolve(),
    restartIce: () => {},
    close() {
      set("closed");
    },

    createOffer: () => Promise.resolve({ type: "offer" as const, sdp: SDP }),
    createAnswer: () => Promise.resolve({ type: "answer" as const, sdp: SDP }),

    setLocalDescription(d: RTCSessionDescriptionInit) {
      if (d.type === "offer") {
        if (pc.signalingState !== "stable")
          throw new Error(`Called in wrong state: ${pc.signalingState}`);
        set("have-local-offer");
      } else {
        if (pc.signalingState !== "have-remote-offer")
          throw new Error(`Called in wrong state: ${pc.signalingState}`);
        set("stable");
      }
      // Through a mutable view: the real properties are read-only, and the
      // whole point of this object is to be written to.
      mutable(pc).localDescription = {
        ...d,
        toJSON: () => ({ type: d.type, sdp: d.sdp }),
      } as unknown as RTCSessionDescription;
      return Promise.resolve();
    },

    setRemoteDescription(d: RTCSessionDescriptionInit) {
      if (d.type === "offer") {
        // An offer is accepted from "stable", and from "have-local-offer" via
        // the implicit rollback every current browser does.
        set("have-remote-offer");
      } else {
        if (pc.signalingState !== "have-local-offer")
          throw new Error(
            `Failed to set remote answer sdp: Called in wrong state: ${pc.signalingState}`,
          );
        set("stable");
      }
      mutable(pc).remoteDescription = d as RTCSessionDescription;
      return Promise.resolve();
    },

    fakeAnswerOurOffer() {
      return pc.setRemoteDescription({ type: "answer", sdp: SDP });
    },
  } as unknown as Pc;

  function set(next: RTCSignalingState) {
    signalingState = next;
    mutable(pc).signalingState = next;
    pc.onsignalingstatechange?.call(pc as unknown as RTCPeerConnection, new Event("x"));
  }

  pcs.push(pc);
  return pc;
}

/* ============================================================
 * The room around it
 * ========================================================== */

/** Every request body the engine posted, newest last. */
let posted: Record<string, unknown>[] = [];
let serverSays: Record<string, unknown>;
let started: MeetingClient[] = [];

function person(peerId: string, role: MeetingRole = "attendee"): RosterEntry {
  return {
    id: `p-${peerId}`,
    peerId,
    name: peerId,
    role,
    micOn: true,
    cameraOn: false,
    sharing: false,
    handRaised: false,
    lowData: false,
    quality: "good",
    admitted: true,
    sfuSessionId: null,
    joinedAt: new Date().toISOString(),
    userId: null,
  };
}

/** The signals this engine has sent to one peer, in order. */
function signalsTo(peerId: string): { type: string; payload: Record<string, unknown> }[] {
  const out: { type: string; payload: Record<string, unknown> }[] = [];
  for (const body of posted) {
    for (const s of (body.signals as { to?: string; type: string; payload: Record<string, unknown> }[]) ?? []) {
      if (s.to === peerId) out.push({ type: s.type, payload: s.payload ?? {} });
    }
  }
  return out;
}

beforeEach(() => {
  pcs.length = 0;
  posted = [];
  serverSays = { ok: true };

  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [],
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      })),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  /*
   * A plain function, not an arrow: the engine calls `new RTCPeerConnection`,
   * and an arrow function is not a constructor. A constructor returning an
   * object hands that object back, which is what makes this work.
   */
  vi.stubGlobal("RTCPeerConnection", function RTCPeerConnectionStub() {
    return fakePc();
  });
  vi.stubGlobal("MediaStream", FakeMediaStream);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { body?: string; signal?: AbortSignal }) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      posted.push(body);
      // Held open, as the real long-poll is: a fake that answers at once turns
      // the listen loop into a hot loop and starves the test. The abort is
      // honoured because the engine aborts on shutdown, and a fake that
      // ignored that would let a stopped engine answer into the next test.
      if (body.wait === true) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 30_000);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      return { ok: true, status: 200, json: async () => serverSays };
    }),
  );
});

afterEach(async () => {
  for (const engine of started) await engine.stop();
  started = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * An engine in a room with one other person, with the connection negotiated.
 *
 * `myPeerId` and `theirPeerId` are chosen by the caller because politeness is
 * derived from the pair — which is the whole mechanism under test.
 */
async function inACall(myPeerId: string, theirPeerId: string) {
  const rebuilt: string[] = [];
  const engine = new MeetingClient({
    code: "abcdef",
    peerId: myPeerId,
    secret: "secret",
    cursor: 0,
    iceServers: [],
    lowData: false,
    role: "attendee",
    events: { onPeerRebuilt: (peerId) => rebuilt.push(peerId) },
  });
  engine.start();
  started.push(engine);

  /*
   * The roster is what makes the engine dial — `reconcilePeers` works from it,
   * not from join events. The first poll is a long one that this fake holds
   * open for thirty seconds, so a state push is what gets an answer back now:
   * it goes to the same endpoint with `wait: false` and carries the roster.
   */
  serverSays = { ok: true, roster: [person(myPeerId), person(theirPeerId)] };
  poke(engine);
  await vi.waitFor(() => expect(pcs.length).toBe(1));
  const pc = pcs[0];

  // Settle whichever half of the first negotiation this side owns, so the
  // connection starts the test where a real one would: stable.
  await vi.waitFor(() => expect(pc.signalingState).not.toBe("closed"));
  if (pc.signalingState === "have-local-offer") await pc.fakeAnswerOurOffer();
  expect(pc.signalingState).toBe("stable");

  posted = [];
  return { engine, pc, rebuilt, theirPeerId };
}

/**
 * Make the engine take a poll NOW rather than waiting out the hold.
 *
 * A state push goes to the same endpoint with `wait: false`, so whatever
 * `serverSays` currently holds comes straight back. The value is alternated
 * because an unchanged one is a push the engine is entitled to coalesce.
 */
let pokes = 0;
function poke(engine: MeetingClient) {
  engine.setHandRaised(pokes++ % 2 === 0);
}

/**
 * Move the clock on without moving the timers.
 *
 * A connection is not rebuilt for the voice within a minute of the last time —
 * the cooldown that stops a link sitting on a boundary spending that second
 * over and over. Only `Date` is faked, so the long-poll, the send debounce and
 * every `await` in here still behave normally; a test that faked all the
 * timers would have to drive the engine's whole clock by hand.
 */
function jumpPastTheCooldown() {
  const now = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now + 61_000));
}

/** Hand the engine a signal as though it had arrived on the next poll. */
function deliver(
  engine: MeetingClient,
  from: string,
  type: string,
  payload: Record<string, unknown> = {},
) {
  serverSays = {
    ok: true,
    signals: [
      {
        id: 1,
        fromPeer: from,
        toPeer: null,
        type,
        payload,
        at: new Date().toISOString(),
      },
    ],
  };
  poke(engine);
}

/**
 * An engine whose own first offer is still outstanding.
 *
 * `inACall` settles it, because most tests want a working connection. This
 * one does not: a collision only exists while an offer is in flight.
 */
async function midFirstOffer(myPeerId: string, theirPeerId: string) {
  const engine = new MeetingClient({
    code: "abcdef",
    peerId: myPeerId,
    secret: "secret",
    cursor: 0,
    iceServers: [],
    lowData: false,
    role: "attendee",
    events: {},
  });
  engine.start();
  started.push(engine);

  serverSays = { ok: true, roster: [person(myPeerId), person(theirPeerId)] };
  poke(engine);
  await vi.waitFor(() => expect(pcs.length).toBe(1));
  const pc = pcs[0];
  await vi.waitFor(() => expect(pc.signalingState).toBe("have-local-offer"));
  posted = [];
  return { engine, pc, theirPeerId };
}

/** Mirrors PEER_RESET_LIMIT in meeting-client.ts. */
const PEER_RESET_LIMIT = 3;

/* ============================================================
 * A change of voice is a new connection
 * ========================================================== */

describe("the voice wanting a different shape mid-call", () => {
  /*
   * "aaa" and "zzz" are picked so the pair's politeness is known and asserted
   * rather than assumed — if `isPolite` ever changes its mind, these fail
   * loudly instead of quietly testing the opposite thing.
   */
  it("rebuilds the connection rather than renegotiating it", async () => {
    expect(isPolite("aaa", "zzz")).toBe(false);
    const { engine, pc } = await inACall("aaa", "zzz");

    // Data Saver changes the Opus shape, which is the one thing that cannot be
    // altered at runtime and so is the only reason the shape ever changes.
    jumpPastTheCooldown();
    await engine.setLowData(true);

    await vi.waitFor(() =>
      expect(signalsTo("zzz").map((s) => s.type)).toContain("renegotiate"),
    );
    // Not a second offer on the old connection. That is the whole fix.
    expect(signalsTo("zzz").map((s) => s.type)).not.toContain("offer");
    expect(pc.signalingState).toBe("closed");
  });

  it("is started by one side of the pair only", async () => {
    /*
     * Both ends measure the same link and reach the same verdict at the same
     * moment, so "whoever notices first" would mean both — and both tearing
     * the connection down at once is two rebuilds where one would do.
     */
    expect(isPolite("zzz", "aaa")).toBe(true);
    const { engine, pc } = await inACall("zzz", "aaa");

    jumpPastTheCooldown();
    await engine.setLowData(true);
    await new Promise((r) => setTimeout(r, 80));

    expect(signalsTo("aaa").map((s) => s.type)).not.toContain("renegotiate");
    expect(signalsTo("aaa").map((s) => s.type)).not.toContain("offer");
    expect(pc.signalingState).toBe("stable");
  });

  it("does not do it twice for one change", async () => {
    /*
     * A rebuild costs that pair a second of silence, and the link verdict is
     * re-read every four seconds. Without the cooldown a link sitting on the
     * boundary between "fair" and "good" would spend that second over and
     * over for the length of the meeting.
     */
    const { engine } = await inACall("aaa", "zzz");

    jumpPastTheCooldown();
    await engine.setLowData(true);
    await vi.waitFor(() =>
      expect(signalsTo("zzz").filter((s) => s.type === "renegotiate").length).toBe(1),
    );

    // Back and forth again, still inside the minute.
    await engine.setLowData(false);
    await engine.setLowData(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(signalsTo("zzz").filter((s) => s.type === "renegotiate").length).toBe(1);
  });
});

/* ============================================================
 * Descriptions that arrive too late
 * ========================================================== */

describe("a description for a negotiation that has moved on", () => {
  it("is dropped rather than applied", async () => {
    /*
     * An answer to an offer that was rolled back turns up a moment later.
     * Handing it to `setRemoteDescription` throws "Called in wrong state:
     * stable" — which was caught, logged where nobody was looking, and left
     * the connection to be sorted out by nothing at all.
     */
    const { engine, pc } = await inACall("aaa", "zzz");
    expect(pc.signalingState).toBe("stable");

    deliver(engine, "zzz", "answer", { sdp: { type: "answer", sdp: SDP } });
    await new Promise((r) => setTimeout(r, 60));

    // Still stable, still usable, and no answer was forced into it.
    expect(pc.signalingState).toBe("stable");
  });

  it("leaves a colliding offer to the polite side, as perfect negotiation says", async () => {
    // Left mid-negotiation on purpose: the engine is the initiator here, so
    // its own first offer is outstanding and an incoming one collides with it.
    const { engine, pc } = await midFirstOffer("aaa", "zzz");
    expect(pc.signalingState).toBe("have-local-offer");

    deliver(engine, "zzz", "offer", { sdp: { type: "offer", sdp: SDP } });
    await new Promise((r) => setTimeout(r, 60));

    // We are impolite: we keep ours and ignore theirs, so no answer goes back.
    expect(pc.signalingState).toBe("have-local-offer");
    expect(signalsTo("zzz").map((s) => s.type)).not.toContain("answer");
  });
});

/* ============================================================
 * Getting out of a wedge
 * ========================================================== */

describe("a connection that stops negotiating", () => {
  it("is thrown away when the other side says it has dropped its own", async () => {
    /*
     * Both ends have to forget it. A fresh offer meeting the old, disordered
     * connection is refused for the same reason the last one was, so the peer
     * that gives up tells the other to drop its side too — and the next roster
     * poll dials them again from nothing.
     */
    const { engine, pc, theirPeerId } = await inACall("aaa", "zzz");
    const before = pcs.length;

    // Older than the grace window, so the request is about THIS connection
    // rather than one it replaced. See the test below.
    jumpPastTheCooldown();
    deliver(engine, theirPeerId, "renegotiate");
    await vi.waitFor(() => expect(pc.signalingState).toBe("closed"));

    // And the roster brings it straight back, rather than leaving a hole.
    serverSays = { ok: true, roster: [person("aaa"), person("zzz")] };
    poke(engine);
    await vi.waitFor(() => expect(pcs.length).toBeGreaterThan(before));
  });

  it("ignores a request that was written about the connection before it", async () => {
    /*
     * Both sides of a broken pair notice at the same moment, so both ask the
     * other to start again and both do. The second request then lands on the
     * connection that has just replaced the one it was about — and acting on
     * it throws away something that works, which produces another request, and
     * another. Measured as a pair ping-ponging ten rebuilds deep before the
     * cap stopped it, with one direction dead at the end.
     */
    const { engine, pc, theirPeerId } = await inACall("aaa", "zzz");

    // No clock jump: this connection is milliseconds old.
    deliver(engine, theirPeerId, "renegotiate");
    await new Promise((r) => setTimeout(r, 80));

    expect(pc.signalingState).toBe("stable");
  });

  it("is not rebuilt for ever", async () => {
    /*
     * A connection that cannot be negotiated three times running has
     * something else wrong with it, and rebuilding without end turns a bad
     * link into a permanent reconnect loop.
     */
    const { engine } = await inACall("aaa", "zzz");

    for (let round = 0; round < PEER_RESET_LIMIT + 2; round++) {
      jumpPastTheCooldown();
      await engine.setLowData(round % 2 === 0);
      await new Promise((r) => setTimeout(r, 60));
      // The roster dials the peer again, and its first offer is answered, so
      // the replacement connection is settled and eligible to be rebuilt in
      // its turn. A connection still mid-negotiation is never rebuilt — which
      // is right, and would otherwise make this loop test nothing.
      serverSays = { ok: true, roster: [person("aaa"), person("zzz")] };
      poke(engine);
      await new Promise((r) => setTimeout(r, 60));
      const latest = pcs[pcs.length - 1];
      if (latest.signalingState === "have-local-offer") await latest.fakeAnswerOurOffer();
    }

    expect(signalsTo("zzz").filter((s) => s.type === "renegotiate").length).toBe(
      PEER_RESET_LIMIT,
    );
  });
});
