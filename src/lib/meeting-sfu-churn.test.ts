import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SfuTransport } from "@/lib/meeting-sfu";
import { audioProfileFor, type RosterEntry } from "@/lib/meetings-shared";

/**
 * What a room costs after people have come and gone for an hour.
 *
 * This file exists because of a meeting that was reported as "once in a while
 * some devices just hang with a black screen, their audio drops and the call
 * ends for them until it unfreezes". The room it happened in had eleven people
 * in it at its peak and FORTY-EIGHT joins — so most of what the browser was
 * holding belonged to people who were no longer there.
 *
 * On the SFU every voice is pulled over one subscriber connection, and each
 * pull adds a transceiver to it. `dropUnwatched` reclaims cameras, but it
 * skips anybody who has left the room entirely:
 *
 *     if (!live.has(who.peerId)) continue;
 *
 * and it never looks at microphones at all. So a peer who leaves takes nothing
 * with them: their audio transceiver, its decoder and its jitter buffer stay
 * for the rest of the meeting, pointed at a Cloudflare session that has gone.
 * Every rejoin is a fresh peer id and therefore a fresh pull, so the cost does
 * not plateau — it grows with CHURN rather than with the size of the room,
 * which is why a long, flaky meeting degrades and a short one never does.
 *
 * What the tests below pin is the shape of that cost: what is still attached
 * after the churn, and how big the SDP has become. They are deliberately about
 * accounting rather than about audio, because accounting is the thing that can
 * be measured without a media server.
 */

/* ============================================================
 * A Cloudflare that behaves
 * ========================================================== */

/** Every mid the fake SFU has been asked to close. */
let closedMids: string[] = [];
/** Every action the transport sent, in order. */
let calls: { action: string; body: Record<string, unknown> }[] = [];
/** How many m-lines the last answer we sent back contained. */
let lastAnswerMLines = 0;

let midCounter = 0;

function sdpWith(mLines: number): string {
  const head = ["v=0", "o=- 0 0 IN IP4 127.0.0.1", "s=-", "t=0 0"];
  const media: string[] = [];
  for (let i = 0; i < mLines; i++) {
    media.push(
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10;useinbandfec=1",
      `a=mid:${i}`,
    );
  }
  return [...head, ...media, ""].join("\r\n");
}

/**
 * The fake answers a pull the way Cloudflare does: one entry per requested
 * track, in the order requested, each with the mid it allocated.
 */
function fakeApi() {
  /*
   * A session holds a set of mids. Closing one frees it, and the next pull
   * takes the lowest free mid before allocating a new one — which is the
   * behaviour that matters here, because it is what decides whether the
   * description describes the room or the whole history of the meeting. A fake
   * that only ever allocated upwards would make the fix look like it had
   * changed nothing.
   */
  let highWater = 0;
  const free: number[] = [];
  const open = new Set<number>();

  return async (action: string, body: Record<string, unknown>) => {
    calls.push({ action, body });
    if (action === "session") return { sessionId: `s-${++midCounter}` };
    if (action === "publish") {
      return { sessionDescription: { type: "answer", sdp: sdpWith(1) } };
    }
    if (action === "pull") {
      const tracks = (body.tracks as { trackName: string }[]) ?? [];
      const out = tracks.map((t) => {
        const mid = free.length > 0 ? (free.shift() as number) : highWater++;
        open.add(mid);
        return { mid: String(mid), trackName: t.trackName };
      });
      return {
        tracks: out,
        sessionDescription: { type: "offer", sdp: sdpWith(highWater) },
      };
    }
    if (action === "close") {
      const mids = (body.mids as string[]) ?? [];
      closedMids.push(...mids);
      for (const m of mids) {
        const n = Number(m);
        if (open.delete(n)) free.push(n);
      }
      free.sort((a, b) => a - b);
      return { ok: true };
    }
    if (action === "renegotiate") {
      const sdp = (body.sdp as { sdp?: string } | undefined)?.sdp ?? "";
      lastAnswerMLines = (sdp.match(/^m=/gm) ?? []).length;
      return { ok: true };
    }
    return {};
  };
}

