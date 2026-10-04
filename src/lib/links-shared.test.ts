import { describe, expect, it } from "vitest";
import {
  CODE_MIN,
  RESERVED_CODES,
  checkDestination,
  codeProblem,
  deviceOf,
  normaliseCode,
  prettyDestination,
  qrTargetUrl,
  randomCode,
  refusalFor,
  shortUrl,
  shortUrlForPrint,
  sourceOf,
} from "@/lib/links-shared";

describe("codes", () => {
  it("tidies what people type without rejecting it", () => {
    expect(normaliseCode("  Grace Sunday!  ")).toBe("grace-sunday");
    expect(normaliseCode("GIVE")).toBe("give");
    expect(normaliseCode("a--b")).toBe("a-b");
    expect(normaliseCode("--give--")).toBe("give");
    expect(normaliseCode("Órder of Service")).toBe("rder-of-service");
  });

  it("accepts a plain code", () => {
    expect(codeProblem("give")).toBeNull();
    expect(codeProblem("carol-service-2026")).toBeNull();
    expect(codeProblem("a1b")).toBeNull();
  });

  it("refuses a code too short to survive a typo", () => {
    expect(codeProblem("")).toContain("short code");
    expect(codeProblem("ab")).toContain(String(CODE_MIN));
  });

  it("refuses a code that is not a code, saying what one looks like", () => {
    expect(codeProblem("Give")).toContain("lowercase");
    expect(codeProblem("-give")).toContain("lowercase");
    expect(codeProblem("give-")).toContain("lowercase");
    expect(codeProblem("gi ve")).toContain("lowercase");
  });

  it("refuses the words that would make a link look like it came from us", () => {
    for (const word of ["login", "password", "billing", "superadmin", "flockinsight"]) {
      expect(RESERVED_CODES.has(word), word).toBe(true);
      expect(codeProblem(word), word).toContain("reserved");
    }
    // And it says WHY, since "reserved" alone sounds arbitrary.
    expect(codeProblem("login")).toContain("came from us");
  });

  describe("generated codes", () => {
    it("leaves out every character that is mistaken for another", () => {
      // The whole reason for a custom alphabet: these links are read off
      // posters and typed by hand.
      const sample = Array.from({ length: 400 }, () => randomCode(8)).join("");
      for (const confusable of ["0", "o", "1", "l", "i"]) {
        expect(sample.includes(confusable), `contains "${confusable}"`).toBe(false);
      }
    });

    it("produces a valid code of the requested length", () => {
      for (const length of [4, 6, 10]) {
        const code = randomCode(length);
        expect(code).toHaveLength(length);
        expect(codeProblem(code), code).toBeNull();
      }
    });

    it("does not repeat itself", () => {
      const codes = new Set(Array.from({ length: 500 }, () => randomCode(6)));
      // 31^6 is 28 million; 500 draws colliding would mean a broken generator.
      expect(codes.size).toBe(500);
    });
  });
});

describe("destinations", () => {
  it("adds a scheme to what people actually paste", () => {
    expect(checkDestination("flockinsight.com/give")).toEqual({
      ok: true,
      url: "https://flockinsight.com/give",
    });
    // Without this, `new URL` reads "flockinsight.com" as the scheme.
    expect(checkDestination("grace.church")).toMatchObject({
      ok: true,
      url: "https://grace.church/",
    });
  });

  it("keeps a scheme that is already there", () => {
    expect(checkDestination("http://example.com/x")).toMatchObject({
      url: "http://example.com/x",
    });
  });

  it("allows an email address and a phone number, which belong on a poster", () => {
    expect(checkDestination("mailto:office@grace.church").ok).toBe(true);
    expect(checkDestination("tel:+2348088256055").ok).toBe(true);
  });

  it("refuses a script destination outright", () => {
    /*
     * The reason the scheme check is a list of what is ALLOWED. A short link
     * is a redirect somebody else clicks, so this would be a script running
     * on our domain, under our name, from a link a church handed out.
     */
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "file:///etc/passwd",
    ]) {
      const res = checkDestination(bad);
      expect(res.ok, bad).toBe(false);
      if (!res.ok) expect(res.error).toContain("short link can point to");
    }
  });

  it("refuses nothing, and something that is not an address", () => {
    expect(checkDestination("")).toMatchObject({ ok: false });
    expect(checkDestination("   ")).toMatchObject({ ok: false });
    const res = checkDestination("http://");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/web address|no website/);
  });

  it("refuses something far too long for a column", () => {
    expect(checkDestination(`https://x.com/${"a".repeat(2100)}`)).toMatchObject({
      ok: false,
    });
  });

  it("refuses one of our own short links, which can loop", () => {
    const res = checkDestination("https://flockinsight.com/l/other", "flockinsight.com");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("loop");
  });

  it("allows any other page on our own domain", () => {
    // A church pointing a poster at its own public page is the normal case.
    expect(checkDestination("https://flockinsight.com/c/grace", "flockinsight.com").ok).toBe(
      true,
    );
    // And a short link on somebody else's shortener is their business.
    expect(checkDestination("https://bit.ly/l/x", "flockinsight.com").ok).toBe(true);
  });
});

