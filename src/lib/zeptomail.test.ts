import { describe, expect, it } from "vitest";
import { mapZeptoEvent, zeptoReason } from "@/lib/delivery-status";
import { splitFrom } from "@/lib/mailer";

describe("splitFrom", () => {
  it("separates a display name from the address", () => {
    expect(splitFrom("FlockInsight <no-reply@flockinsight.com>")).toEqual({
      address: "no-reply@flockinsight.com",
      name: "FlockInsight",
    });
  });

  it("handles a church's own name in the display part", () => {
    expect(splitFrom("Grace Chapel <no-reply@flockinsight.com>")).toEqual({
      address: "no-reply@flockinsight.com",
      name: "Grace Chapel",
    });
  });

  it("strips surrounding quotes some clients add", () => {
    expect(splitFrom('"Grace Chapel" <no-reply@flockinsight.com>')).toEqual({
      address: "no-reply@flockinsight.com",
      name: "Grace Chapel",
    });
  });

  it("accepts a bare address with no display name", () => {
    expect(splitFrom("no-reply@flockinsight.com")).toEqual({
      address: "no-reply@flockinsight.com",
    });
  });

  it("omits an empty name rather than sending an empty string", () => {
    // ZeptoMail rejects a from object with a blank name.
    expect(splitFrom("  <no-reply@flockinsight.com>")).toEqual({
      address: "no-reply@flockinsight.com",
    });
  });
});

describe("mapZeptoEvent", () => {
  it("records the delivery outcomes we care about", () => {
    expect(mapZeptoEvent("email_delivered")).toBe("delivered");
    expect(mapZeptoEvent("email_bounce")).toBe("undelivered");
    expect(mapZeptoEvent("hardbounce")).toBe("undelivered");
    expect(mapZeptoEvent("softbounce")).toBe("undelivered");
    expect(mapZeptoEvent("spam")).toBe("undelivered");
  });

  it("copes with the casing and separators ZeptoMail has used", () => {
    expect(mapZeptoEvent("Email_Delivered")).toBe("delivered");
    expect(mapZeptoEvent("email delivered")).toBe("delivered");
    expect(mapZeptoEvent("email-bounce")).toBe("undelivered");
    expect(mapZeptoEvent("  EMAIL_BOUNCE  ")).toBe("undelivered");
  });

  it("ignores engagement events on purpose", () => {
    // Church email carries no tracking pixels, and a pastor does not need to
    // know who opened the newsletter.
    expect(mapZeptoEvent("email_open")).toBeNull();
    expect(mapZeptoEvent("email_link_click")).toBeNull();
  });

  it("returns null for anything unrecognised instead of guessing", () => {
    expect(mapZeptoEvent("something_new")).toBeNull();
    expect(mapZeptoEvent("")).toBeNull();
  });
});

describe("zeptoReason", () => {
  it("explains a bounce in words a church secretary can act on", () => {
    expect(zeptoReason("email_bounce", "550 5.1.1 user unknown")).toBe(
      "Bounced — 550 5.1.1 user unknown",
    );
    expect(zeptoReason("email_bounce", null)).toBe(
      "Bounced — the address rejected it",
    );
  });

  it("names a spam complaint plainly", () => {
    expect(zeptoReason("spam", null)).toBe("Marked as spam by the recipient");
  });

  it("passes a detail through when the event is not one we phrase", () => {
    expect(zeptoReason("email_delivered", "queued")).toBe("queued");
    expect(zeptoReason("email_delivered", null)).toBeNull();
  });
});
