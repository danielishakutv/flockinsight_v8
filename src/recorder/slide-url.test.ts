import { describe, expect, it } from "vitest";
import { looksLikeImage, slideUrlAllowed } from "./ffmpeg";

/**
 * The recording service fetches slide images on the VPS, beside every other
 * site's app and the database. Only the media library's own addresses may be
 * fetched, and only image bytes handed to ffmpeg.
 */
describe("which slide URLs the recorder will fetch", () => {
  const site = "https://flockinsight.com";

  it("takes our own media, relative or absolute, and Cloudinary", () => {
    expect(slideUrlAllowed("/media/abc", site)?.href).toBe("https://flockinsight.com/media/abc");
    expect(slideUrlAllowed("https://flockinsight.com/media/abc", site)).not.toBeNull();
    expect(slideUrlAllowed("https://res.cloudinary.com/x/image/upload/a.jpg", site)).not.toBeNull();
  });

  it("refuses anything else", () => {
    for (const bad of [
      "http://127.0.0.1:3005/api/health",
      "http://169.254.169.254/latest/meta-data/",
      "https://evil.example/a.jpg",
      "http://res.cloudinary.com/x/a.jpg",
      "https://res.cloudinary.com:8443/x/a.jpg",
      "https://res.cloudinary.com.evil.example/a.jpg",
      "https://user:pw@res.cloudinary.com/a.jpg",
      "file:///etc/passwd",
      "//evil.example/a.jpg",
    ]) {
      expect(slideUrlAllowed(bad, site), bad).toBeNull();
    }
  });

  it("knows an image by its bytes", () => {
    expect(looksLikeImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLikeImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(true);
    expect(looksLikeImage(new TextEncoder().encode("#EXTM3U\nfile:///etc/passwd"))).toBe(false);
  });
});
