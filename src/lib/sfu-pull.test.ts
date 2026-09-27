import { describe, expect, it } from "vitest";

/**
 * What a subscriber asks the SFU for, and what it records as done.
 *
 * This is the rule that made a thirty-person meeting carry sound and no
 * picture. People join with their camera off, so at the moment somebody
 * arrives their publisher has exactly one track on the SFU: the microphone.
 * The subscriber asked for all three names anyway AND marked all three as
 * pulled before finding out whether they existed. Cloudflare reports a missing
 * track as a per-track error inside a 200, which nothing looked at — so `cam`
 * was recorded as done, for ever, and switching a camera on later never caused
 * anybody to ask for it again.
 *
 * Two rules come out of that, restated here because they are rules rather than
 * plumbing:
 *
 *   1. Ask for what the roster says exists. It already carries `micOn`,
 *      `cameraOn` and `sharing` for everybody, on every poll.
 *   2. Record only what actually arrived.
 */

type Peer = { peerId: string; micOn: boolean; cameraOn: boolean; sharing: boolean };

const MIC = "mic";
const CAM = "cam";
const SCREEN = "screen";

/** Which of somebody's tracks are worth asking for right now. */
function namesToPull(peer: Peer, pulled: Set<string>): string[] {
  const names: string[] = [];
  // A track exists from the moment it is first turned on and survives being
  // turned off — the publisher keeps the transceiver and swaps in null. So a
  // mic already pulled stays worth having even while they are muted.
  if (peer.micOn || pulled.has(`${peer.peerId}:${MIC}`)) names.push(MIC);
  if (peer.cameraOn) names.push(CAM);
  if (peer.sharing) names.push(SCREEN);
  return names.filter((n) => !pulled.has(`${peer.peerId}:${n}`));
}

/** What to record after the SFU has answered. */
function recordResults(
  asked: { peerId: string; name: string }[],
  results: { mid?: string; error?: unknown }[],
  pulled: Set<string>,
): void {
  results.forEach((r, i) => {
    const who = asked[i];
    if (!who) return;
    if (r.error || !r.mid) return; // left unmarked, so the next poll retries
    pulled.add(`${who.peerId}:${who.name}`);
  });
}

const joined = (over: Partial<Peer> = {}): Peer => ({
  peerId: "p1",
  micOn: true,
  cameraOn: false,
  sharing: false,
  ...over,
});

describe("what to pull", () => {
  it("does not ask for a camera nobody has turned on", () => {
    // THE BUG. Asking anyway is free; marking it done is what broke video.
    expect(namesToPull(joined(), new Set())).toEqual([MIC]);
  });

  it("asks for the camera as soon as the roster says it is on", () => {
    const pulled = new Set([`p1:${MIC}`]);
    expect(namesToPull(joined({ cameraOn: true }), pulled)).toEqual([CAM]);
  });

  it("keeps a microphone it already has while they are muted", () => {
    // Muting swaps the track for null; it does not remove it from the SFU.
    // Dropping it here would re-pull a track we already hold, every poll.
    const pulled = new Set([`p1:${MIC}`]);
    expect(namesToPull(joined({ micOn: false }), pulled)).toEqual([]);
  });

  it("never asks twice for something it already has", () => {
    const pulled = new Set([`p1:${MIC}`, `p1:${CAM}`]);
    expect(namesToPull(joined({ cameraOn: true }), pulled)).toEqual([]);
  });

  it("asks for a screen share only while it is happening", () => {
    expect(namesToPull(joined({ sharing: true }), new Set())).toContain(SCREEN);
    expect(namesToPull(joined({ sharing: false }), new Set())).not.toContain(SCREEN);
  });
});