/* ============================================================
 * A browser that keeps count
 * ========================================================== */

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

/** Every peer connection the transport made, so the test can inspect them. */
let pcs: FakePc[] = [];

/** A writable view of a peer connection, whose real properties are read-only. */
function mutable(pc: unknown) {
  return pc as { localDescription: { type: string; sdp: string } };
}

type FakePc = {
  transceivers: {
    mid: string | null;
    kind: string;
    stopped: boolean;
    receiver: { track: { kind: string } | null };
    sender: { track: unknown; replaceTrack: (t: unknown) => Promise<void> };
  }[];
  remoteMLines: number;
  closed: boolean;
};

function makeFakePc(): FakePc & RTCPeerConnection {
  const transceivers: FakePc["transceivers"] = [];
  let nextMid = 0;

  const pc = {
    transceivers,
    remoteMLines: 0,
    closed: false,
    iceGatheringState: "complete",
    iceConnectionState: "connected",
    connectionState: "connected",
    localDescription: { type: "answer", sdp: "" },
    signalingState: "stable",
    onconnectionstatechange: null,
    ontrack: null,

    addTransceiver(trackOrKind: unknown, init?: { direction?: string }) {
      const kind =
        typeof trackOrKind === "string"
          ? trackOrKind
          : ((trackOrKind as { kind?: string })?.kind ?? "audio");
      const tr = {
        mid: String(nextMid++),
        kind,
        stopped: false,
        direction: init?.direction ?? "sendrecv",
        receiver: { track: { kind } },
        sender: {
          track: typeof trackOrKind === "string" ? null : trackOrKind,
          replaceTrack: async (t: unknown) => {
            tr.sender.track = t;
          },
        },
        stop() {
          tr.stopped = true;
        },
      };
      transceivers.push(tr);
      return tr;
    },
    getTransceivers: () => transceivers,
    getStats: async () => new Map(),
    addEventListener: () => {},
    removeEventListener: () => {},
    createOffer: async () => ({ type: "offer", sdp: sdpWith(1) }),
    createAnswer: async () => ({
      // The answer mirrors whatever the remote offer contained, as a browser's
      // would — which is how the test can watch the description grow.
      type: "answer",
      sdp: sdpWith(pc.remoteMLines),
    }),
    setLocalDescription: async (d: { type: string; sdp: string }) => {
      // Through a writable view: the real property is read-only, and the whole
      // point of this object is to be written to.
      mutable(pc).localDescription = { type: d.type, sdp: d.sdp };
    },
    setRemoteDescription: async (d: { sdp?: string }) => {
      pc.remoteMLines = ((d.sdp ?? "").match(/^m=/gm) ?? []).length;
      /*
       * A pulled track arrives as an ontrack, as it does in a browser. Without
       * this the transport never learns the mid -> peer mapping and the test
       * would be measuring nothing.
       */
      for (let i = 0; i < pc.remoteMLines; i++) {
        const existing = transceivers.find((t) => t.mid === String(i));
        const tr = existing ?? pc.addTransceiver("audio", { direction: "recvonly" });
        (tr as { mid: string | null }).mid = String(i);
        pc.ontrack?.({
          transceiver: tr,
          track: { kind: "audio", id: `rt-${i}` },
          streams: [],
        } as unknown as RTCTrackEvent);
      }
    },
    close() {
      pc.closed = true;
    },
  } as unknown as FakePc & RTCPeerConnection;

  pcs.push(pc);
  return pc;
}

/* ============================================================
 * The room
 * ========================================================== */

