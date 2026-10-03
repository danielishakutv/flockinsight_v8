import { describe, expect, it } from "vitest";
import {
  isLocallyStored,
  makeStorageKey,
  parseRange,
  resolveKey,
  tmpPathFor,
  validUploadId,
  MEDIA_ROOT,
} from "@/lib/media-store";
import { planFor } from "@/lib/media-transcode";

/**
 * The two things here that are easy to get subtly wrong and expensive to get
 * wrong: serving byte ranges, and resolving a path that came out of a database.
 *
 * Range parsing decides whether a two-hour service can be seeked, and whether
 * Safari will play it at all. A path that escapes the media root decides
 * whether a crafted row can read or delete arbitrary files as the app user.
 */

describe("which files live on this server", () => {
  it("takes video and audio, which Cloudinary will not store at size", () => {
    expect(isLocallyStored("video/webm")).toBe(true);
    expect(isLocallyStored("video/mp4")).toBe(true);
    expect(isLocallyStored("audio/webm")).toBe(true);
    expect(isLocallyStored("audio/mpeg")).toBe(true);
  });

  it("leaves images and documents on Cloudinary, which handles them well", () => {
    expect(isLocallyStored("image/jpeg")).toBe(false);
    expect(isLocallyStored("image/png")).toBe(false);
    expect(isLocallyStored("application/pdf")).toBe(false);
  });
});

describe("storage keys", () => {
  it("puts each church in its own directory", () => {
    const key = makeStorageKey("church-abc", "mp4");
    expect(key.startsWith("church-abc/")).toBe(true);
    expect(key.endsWith(".mp4")).toBe(true);
  });

  it("gives every file its own name, so two uploads never collide", () => {
    const a = makeStorageKey("c", "mp4");
    const b = makeStorageKey("c", "mp4");
    expect(a).not.toBe(b);
  });

  it("refuses a church id that would escape its directory", () => {
    // A church id is ours, not user input — but this is the one place a bad one
    // would become a filesystem path, so it is sanitised rather than trusted.
    expect(makeStorageKey("../../etc", "mp4").startsWith("etc/")).toBe(true);
    expect(() => makeStorageKey("../..", "mp4")).toThrow();
  });

  it("will not let an extension smuggle in a path", () => {
    expect(makeStorageKey("c", "../../x").includes("..")).toBe(false);
  });
});

describe("resolveKey", () => {
  it("resolves a normal key inside the media root", () => {
    expect(resolveKey("church/file.mp4")).toContain("church");
  });

  it("refuses anything that climbs out of the root", () => {
    // The key comes from a database row, and a row is only as trustworthy as
    // everything that has ever written to it.
    expect(() => resolveKey("../../../etc/passwd")).toThrow();
    expect(() => resolveKey("church/../../../root/.ssh/id_rsa")).toThrow();
  });

  it("has a root that is not inside a deployed release", () => {
    // A deploy replaces app/current wholesale. Media written in there would
    // vanish on the next release — invisible for a week, then total.
    expect(MEDIA_ROOT).not.toContain("/current");
    expect(MEDIA_ROOT).not.toContain("/releases/");
  });
});

describe("parseRange", () => {
  const SIZE = 1000;

  it("reads the ordinary form a video player sends", () => {
    expect(parseRange("bytes=0-499", SIZE)).toEqual({ start: 0, end: 499, size: SIZE });
  });

  it("reads an open-ended range as 'to the end'", () => {
    expect(parseRange("bytes=500-", SIZE)).toEqual({ start: 500, end: 999, size: SIZE });
  });

  it("reads a suffix range as 'the last N bytes'", () => {
    // Players use this to read the moov atom at the end of an MP4.
    expect(parseRange("bytes=-200", SIZE)).toEqual({ start: 800, end: 999, size: SIZE });
  });

  it("clamps an end past the file rather than reading off it", () => {
    expect(parseRange("bytes=900-99999", SIZE)).toEqual({
      start: 900,
      end: 999,
      size: SIZE,
    });
  });

  it("returns nothing when there is no range at all", () => {
    expect(parseRange(null, SIZE)).toBeNull();
    expect(parseRange("", SIZE)).toBeNull();
  });

  it("rejects nonsense instead of guessing", () => {
    expect(parseRange("bytes=abc-def", SIZE)).toBeNull();
    expect(parseRange("items=0-10", SIZE)).toBeNull();
    expect(parseRange("bytes=-", SIZE)).toBeNull();
    // Backwards, and past the end: both must be a 416, not a silent whole file.
    expect(parseRange("bytes=500-100", SIZE)).toBeNull();
    expect(parseRange("bytes=1000-", SIZE)).toBeNull();
    expect(parseRange("bytes=5000-6000", SIZE)).toBeNull();
  });

  it("handles a single-byte request, which players really do send", () => {
    expect(parseRange("bytes=0-0", SIZE)).toEqual({ start: 0, end: 0, size: SIZE });
  });
});

