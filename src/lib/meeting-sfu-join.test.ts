import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SfuTransport } from "@/lib/meeting-sfu";
import { audioProfileFor, type RosterEntry } from "@/lib/meetings-shared";

/**
 * How long a new arrival takes to be heard, and why it used to be "forever".
 *
 * The complaint: "when one user joins the call, it takes forever for people to
 * hear you the first time". Four separate delays stacked up behind it, and
 * each one is pinned here so that it cannot quietly come back:
 *
 *   1. One queue for two sessions. A joiner pulled everybody else — a session,
 *      a pull, a candidate gather, a renegotiation — before publishing their
 *      own microphone, because both went through the same promise chain.
 *   2. A pull refused because our own transport was still connecting
 *      ("Session appears to be disconnected") was tried again only when the
 *      next poll happened to return — up to twelve seconds later.
 *   3. A track the media server did not have yet was asked for with a
 *      doubling backoff and then NEVER AGAIN after six attempts.
 *   4. A publisher rebuilt on a new session was never noticed: the mids held
 *      pointed at the old session and stayed silent for the rest of the call.
 *
 * (The fifth, and biggest, is on the server: a publish never woke the room.
 * That is a route change, covered by the real-browser harness.)
 */

/* ============================================================
 * A Cloudflare that can be made slow, or refuse
 * ========================================================== */

