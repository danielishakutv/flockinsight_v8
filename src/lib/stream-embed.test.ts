import { describe, expect, it } from "vitest";
import { parseEmbed } from "@/lib/stream-embed";

/**
 * A pastor pastes whatever their browser or phone gave them. Every shape here
 * is one somebody will actually paste, and the ones that must be refused are
 * refused for a reason rather than because the parser gave up.
 */

describe("parseEmbed — YouTube", () => {
  it("takes the ordinary watch link", () => {
    expect(parseEmbed("https://www.youtube.com/watch?v=abc123").embedUrl).toBe(
      "https://www.youtube.com/embed/abc123",
    );
  });

  it("takes the share link", () => {
    expect(parseEmbed("https://youtu.be/abc123").embedUrl).toBe(
      "https://www.youtube.com/embed/abc123",
    );
  });

  it("takes a watch link carrying a timestamp and a playlist", () => {
    expect(
      parseEmbed("https://www.youtube.com/watch?v=abc123&t=90s&list=PL1").embedUrl,
    ).toBe("https://www.youtube.com/embed/abc123");
  });

  it("takes the /live/<id> form", () => {
    expect(parseEmbed("https://www.youtube.com/live/xyz789").embedUrl).toBe(
      "https://www.youtube.com/embed/xyz789",
    );
  });

  it("takes an embed link that is already an embed", () => {
    expect(parseEmbed("https://www.youtube.com/embed/abc123").embedUrl).toBe(
      "https://www.youtube.com/embed/abc123",
    );
  });

  it("takes a channel's standing live address", () => {
    // The link a church that streams every Sunday actually wants, because it
    // is the same one next week.
    const r = parseEmbed("https://www.youtube.com/@mychurch/live");
    expect(r.provider).toBe("youtube");
    expect(r.embedUrl).toContain("live_stream");
    expect(r.embedUrl).toContain("mychurch");
  });

  it("takes the mobile host", () => {
    expect(parseEmbed("https://m.youtube.com/watch?v=abc123").embedUrl).toBe(
      "https://www.youtube.com/embed/abc123",
    );
  });

  it("explains itself on a YouTube link with no video in it", () => {
    const r = parseEmbed("https://www.youtube.com/feed/subscriptions");
    expect(r.embedUrl).toBeNull();
    expect(r.error).toContain("YouTube");
  });
});

describe("parseEmbed — Facebook and Vimeo", () => {
  it("passes a Facebook video URL to the plugin player", () => {
    const r = parseEmbed("https://www.facebook.com/mychurch/videos/123456");
    expect(r.provider).toBe("facebook");
    expect(r.embedUrl).toContain("plugins/video.php");
    expect(r.embedUrl).toContain(encodeURIComponent("facebook.com/mychurch/videos/123456"));
  });

  it("takes a Vimeo video", () => {
    expect(parseEmbed("https://vimeo.com/123456789").embedUrl).toBe(
      "https://player.vimeo.com/video/123456789",
    );
  });

  it("takes a Vimeo event, which is what a livestream is there", () => {
    expect(parseEmbed("https://vimeo.com/event/98765").embedUrl).toBe(
      "https://vimeo.com/event/98765/embed",
    );
  });
});

describe("parseEmbed — what it refuses", () => {
  it("adds the scheme people leave off", () => {
    expect(parseEmbed("youtube.com/watch?v=abc123").embedUrl).toBe(
      "https://www.youtube.com/embed/abc123",
    );
  });

  it("refuses plain http", () => {
    // The embed runs inside our page; an http frame breaks the padlock on a
    // page the church sends its whole congregation to.
    const r = parseEmbed("http://www.youtube.com/watch?v=abc123");
    expect(r.embedUrl).toBeNull();
    expect(r.error).toContain("https");
  });

  it("refuses a host we do not embed", () => {
    // Anything else would be somebody's arbitrary javascript in a frame on
    // our origin.
    const r = parseEmbed("https://evil.example.com/player");
    expect(r.embedUrl).toBeNull();
    expect(r.error).toContain("YouTube");
  });

  it("refuses a host that merely ends with a trusted name", () => {
    expect(parseEmbed("https://youtube.com.evil.example/x").embedUrl).toBeNull();
  });

  it("refuses text that is not a link", () => {
    expect(parseEmbed("our service is at 9am").embedUrl).toBeNull();
  });

  it("refuses an empty box without shouting about it", () => {
    const r = parseEmbed("   ");
    expect(r.embedUrl).toBeNull();
    expect(r.error).toBeTruthy();
  });
});