describe("what gets re-encoded", () => {
  it("converts WebM video, which iPhones will not play", () => {
    const plan = planFor("video/webm", "webm", 700_000);
    expect(plan).not.toBeNull();
    expect(plan!.ext).toBe("mp4");
    expect(plan!.mime).toBe("video/mp4");
  });

  it("converts WebM audio to something every device plays", () => {
    const plan = planFor("audio/webm", "webm", 64_000);
    expect(plan!.ext).toBe("m4a");
  });

  it("leaves an MP4 alone rather than burning CPU to re-encode it", () => {
    expect(planFor("video/mp4", "mp4")).toBeNull();
  });

  it("leaves an already-AAC audio file alone", () => {
    expect(planFor("audio/mp4", "m4a")).toBeNull();
  });

  it("ignores anything that is not video or audio", () => {
    expect(planFor("image/png", "png")).toBeNull();
    expect(planFor("application/pdf", "pdf")).toBeNull();
  });

  it("never lets the encoder exceed the source bitrate", () => {
    /*
     * Measured, not assumed: a plain `-crf 26` made a high-detail test file 53%
     * LARGER than the browser's original. A church paying for disk would have
     * been charged more for the privilege of a conversion, so the ceiling is
     * the lower of 1.2 Mbps and whatever the source already used.
     */
    const low = planFor("video/webm", "webm", 700_000)!;
    const maxrate = low.args[low.args.indexOf("-maxrate") + 1];
    expect(Number(maxrate)).toBeLessThanOrEqual(700_000);

    const high = planFor("video/webm", "webm", 10_000_000)!;
    const cap = high.args[high.args.indexOf("-maxrate") + 1];
    expect(Number(cap)).toBe(1_200_000);
  });

  it("starts playback before the whole file has downloaded", () => {
    // Without +faststart a two-hour service buffers to the end before it plays,
    // which reads as broken.
    const plan = planFor("video/webm", "webm", 700_000)!;
    expect(plan.args).toContain("+faststart");
  });

  it("caps resolution without upscaling anything smaller", () => {
    const plan = planFor("video/webm", "webm", 700_000)!;
    const vf = plan.args[plan.args.indexOf("-vf") + 1];
    expect(vf).toContain("min(1280,iw)");
  });
});

describe("in-progress uploads are scoped to one church", () => {
  /*
   * A security boundary, not tidiness. Upload ids may be supplied by the caller
   * so a recording can resume days later — and in one shared namespace that is
   * a cross-tenant hole: church B names church A's in-progress upload, calls
   * finish, and ends up with a media row in their own library pointing at
   * church A's recording. Caught by review before it reached anyone.
   */
  it("gives two churches different files for the same upload id", () => {
    const a = tmpPathFor("church-a", "shared-upload-id");
    const b = tmpPathFor("church-b", "shared-upload-id");
    expect(a).not.toBe(b);
  });

  it("is stable for the same church, so a resume finds its own file", () => {
    expect(tmpPathFor("church-a", "my-upload-id")).toBe(
      tmpPathFor("church-a", "my-upload-id"),
    );
  });

  it("cannot be made to climb out of the temp directory", () => {
    const p = tmpPathFor("church-a", "../../../etc/passwd");
    expect(p).not.toContain("..");
    expect(p.startsWith(MEDIA_ROOT) || p.includes("media")).toBe(true);
    // A church id that tried the same thing is sanitised, not obeyed.
    expect(tmpPathFor("../../root", "abcdefgh")).not.toContain("..");
  });

  it("refuses an id short enough to collide with somebody else's by guesswork", () => {
    expect(validUploadId("abc")).toBe(false);
    expect(validUploadId("")).toBe(false);
    expect(validUploadId("../../etc/passwd")).toBe(false);
    expect(validUploadId("has spaces in it")).toBe(false);
    expect(validUploadId("a".repeat(65))).toBe(false);
  });

  it("accepts an ordinary uuid and a reasonable custom id", () => {
    expect(validUploadId("3f6b1a2c-9d4e-4f8a-bc12-0a1b2c3d4e5f")).toBe(true);
    expect(validUploadId("recording-2026-10-03-abc")).toBe(true);
  });
});