describe("what to record", () => {
  it("records a track that was allocated a mid", () => {
    const pulled = new Set<string>();
    recordResults([{ peerId: "p1", name: CAM }], [{ mid: "3" }], pulled);
    expect(pulled.has(`p1:${CAM}`)).toBe(true);
  });

  it("leaves a per-track failure unmarked, so the next poll retries", () => {
    const pulled = new Set<string>();
    // Cloudflare reports this inside a 200. Marking it anyway is what made the
    // failure permanent and invisible.
    recordResults(
      [{ peerId: "p1", name: CAM }],
      [{ error: { errorDescription: "track not found" } }],
      pulled,
    );
    expect(pulled.has(`p1:${CAM}`)).toBe(false);
  });

  it("records the successes and retries the failures in one mixed answer", () => {
    const pulled = new Set<string>();
    recordResults(
      [
        { peerId: "p1", name: MIC },
        { peerId: "p1", name: CAM },
      ],
      [{ mid: "0" }, { error: {} }],
      pulled,
    );
    expect([...pulled]).toEqual([`p1:${MIC}`]);
  });

  it("matches results to requests by position, not by name", () => {
    // Every person's camera track is called "cam". Matching on the name would
    // hand one person's video to another.
    const pulled = new Set<string>();
    recordResults(
      [
        { peerId: "alice", name: CAM },
        { peerId: "bob", name: CAM },
      ],
      [{ error: {} }, { mid: "5" }],
      pulled,
    );
    expect(pulled.has(`bob:${CAM}`)).toBe(true);
    expect(pulled.has(`alice:${CAM}`)).toBe(false);
  });
});

/* ============================================================
 * Whose pictures do we pay for?
 * ========================================================== */

/**
 * The SFU made upload flat — one copy, whatever the room size. It did nothing
 * for download, because pulling every camera is linear in the room: 8.7 Mbps
 * at thirty people and 59.7 at two hundred, on connections that have neither.
 *
 * Voices come from everybody, always. Pictures come only from the people on
 * screen. That is what turns download from linear into flat, and it is what
 * every large conferencing product does.
 */

const VISIBLE = 9;

function watchedPeers(
  others: { peerId: string }[],
  focused: string | null,
  speaking: Set<string>,
): string[] {
  return [
    ...others.filter((r) => r.peerId === focused),
    ...others.filter((r) => r.peerId !== focused && speaking.has(r.peerId)),
    ...others.filter((r) => r.peerId !== focused && !speaking.has(r.peerId)),
  ]
    .slice(0, VISIBLE)
    .map((r) => r.peerId);
}

const room = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ peerId: `p${i}` }));

describe("whose video we subscribe to", () => {
  it("takes everyone in a small room", () => {
    expect(watchedPeers(room(5), null, new Set())).toHaveLength(5);
  });

  it("stops at the budget in a large one", () => {
    // The whole point: two hundred people must not mean two hundred streams.
    expect(watchedPeers(room(200), null, new Set())).toHaveLength(VISIBLE);
  });

  it("always keeps the spotlit person, however large the room", () => {
    // Somebody at the end of a two-hundred-person roster who is put on the
    // main screen must not be the one person nobody can see.
    const watched = watchedPeers(room(200), "p150", new Set());
    expect(watched[0]).toBe("p150");
    expect(watched).toHaveLength(VISIBLE);
  });

  it("prefers whoever is speaking over whoever happens to be first", () => {
    const watched = watchedPeers(room(50), null, new Set(["p40", "p45"]));
    expect(watched.slice(0, 2)).toEqual(["p40", "p45"]);
  });

  it("puts the spotlight ahead of a speaker", () => {
    // A host has said "look at this person". That beats the room's own noise.
    const watched = watchedPeers(room(50), "p30", new Set(["p40"]));
    expect(watched[0]).toBe("p30");
    expect(watched[1]).toBe("p40");
  });

  it("never lists anybody twice", () => {
    // Both spotlit and speaking. A duplicate would spend two of nine slots on
    // one person and silently drop somebody else.
    const watched = watchedPeers(room(50), "p10", new Set(["p10", "p11"]));
    expect(new Set(watched).size).toBe(watched.length);
  });
});