let calls: { action: string; body: Record<string, unknown>; at: number }[] = [];
let sessionCounter = 0;
/** Per action, a handler the test can replace. */
let behaviour: {
  session: () => Promise<Record<string, unknown>>;
  pull: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

function sdpWith(mLines: number): string {
  const head = ["v=0", "o=- 0 0 IN IP4 127.0.0.1", "s=-", "t=0 0"];
  const media: string[] = [];
  for (let i = 0; i < mLines; i++) {
    media.push(
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=rtpmap:111 opus/48000/2",
      `a=mid:${i}`,
    );
  }
  return [...head, ...media, ""].join("\r\n");
}

function okPull(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tracks = (body.tracks as { trackName: string }[]) ?? [];
  const out = tracks.map((t, i) => ({ mid: String(midBase + i), trackName: t.trackName }));
  midBase += tracks.length;
  return Promise.resolve({
    tracks: out,
    sessionDescription: { type: "offer", sdp: sdpWith(midBase) },
  });
}
let midBase = 0;

function fakeApi() {
  return async (action: string, body: Record<string, unknown>) => {
    calls.push({ action, body, at: Date.now() });
    if (action === "session") return behaviour.session();
    if (action === "publish") {
      return { sessionDescription: { type: "answer", sdp: sdpWith(1) } };
    }
    if (action === "pull") return behaviour.pull(body);
    if (action === "close") return { ok: true };
    if (action === "renegotiate") return { ok: true };
    return {};
  };
}

/* ============================================================
 * A browser
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

type FakePc = {
  connectionState: string;
  closed: boolean;
  transceivers: { mid: string | null; kind: string; receiver: { track: unknown; getStats: () => Promise<Map<string, unknown>> }; sender: { track: unknown; replaceTrack: (t: unknown) => Promise<void> } }[];
  remoteMLines: number;
};

let pcs: FakePc[] = [];

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
        direction: init?.direction ?? "sendrecv",
        receiver: { track: { kind }, getStats: async () => new Map() },
        sender: {
          track: typeof trackOrKind === "string" ? null : trackOrKind,
          replaceTrack: async (t: unknown) => {
            tr.sender.track = t;
          },
        },
        stop() {},
      };
      transceivers.push(tr);
      return tr;
    },
    getTransceivers: () => transceivers,
    getStats: async () => new Map(),
    addEventListener: () => {},
    removeEventListener: () => {},
    createOffer: async () => ({ type: "offer", sdp: sdpWith(1) }),
    createAnswer: async () => ({ type: "answer", sdp: sdpWith(pc.remoteMLines) }),
    setLocalDescription: async (d: { type: string; sdp: string }) => {
      (pc as { localDescription: unknown }).localDescription = { type: d.type, sdp: d.sdp };
    },
    setRemoteDescription: async (d: { sdp?: string }) => {
      pc.remoteMLines = ((d.sdp ?? "").match(/^m=/gm) ?? []).length;
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
      pc.connectionState = "closed";
    },
  } as unknown as FakePc & RTCPeerConnection;
  pcs.push(pc);
  return pc;
}

function person(peerId: string, over: Partial<RosterEntry> = {}): RosterEntry {
  return {
    id: `p-${peerId}`,
    peerId,
    name: peerId,
    role: "attendee",
    micOn: true,
    cameraOn: false,
    sharing: false,
    handRaised: false,
    lowData: false,
    quality: "good",
    admitted: true,
    sfuSessionId: `cf-${peerId}`,
    joinedAt: new Date().toISOString(),
    userId: null,
    ...over,
  };
}

let mediaEvents: string[] = [];

function transport() {
  mediaEvents = [];
  return new SfuTransport(
    fakeApi(),
    [],
    () => audioProfileFor({ lowData: false }),
    {
      onMedia: (peerId) => {
        mediaEvents.push(peerId);
      },
      onGone: () => {},
      onState: () => {},
      onError: () => {},
    },
  );
}

const micTrack = { kind: "audio", id: "mic-1" } as unknown as MediaStreamTrack;

beforeEach(() => {
  pcs = [];
  calls = [];
  midBase = 0;
  sessionCounter = 0;
  behaviour = {
    session: async () => ({ sessionId: `s-${++sessionCounter}`, proof: "p" }),
    pull: okPull,
  };
  vi.stubGlobal("RTCPeerConnection", function RTCPeerConnectionStub() {
    return makeFakePc();
  });
  vi.stubGlobal("MediaStream", FakeMediaStream);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const order = (action: string) => calls.findIndex((c) => c.action === action);

describe("a new arrival is heard quickly", () => {
  it("publishes its own microphone without waiting behind the first pull", async () => {
    /*
     * The subscriber's session takes a while to be minted (a slow media
     * server, a slow link). The publish must not wait for it: the room hears
     * this person as soon as THEIR session is ready, whatever the download
     * is doing.
     */
    vi.useFakeTimers();
    let sessions = 0;
    behaviour.session = () =>
      new Promise((resolve) => {
        sessions += 1;
        // `prepare` mints the publisher's session first and the subscriber's
        // second. The subscriber's is slow; the publisher's answers at once.
        const delay = sessions === 2 ? 2000 : 0;
        setTimeout(() => resolve({ sessionId: `s-${sessions}`, proof: "p" }), delay);
      });

    const sfu = transport();
    sfu.prepare();
    const syncing = sfu.sync([person("me"), person("a")], "me");
    const publishing = sfu.setLocal({ mic: micTrack, camera: null, screen: null });

    await vi.advanceTimersByTimeAsync(50);
    expect(order("publish"), "the publish should have gone out while the subscriber session was still being minted").toBeGreaterThanOrEqual(0);
    expect(order("pull")).toBe(-1);

    await vi.advanceTimersByTimeAsync(2100);
    await Promise.all([syncing, publishing]);
    expect(order("pull")).toBeGreaterThan(order("publish"));
  });

  it("asks the media server for both sessions ahead of need", async () => {
    const sfu = transport();
    sfu.prepare();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.filter((c) => c.action === "session")).toHaveLength(2);

    // And uses them: no third session is minted for the first publish/pull.
    await sfu.setLocal({ mic: micTrack, camera: null, screen: null });
    await sfu.sync([person("me"), person("a")], "me");
    expect(calls.filter((c) => c.action === "session")).toHaveLength(2);
  });

  it("retries a pull the server refused as disconnected on its own timer, not on the next poll", async () => {
    vi.useFakeTimers();
    let refusals = 0;
    behaviour.pull = (body) => {
      if (refusals < 1) {
        refusals += 1;
        return Promise.reject(new Error("Session appears to be disconnected. Please check if the PeerConnection is connected."));
      }
      return okPull(body);
    };

    const sfu = transport();
    await sfu.sync([person("me"), person("a")], "me");
    expect(calls.filter((c) => c.action === "pull")).toHaveLength(1);
    expect(mediaEvents).toEqual([]);

    // No further sync from a poll. The transport's own retry does it.
    await vi.advanceTimersByTimeAsync(1600);
    expect(calls.filter((c) => c.action === "pull")).toHaveLength(2);
    expect(mediaEvents).toContain("a");
  });

  it("rebuilds the subscriber after repeated 'disconnected' refusals while this end reads connected", async () => {
    vi.useFakeTimers();
    behaviour.pull = () =>
      Promise.reject(new Error("Session appears to be disconnected. Please check if the PeerConnection is connected."));

    const sfu = transport();
    await sfu.sync([person("me"), person("a")], "me");
    const firstPc = pcs[0];
    // Three refusals: the first sync, then two retries on the transport's own
    // timer. The third throws the session away; the next retry mints a new one.
    await vi.advanceTimersByTimeAsync(1600);
    await vi.advanceTimersByTimeAsync(1600);
    expect(firstPc.closed, "the dead subscriber should have been thrown away").toBe(true);
    await vi.advanceTimersByTimeAsync(1600);
    expect(
      calls.filter((c) => c.action === "session").length,
      "a fresh session should have been minted for the rebuilt subscriber",
    ).toBeGreaterThanOrEqual(2);
  });

  /*
   * Both seen on production: the host alone in the room early, a subscriber
   * session minted ahead of need and never used, and when people arrived
   * every pull on it came back "disconnected" — for good, because a
   * connection that never negotiated stays "new", and "new" was not counted.
   */
  it("does not use a session minted ahead of need once it has gone stale", async () => {
    vi.useFakeTimers();
    const sfu = transport();
    sfu.prepare();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((c) => c.action === "session")).toHaveLength(2);

    // Alone in the room for a while; then somebody arrives.
    await vi.advanceTimersByTimeAsync(30_000);
    await sfu.sync([person("me"), person("a")], "me");
    expect(calls.filter((c) => c.action === "session"), "a fresh subscriber session").toHaveLength(3);
    expect(calls.find((c) => c.action === "pull")?.body.session).toBe("s-3");
    sfu.close();
  });

  it("rebuilds a subscriber that never connected and keeps being refused", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("RTCPeerConnection", function RTCPeerConnectionNew() {
      const pc = makeFakePc();
      pc.connectionState = "new";
      return pc;
    });
    behaviour.pull = () =>
      Promise.reject(new Error("Session appears to be disconnected. Please check if the PeerConnection is connected."));

    const sfu = transport();
    await sfu.sync([person("me"), person("a")], "me");
    const firstPc = pcs[0];
    await vi.advanceTimersByTimeAsync(1600);
    await vi.advanceTimersByTimeAsync(1600);
    expect(firstPc.closed, "a session that never connected must not be waited on for ever").toBe(true);
    sfu.close();
  });
});