function person(peerId: string, opts: { micOn?: boolean; cameraOn?: boolean } = {}): RosterEntry {
  return {
    id: `p-${peerId}`,
    peerId,
    name: peerId,
    role: "attendee",
    micOn: opts.micOn ?? true,
    cameraOn: opts.cameraOn ?? false,
    sharing: false,
    handRaised: false,
    lowData: false,
    quality: "good",
    admitted: true,
    sfuSessionId: `cf-${peerId}`,
    joinedAt: new Date().toISOString(),
    userId: null,
  };
}

let gone: string[] = [];

function transport() {
  gone = [];
  return new SfuTransport(
    fakeApi(),
    [],
    () => audioProfileFor({ lowData: false }),
    {
      onMedia: () => {},
      onGone: (peerId) => {
        gone.push(peerId);
      },
      onState: () => {},
      onError: () => {},
    },
  );
}

/** The subscriber connection, which is the second one the transport makes. */
function subscriber(): FakePc {
  // The publisher is created by setLocal; a test that only syncs has just one.
  return pcs[pcs.length - 1];
}

/** Audio transceivers still attached and not stopped. */
function liveAudioTransceivers(pc: FakePc): number {
  return pc.transceivers.filter((t) => t.kind === "audio" && !t.stopped).length;
}

beforeEach(() => {
  pcs = [];
  calls = [];
  closedMids = [];
  lastAnswerMLines = 0;
  midCounter = 0;
  vi.stubGlobal("RTCPeerConnection", function RTCPeerConnectionStub() {
    return makeFakePc();
  });
  vi.stubGlobal("MediaStream", FakeMediaStream);
});

afterEach(() => vi.unstubAllGlobals());

describe("a room people keep leaving and rejoining", () => {
  it("tells the media server to let go of a departed voice", async () => {
    /*
     * The one that was wrong. A peer who leaves is forgotten locally — struck
     * from `media` and from `pulled` — but nothing closes the mid they were
     * arriving on, so the subscriber session keeps the transceiver, its
     * decoder and its jitter buffer for the rest of the meeting, pointed at a
     * Cloudflare session that has gone.
     */
    const sfu = transport();

    await sfu.sync([person("me"), person("a")], "me");
    expect(gone).toEqual([]);

    await sfu.sync([person("me")], "me");
    expect(gone).toEqual(["a"]);

    const closes = calls.filter((c) => c.action === "close");
    expect(
      closes.flatMap((c) => (c.body.mids as string[]) ?? []),
      "the departed peer's mid should have been closed on the media server",
    ).toHaveLength(1);
  });

  it("does not grow what it holds as people churn", async () => {
    /*
     * Twelve people, each of whom leaves and is replaced. The room is never
     * bigger than two, so a browser should never be holding more than two
     * voices — but every rejoin is a new peer id and therefore a new pull.
     *
     * The reported room had 48 joins and a peak of 11.
     */
    const sfu = transport();
    await sfu.sync([person("me")], "me");

    for (let i = 0; i < 12; i++) {
      await sfu.sync([person("me"), person(`guest-${i}`)], "me");
      await sfu.sync([person("me")], "me");
    }

    const sub = subscriber();
    expect(
      liveAudioTransceivers(sub),
      "one voice at a time, twelve times over, should not leave twelve voices attached",
    ).toBeLessThanOrEqual(2);
  });

  it("keeps the description it has to renegotiate from getting enormous", async () => {
    /*
     * Every pull renegotiates the subscriber session, and the description
     * carries one m-line per track ever pulled. At forty-eight joins that is
     * an SDP with dozens of sections, exchanged on every subsequent pull, on
     * the phones this product is actually used on.
     */
    const sfu = transport();
    await sfu.sync([person("me")], "me");

    for (let i = 0; i < 12; i++) {
      await sfu.sync([person("me"), person(`guest-${i}`)], "me");
      await sfu.sync([person("me")], "me");
    }
    // One more arrival, to force a renegotiation after all that churn.
    await sfu.sync([person("me"), person("last")], "me");

    expect(
      lastAnswerMLines,
      "the renegotiated description should describe the room, not its history",
    ).toBeLessThanOrEqual(4);
  });
});