describe("how a link is printed", () => {
  it("builds the link, with and without the scheme", () => {
    expect(shortUrl("https://flockinsight.com", "give")).toBe(
      "https://flockinsight.com/l/give",
    );
    expect(shortUrl("https://flockinsight.com/", "give")).toBe(
      "https://flockinsight.com/l/give",
    );
    // A poster does not want "https://" on it.
    expect(shortUrlForPrint("https://flockinsight.com", "give")).toBe(
      "flockinsight.com/l/give",
    );
  });

  it("marks a QR code's target so a scan can be told from a click", () => {
    expect(qrTargetUrl("https://flockinsight.com", "give")).toBe(
      "https://flockinsight.com/l/give?s=qr",
    );
  });

  it("shortens a long destination in the middle, keeping the host and the end", () => {
    // The end of a URL is usually the part that says what it is.
    const long = "https://docs.google.com/forms/d/e/1FAIpQLSd-very-long-id-here/viewform";
    const pretty = prettyDestination(long, 40);
    expect(pretty.startsWith("docs.google.com/")).toBe(true);
    expect(pretty).toContain("…");
    expect(pretty).toContain("viewform");
    expect(pretty.length).toBeLessThanOrEqual(40);
  });

  it("leaves a short destination alone, minus the noise", () => {
    expect(prettyDestination("https://grace.church/give/")).toBe("grace.church/give");
  });
});

describe("why a link will not redirect", () => {
  const now = new Date("2026-10-04T12:00:00Z");

  it("redirects a live link with no expiry", () => {
    expect(refusalFor({ status: "active", expiresAt: null }, now)).toBeNull();
  });

  it("names each reason separately, so a church can tell them apart", () => {
    expect(refusalFor({ status: "paused", expiresAt: null }, now)).toBe("paused");
    expect(refusalFor({ status: "archived", expiresAt: null }, now)).toBe("archived");
    expect(
      refusalFor({ status: "active", expiresAt: new Date("2026-10-03T12:00:00Z") }, now),
    ).toBe("expired");
  });

  it("honours an expiry that is still in the future", () => {
    expect(
      refusalFor({ status: "active", expiresAt: new Date("2026-10-05T12:00:00Z") }, now),
    ).toBeNull();
  });

  it("accepts an expiry that arrived from the database as a string", () => {
    // Which is what a cached page hands back — see the Date-through-cache trap.
    expect(refusalFor({ status: "active", expiresAt: "2026-10-03T12:00:00Z" }, now)).toBe(
      "expired",
    );
    expect(refusalFor({ status: "active", expiresAt: "2026-10-05T12:00:00Z" }, now)).toBeNull();
  });

  it("treats an unreadable expiry as expired, not as never", () => {
    // The safe reading of a broken value: a link the church asked to stop
    // working must not keep working for ever because a date would not parse.
    expect(refusalFor({ status: "active", expiresAt: "not a date" }, now)).toBe("expired");
  });
});

describe("counting a click", () => {
  it("counts a scan as a scan, whatever the referrer says", () => {
    expect(sourceOf(null, true)).toBe("qr");
    expect(sourceOf("https://facebook.com/x", true)).toBe("qr");
  });

  it("counts no referrer as direct, which is what a typed link looks like", () => {
    expect(sourceOf(null, false)).toBe("direct");
    expect(sourceOf("", false)).toBe("direct");
    expect(sourceOf("not a url", false)).toBe("direct");
  });

  it("reduces a referrer to its host, without the www", () => {
    expect(sourceOf("https://www.facebook.com/groups/x", false)).toBe("facebook.com");
    expect(sourceOf("https://t.co/abc", false)).toBe("t.co");
  });

  it("sorts a user agent into one of three buckets", () => {
    expect(
      deviceOf(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      ),
    ).toBe("phone");
    expect(
      deviceOf("Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Mobile Safari"),
    ).toBe("phone");
    expect(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    // Android without "Mobile" is the convention for a tablet.
    expect(deviceOf("Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Safari")).toBe(
      "tablet",
    );
    expect(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("computer");
  });

  it("calls an absent user agent a computer rather than throwing", () => {
    expect(deviceOf(null)).toBe("computer");
    expect(deviceOf("")).toBe("computer");
  });
});