describe("a track that is not there yet", () => {
  it("is asked for again, and keeps being asked for past six attempts", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    behaviour.pull = (body) => {
      attempts += 1;
      if (attempts <= 8) {
        const tracks = (body.tracks as { trackName: string }[]) ?? [];
        return Promise.resolve({
          tracks: tracks.map((t) => ({ trackName: t.trackName, error: { errorDescription: "track not found" } })),
        });
      }
      return okPull(body);
    };

    const sfu = transport();
    const roster = [person("me"), person("late")];
    await sfu.sync(roster, "me");
    expect(attempts).toBe(1);

    // Quick retries first (1, 2, 4, 8, 8 seconds), then every twenty — and
    // without another poll. Eight attempts fall within about 65 seconds.
    await vi.advanceTimersByTimeAsync(70_000);
    expect(attempts, "the seventh and eighth attempts should still happen").toBeGreaterThanOrEqual(8);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mediaEvents, "the voice arrives once the server finally has it").toContain("late");
  });
});

describe("a publisher that started again", () => {
  it("is pulled afresh when the roster carries its new session id", async () => {
    const sfu = transport();
    await sfu.sync([person("me"), person("a", { sfuSessionId: "cf-a-1" })], "me");
    const firstPulls = calls.filter((c) => c.action === "pull");
    expect(firstPulls).toHaveLength(1);
    expect((firstPulls[0].body.tracks as { sessionId: string }[])[0].sessionId).toBe("cf-a-1");

    await sfu.sync([person("me"), person("a", { sfuSessionId: "cf-a-2" })], "me");
    const closes = calls.filter((c) => c.action === "close");
    expect(closes, "the old session's track should have been handed back").toHaveLength(1);
    const pulls = calls.filter((c) => c.action === "pull");
    expect(pulls).toHaveLength(2);
    expect((pulls[1].body.tracks as { sessionId: string }[])[0].sessionId).toBe("cf-a-2");
  });
});

