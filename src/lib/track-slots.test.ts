import { describe, expect, it } from "vitest";

/**
 * Which of the three slots an arriving track belongs to, and who wins when two
 * compete for one.
 *
 * There are TWO video transceivers per peer — camera and screen — and telling
 * them apart is the whole job. Getting it wrong does not look like a mix-up,
 * it looks like video being broken: the idle screen track displaces the
 * camera, the receiver goes on decoding hundreds of frames into a track
 * nothing holds, and the video element is handed one that will never carry a
 * pixel. From the outside that is an avatar and a perfectly healthy
 * `getStats`, which is how it survived three rounds of fixes.
 *
 * The rules live on the client, which needs a browser. They are restated here
 * because they are rules, not plumbing — if this and the client ever disagree,
 * the client is wrong.
 */

type Slot = "audio" | "camera" | "screen";
type Track = { kind: "audio" | "video"; id: string; muted: boolean; readyState: string };
type Slots = { audio?: { mid: string | null }; camera?: { mid: string | null }; screen?: { mid: string | null } };

function slotFor(
  slots: Slots,
  transceiver: { mid: string | null } | undefined,
  track: Track,
  videoTracksAlreadyInStream: number,
): Slot {
  if (transceiver && transceiver === slots.audio) return "audio";
  if (transceiver && transceiver === slots.camera) return "camera";
  if (transceiver && transceiver === slots.screen) return "screen";

  const mid = transceiver?.mid;
  if (mid !== null && mid !== undefined) {
    if (mid === slots.audio?.mid) return "audio";
    if (mid === slots.camera?.mid) return "camera";
    if (mid === slots.screen?.mid) return "screen";
  }

  if (track.kind === "audio") return "audio";
  return videoTracksAlreadyInStream === 0 ? "camera" : "screen";
}

/** Does the arriving track take the slot, or does the incumbent keep it? */
function incomingWins(incoming: Track, others: Track[]): boolean {
  const working = others.filter((t) => !t.muted && t.readyState === "live");
  return !(incoming.muted && working.length > 0);
}

const video = (id: string, muted = true): Track => ({
  kind: "video",
  id,
  muted,
  readyState: "live",
});

describe("slotFor", () => {
  const slots: Slots = {
    audio: { mid: "0" },
    camera: { mid: "1" },
    screen: { mid: "2" },
  };

  it("matches our own transceivers by identity", () => {
    expect(slotFor(slots, slots.camera, video("v"), 0)).toBe("camera");
    expect(slotFor(slots, slots.screen, video("v"), 1)).toBe("screen");
  });

  it("matches a transceiver the browser made, by its negotiated mid", () => {
    // Same m-line, different object. `mid` is the same string on both sides of
    // the call, which is exactly what identity cannot tell us here.
    expect(slotFor(slots, { mid: "2" }, video("v"), 1)).toBe("screen");
    expect(slotFor(slots, { mid: "1" }, video("v"), 0)).toBe("camera");
  });

  it("never sends a second unidentifiable video track to the camera slot", () => {
    // THE BUG. The old last resort was `kind === "audio" ? "audio" : "camera"`,
    // so the screen track landed on top of a camera that was mid-picture.
    const first = slotFor(slots, undefined, video("v1"), 0);
    expect(first).toBe("camera");

    const second = slotFor(slots, undefined, video("v2"), 1);
    expect(second).toBe("screen");
  });
});

describe("who keeps the slot", () => {
  it("an idle track never displaces one that is carrying media", () => {
    const camera = video("camera", /* muted */ false);
    const idleScreen = video("screen", /* muted */ true);

    // This single assertion is the difference between a picture and an avatar.
    expect(incomingWins(idleScreen, [camera])).toBe(false);
  });

  it("a track that starts carrying media does take the slot", () => {
    const stale = video("old", /* muted */ true);
    const live = video("new", /* muted */ false);
    expect(incomingWins(live, [stale])).toBe(true);
  });

  it("the first track always takes an empty slot", () => {
    expect(incomingWins(video("first"), [])).toBe(true);
  });

  it("a fresh camera replaces one that is also carrying, on a switch", () => {
    // Switching camera mid-call: both briefly look live, and the new one must
    // win or the tile freezes on the last frame of the old.
    const oldCam = video("old", false);
    const newCam = video("new", false);
    expect(incomingWins(newCam, [oldCam])).toBe(true);
  });
});

/* ============================================================
 * Is somebody really sharing their screen?
 * ========================================================== */

/**
 * Every peer keeps a screen transceiver open whether or not anybody is
 * sharing, so "there is a live track in the screen slot" is not the same
 * question as "they are sharing their screen". Inferring one from the other
 * announced a screen share, over a black stage, that no amount of turning the
 * camera off would clear — because the track was still sitting there.
 *
 * Sharing is a deliberate act. The person doing it tells the server, and the
 * roster carries it on every poll. That is the authority; the track is only
 * how the pixels arrive.
 */
function isSharing(
  media: { hasScreen: boolean; screenStream: unknown },
  entry: { sharing: boolean } | undefined,
): boolean {
  return !!(media.hasScreen && media.screenStream && entry?.sharing);
}

describe("screen share detection", () => {
  const withTrack = { hasScreen: true, screenStream: {} };

  it("believes a share the person has declared", () => {
    expect(isSharing(withTrack, { sharing: true })).toBe(true);
  });

  it("ignores a live track nobody said was a share", () => {
    // The bug: an idle track in the always-open screen slot flickers unmuted
    // once, and the whole room is told somebody is sharing.
    expect(isSharing(withTrack, { sharing: false })).toBe(false);
  });

  it("ignores a declared share with nothing arriving yet", () => {
    // The other direction: do not put up a black stage on a promise.
    expect(isSharing({ hasScreen: false, screenStream: null }, { sharing: true })).toBe(
      false,
    );
  });

  it("ignores a peer who has left the roster entirely", () => {
    expect(isSharing(withTrack, undefined)).toBe(false);
  });
});
