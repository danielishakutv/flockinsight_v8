import { beforeAll, describe, expect, it } from "vitest";

/**
 * The rule that must never quietly come back.
 *
 * An *incoming* transformation makes Cloudinary transcode a file before storing
 * it, synchronously — and above roughly 40 MB it refuses outright:
 *
 *   "Video is too large to process synchronously, please use an eager
 *    transformation with eager_async=true to resolve"
 *
 * That 400 arrives on the LAST chunk, after every byte has been uploaded, so it
 * surfaces in the browser as "Cloudinary accepted the file but did not confirm
 * it" and never reaches a server log. The effect was that every meeting
 * recording long enough to be worth keeping failed to save, for months, while
 * the few-megabyte ones worked and made it look intermittent.
 *
 * Measured against the live account: 67 MB of audio and 92 MB of video both
 * failed with the transformation and both uploaded cleanly without it.
 *
 * It is a one-line change and an entirely reasonable-looking optimisation to
 * re-add, which is exactly why it is pinned here.
 */

type SignDirectUpload = typeof import("@/lib/cloudinary").signDirectUpload;

let signDirectUpload: SignDirectUpload;
let MAX_ASSET_BYTES: number;

beforeAll(async () => {
  // signDirectUpload returns null unless the credentials look configured.
  process.env.CLOUDINARY_CLOUD_NAME ||= "test-cloud";
  process.env.CLOUDINARY_API_KEY ||= "test-key";
  process.env.CLOUDINARY_API_SECRET ||= "test-secret";
  const mod = await import("@/lib/cloudinary");
  signDirectUpload = mod.signDirectUpload;
  MAX_ASSET_BYTES = mod.MAX_ASSET_BYTES;
});

const ticketFor = (resourceType: "image" | "video" | "raw", audio = false) =>
  signDirectUpload({
    folder: "flockinsight/test",
    resourceType,
    audio,
    uniqueUploadId: "test-upload-id",
  });

describe("what Cloudinary is asked to do on the way in", () => {
  it("asks for NO transformation on video — this is the fix, not an omission", () => {
    const ticket = ticketFor("video");
    expect(ticket).not.toBeNull();
    expect(ticket!.transformation).toBeUndefined();
  });

  it("asks for no transformation on audio either", () => {
    // Audio rides on the video resource type; it hit the same synchronous
    // transcode limit, which is why a 63 MB audio recording would not save.
    const ticket = ticketFor("video", true);
    expect(ticket!.transformation).toBeUndefined();
  });

  it("still optimises images, which are small and never refused", () => {
    const ticket = ticketFor("image");
    expect(ticket!.transformation).toBe("c_limit,w_1920,h_1920,q_auto:good");
  });

  it("leaves raw files exactly as they arrive", () => {
    expect(ticketFor("raw")!.transformation).toBeUndefined();
  });

  it("signs the same parameters it sends, or every upload is rejected", () => {
    // The signature covers the transformation. If the ticket advertised one it
    // did not sign — or signed one it does not send — Cloudinary answers 401 on
    // every chunk and the cause is invisible from both ends.
    const ticket = ticketFor("video");
    expect(ticket!.signature).toMatch(/^[a-f0-9]{40}$/);
    expect(ticket!.folder).toBe("flockinsight/test");
    expect(ticket!.uniqueUploadId).toBe("test-upload-id");
    expect(ticket!.endpoint).toContain("/video/upload");
  });
});

describe("the per-file ceiling", () => {
  it("defaults to the Free plan's real limit rather than something hopeful", () => {
    // Cloudinary's own media_limits.video_max_size_bytes on this account.
    expect(MAX_ASSET_BYTES).toBe(100 * 1024 * 1024);
  });

  it("is a number the sign routes can compare against", () => {
    expect(Number.isFinite(MAX_ASSET_BYTES)).toBe(true);
    expect(MAX_ASSET_BYTES).toBeGreaterThan(0);
  });
});