describe("a track nobody here asked for", () => {
  it("is closed on the media server rather than decoded for the rest of the meeting", async () => {
    /*
     * Seen on production during a burst of Cloudflare API timeouts: the
     * server carried out a pull whose answer never came back, so the next
     * description brought a track no mapping named.
     */
    vi.useFakeTimers();
    let lost = 1;
    behaviour.pull = (body) => {
      if (lost-- > 0) {
        // The media server allocates the mid; the answer is lost on the way.
        midBase += ((body.tracks as unknown[]) ?? []).length;
        return Promise.reject(new Error("Could not reach the media server: timeout"));
      }
      return okPull(body);
    };

    const sfu = transport();
    await sfu.sync([person("me"), person("a")], "me");
    await vi.advanceTimersByTimeAsync(1600);
    await vi.advanceTimersByTimeAsync(100);

    const close = calls.find((c) => c.action === "close");
    expect(close, "the orphaned track should have been handed back").toBeTruthy();
    expect(close?.body.mids).toEqual(["0"]);
    expect(mediaEvents).toContain("a");
    sfu.close();
  });
});

describe("a microphone whose connection failed", () => {
  /*
   * Found on production by the three-browser harness: the third person's
   * publishing connection failed, the transport threw it away "so the next
   * setLocal builds it again" — and the next setLocal only comes from a press
   * of the mic or camera button. Somebody who just sat and talked was never
   * heard again. Now the transport publishes again by itself.
   */
  it("is published again without anybody touching a button", async () => {
    vi.useFakeTimers();
    const sfu = transport();
    await sfu.setLocal({ mic: micTrack, camera: null, screen: null });
    expect(calls.filter((c) => c.action === "publish")).toHaveLength(1);

    const publisher = pcs[0] as unknown as RTCPeerConnection & { connectionState: string };
    publisher.connectionState = "failed";
    publisher.onconnectionstatechange?.(new Event("connectionstatechange"));

    await vi.advanceTimersByTimeAsync(1100);
    const publishes = calls.filter((c) => c.action === "publish");
    expect(publishes, "the microphone should be published again on its own").toHaveLength(2);
    expect(publishes[1].body.session).not.toBe(publishes[0].body.session);
    sfu.close();
  });

  it("keeps asking when the media server will not open a session", async () => {
    vi.useFakeTimers();
    let refusals = 2;
    behaviour.session = async () => {
      if (refusals-- > 0) throw new Error("503");
      return { sessionId: `s-${++sessionCounter}`, proof: "p" };
    };
    const sfu = transport();
    await sfu.setLocal({ mic: micTrack, camera: null, screen: null });
    expect(calls.filter((c) => c.action === "publish")).toHaveLength(0);

    // 1s, then 2s: the third attempt is granted.
    await vi.advanceTimersByTimeAsync(3500);
    expect(calls.filter((c) => c.action === "publish")).toHaveLength(1);
    sfu.close();
  });
});

describe("measuring it", () => {
  it("reports how long after the roster named somebody their voice arrived", async () => {
    vi.useFakeTimers();
    const sfu = transport();
    // Named, but not yet publishing: nothing to pull.
    await sfu.sync([person("me"), person("a", { sfuSessionId: null })], "me");
    await vi.advanceTimersByTimeAsync(3000);
    await sfu.sync([person("me"), person("a")], "me");

    const readings = await sfu.diagnose();
    const a = readings.get("a");
    expect(a?.heardAfterMs).toBeGreaterThanOrEqual(3000);
    expect(a?.heardAfterMs).toBeLessThan(4000);
  });
});
