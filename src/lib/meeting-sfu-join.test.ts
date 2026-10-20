import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifySfuError, SfuApiError, SfuTransport } from "@/lib/meeting-sfu";
import { audioProfileFor, type RosterEntry } from "@/lib/meetings-shared";

/**
 * How long a new arrival takes to be heard, and why it used to be "forever".
 *
 * The complaint: "when one user joins the call, it takes forever for people to
 * hear you the first time". Each delay behind it is pinned here so that it
 * cannot quietly come back. The four media-server rules in the header of
 * meeting-sfu.ts were measured against the real Cloudflare SFU on 2026-10-21;
 * the fake below behaves the way that measurement found.
 */

/* ============================================================
 * A Cloudflare that can be made slow, or refuse
 * ========================================================== */

let calls: { action: string; body: Record<string, unknown>; at: number }[] = [];
let sessionCounter = 0;
/** Per action, a handler the test can replace. */
let behaviour: {
  publish: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  pull: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  renegotiate: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
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

/** A publish or pull that names no session creates one, as the route does. */
function created(body: Record<string, unknown>): Record<string, unknown> {
  return body.session ? {} : { sessionId: `s-${++sessionCounter}`, proof: "p" };
}

function okPull(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tracks = (body.tracks as { trackName: string }[]) ?? [];
  const out = tracks.map((t, i) => ({ mid: String(midBase + i), trackName: t.trackName }));
  midBase += tracks.length;
  return Promise.resolve({
    ...created(body),
    tracks: out,
    sessionDescription: { type: "offer", sdp: sdpWith(midBase) },
  });
}
let midBase = 0;

function okPublish(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return Promise.resolve({
    ...created(body),
    sessionDescription: { type: "answer", sdp: sdpWith(1) },
  });
}

function fakeApi() {
  return async (action: string, body: Record<string, unknown>) => {
    calls.push({ action, body, at: Date.now() });
    if (action === "publish") return behaviour.publish(body);
    if (action === "pull") return behaviour.pull(body);
    if (action === "close") return { ok: true };
    if (action === "renegotiate") return behaviour.renegotiate(body);
    return {};
  };
}

const gone = () =>
  new SfuApiError("Session appears to be disconnected.", 410, "session_error", false);

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
const camTrack = { kind: "video", id: "cam-1" } as unknown as MediaStreamTrack;

beforeEach(() => {
  pcs = [];
  calls = [];
  midBase = 0;
  sessionCounter = 0;
  behaviour = {
    publish: okPublish,
    pull: okPull,
    renegotiate: async () => ({ ok: true }),
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
const named = (action: string) => calls.filter((c) => c.action === action);

describe("what a failure means for the session", () => {
  it("reads the media server's code and status, not just the words", () => {
    expect(classifySfuError(gone())).toBe("gone");
    expect(classifySfuError(new SfuApiError("x", 400, "invalid_session_description", false))).toBe("wedged");
    expect(classifySfuError(new SfuApiError("Could not reach the media server", 502, null, true))).toBe("uncertain");
    expect(classifySfuError(new SfuApiError("wait", 425, "session_error", false))).toBe("early");
    expect(classifySfuError(new SfuApiError("Those people are no longer in this meeting.", 404, null, false))).toBe("refused");
    // The words the media server used in production, with no code attached.
    expect(
      classifySfuError(
        new Error("The current signaling state is expecting a remote answer: renegotiation is expected before pulling or pushing tracks."),
      ),
    ).toBe("wedged");
    expect(classifySfuError(new TypeError("Failed to fetch"))).toBe("uncertain");
  });
});

describe("a new arrival is heard quickly", () => {
  it("never makes a session ahead of need: the first publish and the first pull create their own", async () => {
    /*
     * Rule 1: a session left idle dies, and the first pull on it was held 5.6s
     * and refused. So no session is asked for on its own any more.
     */
    const sfu = transport();
    await sfu.setLocal({ mic: micTrack, camera: null, screen: null });
    await sfu.sync([person("me"), person("a")], "me");

    expect(named("session"), "nothing is minted on its own").toHaveLength(0);
    expect(named("publish")[0].body.session).toBeUndefined();
    expect(named("pull")[0].body.session).toBeUndefined();

    // And the session the first pull created is the one the next pull uses.
    await sfu.sync([person("me"), person("a"), person("b")], "me");
    const pulls = named("pull");
    expect(pulls).toHaveLength(2);
    expect(pulls[1].body.session).toBe("s-2");
    expect(pulls[1].body.proof).toBe("p");
    sfu.close();
  });

  it("publishes its own microphone without waiting behind the first pull", async () => {
    vi.useFakeTimers();
    behaviour.pull = (body) =>
      new Promise((resolve) => setTimeout(() => resolve(okPull(body)), 2000));

    const sfu = transport();
    const syncing = sfu.sync([person("me"), person("a")], "me");
    const publishing = sfu.setLocal({ mic: micTrack, camera: null, screen: null });

    await vi.advanceTimersByTimeAsync(50);
    expect(order("publish"), "the publish should have gone out while the pull was still waiting").toBeGreaterThanOrEqual(0);
    expect(named("renegotiate")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2100);
    await Promise.all([syncing, publishing]);
    expect(named("renegotiate")).toHaveLength(1);
    sfu.close();
  });

  it("retries a first pull that failed on its own timer, not on the next poll", async () => {
    vi.useFakeTimers();
    let refusals = 0;
    behaviour.pull = (body) => {
      if (refusals < 1) {
        refusals += 1;
        return Promise.reject(gone());
      }
      return okPull(body);
    };

    const sfu = transport();
    await sfu.sync([person("me"), person("a")], "me");
    expect(named("pull")).toHaveLength(1);
    expect(mediaEvents).toEqual([]);

    // No further sync from a poll. The transport's own retry does it.
    await vi.advanceTimersByTimeAsync(1600);
    expect(named("pull")).toHaveLength(2);
    expect(mediaEvents).toContain("a");
    sfu.close();
  });

  it("replaces a session the media server has finished at once, not after three refusals", async () => {
    vi.useFakeTimers();
    const sfu = transport();
    await sfu.sync([person("me"), person("a")], "me");
    const firstPc = pcs[0];
    expect(named("pull")[0].body.session).toBeUndefined();

    behaviour.pull = () => Promise.reject(gone());
    await sfu.sync([person("me"), person("a"), person("b")], "me");
    expect(firstPc.closed, "a 410 means the session is finished; retrying it never reconnects it").toBe(true);

    behaviour.pull = okPull;
    await vi.advanceTimersByTimeAsync(1600);
    const last = named("pull").at(-1)!;
    expect(last.body.session, "the room is pulled again on a fresh session").toBeUndefined();
    const asked = (last.body.tracks as { sessionId: string }[]).map((t) => t.sessionId);
    expect(asked).toEqual(expect.arrayContaining(["cf-a", "cf-b"]));
    sfu.close();
  });

  it("replaces a session whose answer was lost, rather than being refused for the rest of the meeting", async () => {
    /*
     * Rule 4, as production saw it: a renegotiation timed out, the media server
     * went on waiting for the answer, and every later pull came back
     * "renegotiation is expected before pulling". Nobody new was ever heard.
     */
    vi.useFakeTimers();
    const sfu = transport();
    behaviour.renegotiate = () =>
      Promise.reject(new SfuApiError("Could not reach the media server: timeout", 502, null, true));
    await sfu.sync([person("me"), person("a")], "me");
    expect(pcs[0].closed, "an answer that may not have landed finishes the session").toBe(true);

    behaviour.renegotiate = async () => ({ ok: true });
    await vi.advanceTimersByTimeAsync(1600);
    expect(named("pull")).toHaveLength(2);
    expect(named("pull")[1].body.session).toBeUndefined();
    expect(mediaEvents).toContain("a");
    sfu.close();
  });

  it("replaces a session the media server calls out of order", async () => {
    vi.useFakeTimers();
    const sfu = transport();
    await sfu.sync([person("me"), person("a")], "me");
    behaviour.pull = () =>
      Promise.reject(
        new SfuApiError(
          "The current signaling state is expecting a remote answer",
          400,
          "invalid_session_description",
          false,
        ),
      );
    await sfu.sync([person("me"), person("a"), person("b")], "me");
    expect(pcs[0].closed).toBe(true);
    sfu.close();
  });

  it("does not storm the media server when every new session fails too", async () => {
    vi.useFakeTimers();
    const sfu = transport();
    await sfu.sync([person("me"), person("a")], "me");
    behaviour.pull = () => Promise.reject(gone());
    behaviour.renegotiate = () => Promise.reject(gone());
    // Keep the room changing so every attempt has something to pull.
    let n = 0;
    for (let i = 0; i < 6; i++) {
      await sfu.sync([person("me"), person("a"), person(`x${n++}`)], "me");
      await vi.advanceTimersByTimeAsync(20_000);
    }
    const pullsInTwoMinutes = named("pull").length;
    expect(pullsInTwoMinutes, "replacements back off rather than firing every 1.5s").toBeLessThan(40);
    sfu.close();
  });
});

describe("one silent track cannot hold the room's voices", () => {
  it("pulls voices first, in their own request, and pictures after", async () => {
    /*
     * Rule 3: a request holding a camera with no media was held 8.5s, and the
     * voices in the same request with it.
     */
    vi.useFakeTimers();
    const sfu = transport();
    await sfu.sync(
      [person("me"), person("a", { cameraOn: true }), person("b", { cameraOn: true })],
      "me",
    );
    await vi.advanceTimersByTimeAsync(10);
    const pulls = named("pull");
    expect(pulls.length).toBeGreaterThanOrEqual(2);
    const names = (i: number) => (pulls[i].body.tracks as { trackName: string }[]).map((t) => t.trackName);
    expect(names(0)).toEqual(["mic", "mic"]);
    expect(names(1)).toEqual(["cam", "cam"]);
    sfu.close();
  });

  it("asks again for a track that failed on its own, not in a batch with others", async () => {
    vi.useFakeTimers();
    let first = true;
    behaviour.pull = (body) => {
      const tracks = (body.tracks as { sessionId: string; trackName: string }[]) ?? [];
      if (first) {
        first = false;
        // b's microphone has no media yet: the media server says so.
        return Promise.resolve({
          ...created(body),
          tracks: tracks.map((t, i) =>
            t.sessionId === "cf-b"
              ? { errorCode: "empty_track_error", errorDescription: "No track data" }
              : { mid: String(i), trackName: t.trackName },
          ),
          sessionDescription: { type: "offer", sdp: sdpWith(1) },
        });
      }
      return okPull(body);
    };

    const sfu = transport();
    midBase = 1;
    await sfu.sync([person("me"), person("a"), person("b")], "me");
    // c arrives while b is backed off; then b's turn comes round.
    await sfu.sync([person("me"), person("a"), person("b"), person("c")], "me");
    await vi.advanceTimersByTimeAsync(7000);

    const later = named("pull").slice(1).map((p) => (p.body.tracks as { sessionId: string }[]).map((t) => t.sessionId));
    expect(later[0], "the newcomer is not held behind the track that failed").toEqual(["cf-c"]);
    expect(later.some((l) => l.length === 1 && l[0] === "cf-b"), "the failed track is retried alone").toBe(true);
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
          ...created(body),
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
    sfu.close();
  });
});

describe("a publisher that started again", () => {
  it("is pulled afresh when the roster carries its new session id", async () => {
    const sfu = transport();
    await sfu.sync([person("me"), person("a", { sfuSessionId: "cf-a-1" })], "me");
    const firstPulls = named("pull");
    expect(firstPulls).toHaveLength(1);
    expect((firstPulls[0].body.tracks as { sessionId: string }[])[0].sessionId).toBe("cf-a-1");

    await sfu.sync([person("me"), person("a", { sfuSessionId: "cf-a-2" })], "me");
    const closes = named("close");
    expect(closes, "the old session's track should have been handed back").toHaveLength(1);
    const pulls = named("pull");
    expect(pulls).toHaveLength(2);
    expect((pulls[1].body.tracks as { sessionId: string }[])[0].sessionId).toBe("cf-a-2");
    sfu.close();
  });
});

describe("a track nobody here asked for", () => {
  it("is closed on the media server rather than decoded for the rest of the meeting", async () => {
    vi.useFakeTimers();
    let extra = 1;
    behaviour.pull = async (body) => {
      const res = await okPull(body);
      if (extra-- > 0) {
        // The description carries one more media section than was mapped.
        midBase += 1;
        res.sessionDescription = { type: "offer", sdp: sdpWith(midBase) };
      }
      return res;
    };

    const sfu = transport();
    await sfu.sync([person("me"), person("a")], "me");
    await vi.advanceTimersByTimeAsync(100);

    const close = calls.find((c) => c.action === "close");
    expect(close, "the orphaned track should have been handed back").toBeTruthy();
    expect(close?.body.mids).toEqual(["1"]);
    expect(mediaEvents).toContain("a");
    sfu.close();
  });
});

describe("a microphone whose connection failed", () => {
  it("is published again without anybody touching a button", async () => {
    vi.useFakeTimers();
    const sfu = transport();
    await sfu.setLocal({ mic: micTrack, camera: null, screen: null });
    expect(named("publish")).toHaveLength(1);

    const publisher = pcs[0] as unknown as RTCPeerConnection & { connectionState: string };
    publisher.connectionState = "failed";
    publisher.onconnectionstatechange?.(new Event("connectionstatechange"));

    await vi.advanceTimersByTimeAsync(1100);
    const publishes = named("publish");
    expect(publishes, "the microphone should be published again on its own").toHaveLength(2);
    expect(publishes[1].body.session, "on a new session, created by the publish").toBeUndefined();
    expect(pcs[1], "on a new connection").toBeTruthy();
    sfu.close();
  });

  it("is published again after a connection that stays disconnected", async () => {
    vi.useFakeTimers();
    const sfu = transport();
    await sfu.setLocal({ mic: micTrack, camera: null, screen: null });
    const publisher = pcs[0] as unknown as RTCPeerConnection & { connectionState: string };
    publisher.connectionState = "disconnected";
    publisher.onconnectionstatechange?.(new Event("connectionstatechange"));

    await vi.advanceTimersByTimeAsync(9_000);
    expect(named("publish"), "a short drop is given its chance to recover").toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(named("publish"), "a handover that never recovers is replaced").toHaveLength(2);
    sfu.close();
  });

  it("keeps publishing when the media server refuses", async () => {
    vi.useFakeTimers();
    let refusals = 2;
    behaviour.publish = async (body) => {
      if (refusals-- > 0) throw new SfuApiError("The media server refused the request (503).", 502, null, true);
      return okPublish(body);
    };
    const sfu = transport();
    await sfu.setLocal({ mic: micTrack, camera: null, screen: null });
    expect(named("publish")).toHaveLength(1);

    // 1s, then 2s: the third attempt is granted.
    await vi.advanceTimersByTimeAsync(3500);
    expect(named("publish")).toHaveLength(3);
    expect(pcs.at(-1)?.closed).toBe(false);
    sfu.close();
  });
});

describe("a camera that was off for a while", () => {
  it("is published afresh when it comes back, because the media server let the old one go", async () => {
    /*
     * Rule 2: thirty seconds with no packets and the publication is deleted.
     * Where no placeholder picture can be made (as here, with no canvas), a
     * camera that comes back after that must not be handed to the dead one.
     */
    vi.useFakeTimers();
    const sfu = transport();
    await sfu.setLocal({ mic: micTrack, camera: camTrack, screen: null });
    expect(named("publish")).toHaveLength(1);

    await sfu.setLocal({ mic: micTrack, camera: null, screen: null });
    await vi.advanceTimersByTimeAsync(5_000);
    await sfu.setLocal({ mic: micTrack, camera: camTrack, screen: null });
    expect(named("publish"), "five seconds off is a swap, not a new publish").toHaveLength(1);

    await sfu.setLocal({ mic: micTrack, camera: null, screen: null });
    await vi.advanceTimersByTimeAsync(40_000);
    await sfu.setLocal({ mic: micTrack, camera: camTrack, screen: null });
    const publishes = named("publish");
    expect(publishes, "forty seconds off needs a new publication").toHaveLength(2);
    expect(publishes[1].body.session).toBeUndefined();
    expect(pcs[0].closed).toBe(true);
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

    // And tells the server, so it can be read the morning after.
    await vi.advanceTimersByTimeAsync(3100);
    const heard = calls.find((c) => c.action === "event" && c.body.kind === "heard");
    expect(heard?.body.detail).toMatch(/^a=\d+ms$/);
    sfu.close();
  });
});
