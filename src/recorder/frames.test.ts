import { describe, expect, it } from "vitest";
import { CAMERA_FRESH_MS, isRealFrame, jpegSize, pickFrame } from "./frames";

/**
 * An OFF camera now sends a 64x36 black canvas to keep its publication alive,
 * and those frames reach the recorder through the same adapter as real ones.
 * These pin the rule that keeps a black rectangle off the recording: a frame
 * is judged by the size in its own header.
 */

const APP0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
const SOS = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00];

/** A JPEG's marker structure, with as much filler for image data as asked. */
function jpeg(o: { width: number; height: number; sof?: number; before?: number[]; data?: number }): Uint8Array {
  const { width: w, height: h } = o;
  const sof = [
    0xff, o.sof ?? 0xc0, 0x00, 0x11, 0x08,
    h >> 8, h & 0xff, w >> 8, w & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  const data = new Array(o.data ?? 64).fill(0x55);
  return Uint8Array.from([0xff, 0xd8, ...APP0, ...(o.before ?? []), ...sof, ...SOS, ...data, 0xff, 0xd9]);
}

describe("reading a JPEG's size", () => {
  it("reads baseline and progressive frame headers", () => {
    expect(jpegSize(jpeg({ width: 640, height: 360 }))).toEqual({ width: 640, height: 360 });
    expect(jpegSize(jpeg({ width: 1280, height: 720, sof: 0xc2 }))).toEqual({ width: 1280, height: 720 });
  });

  it("does not mistake a Huffman table (C4) for a frame header", () => {
    const dht = [0xff, 0xc4, 0x00, 0x05, 0x10, 0x20, 0x30];
    expect(jpegSize(jpeg({ width: 320, height: 180, before: dht }))).toEqual({ width: 320, height: 180 });
  });

  it("skips fill bytes before a marker", () => {
    expect(jpegSize(jpeg({ width: 320, height: 180, before: [0xff, 0xff] }))).toEqual({ width: 320, height: 180 });
  });

  it("returns null for anything it cannot read", () => {
    expect(jpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBeNull(); // PNG
    expect(jpegSize(Uint8Array.from([0xff, 0xd8, ...SOS, 0xff, 0xd9]))).toBeNull(); // image data before any header
    expect(jpegSize(jpeg({ width: 640, height: 360 }).subarray(0, 26))).toBeNull(); // cut off mid-header
    expect(jpegSize(Uint8Array.from([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00]))).toBeNull(); // no marker where one must be
    expect(jpegSize(jpeg({ width: 0, height: 360 }))).toBeNull();
  });
});

describe("which frames are a picture of somebody", () => {
  it("refuses the 64x36 placeholder, either way round, and anything smaller", () => {
    expect(isRealFrame(jpeg({ width: 64, height: 36 }))).toBe(false);
    expect(isRealFrame(jpeg({ width: 36, height: 64 }))).toBe(false);
    expect(isRealFrame(jpeg({ width: 32, height: 18 }))).toBe(false);
  });

  it("takes a real camera frame, however small the camera's profile", () => {
    expect(isRealFrame(jpeg({ width: 160, height: 90 }))).toBe(true);
    expect(isRealFrame(jpeg({ width: 320, height: 180 }))).toBe(true);
    expect(isRealFrame(jpeg({ width: 1280, height: 720, sof: 0xc2 }))).toBe(true);
  });

  it("refuses a tiny frame it cannot read, but not a large one", () => {
    const unreadable = (n: number) => Uint8Array.from([0xff, 0xd8, ...new Array(n).fill(0)]);
    expect(isRealFrame(unreadable(500))).toBe(false);
    expect(isRealFrame(unreadable(4000))).toBe(true);
  });

  it("refuses what is not a JPEG at all, whatever its size", () => {
    expect(isRealFrame(new Uint8Array(10_000))).toBe(false);
    expect(isRealFrame(new Uint8Array(0))).toBe(false);
  });
});

describe("what goes on screen while a track is on stage", () => {
  const card = "name card";
  const cam = "camera frame";
  const now = 100_000;

  it("shows the camera while its last real frame is fresh", () => {
    expect(pickFrame({ onTrack: true, camera: cam, cameraAt: now - 500, still: card, now })).toBe(cam);
    expect(pickFrame({ onTrack: true, camera: cam, cameraAt: now - CAMERA_FRESH_MS, still: card, now })).toBe(cam);
  });

  it("falls back to the name card when the camera has gone quiet", () => {
    expect(pickFrame({ onTrack: true, camera: cam, cameraAt: now - CAMERA_FRESH_MS - 1, still: card, now })).toBe(card);
  });

  it("shows the name card before the first real frame of a new track", () => {
    expect(pickFrame({ onTrack: true, camera: null, cameraAt: 0, still: card, now })).toBe(card);
  });

  it("holds a shared screen's last real frame however long the screen sits still", () => {
    expect(pickFrame({ onTrack: true, camera: cam, cameraAt: now - 60_000, still: card, now, freshMs: Infinity })).toBe(cam);
    expect(pickFrame({ onTrack: true, camera: null, cameraAt: 0, still: card, now, freshMs: Infinity })).toBe(card);
  });

  it("never shows a camera frame when the stage is a card or a slide", () => {
    expect(pickFrame({ onTrack: false, camera: cam, cameraAt: now, still: "verse", now })).toBe("verse");
  });
});
