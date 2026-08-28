import { describe, expect, it } from "vitest";
import {
  isChurchVerified,
  maskEmail,
  maskPhone,
  missingVerificationLabel,
  verificationState,
} from "@/lib/verification-shared";

const STAMP = new Date("2026-08-28T09:00:00Z");

describe("verificationState", () => {
  it("needs both channels for a tick", () => {
    expect(
      verificationState({
        contactEmail: "office@church.org",
        contactPhone: "2348012345678",
        emailVerifiedAt: STAMP,
        phoneVerifiedAt: STAMP,
      }),
    ).toBe("verified");
  });

  it("one channel alone is only partial", () => {
    expect(
      verificationState({
        contactEmail: "office@church.org",
        contactPhone: "2348012345678",
        emailVerifiedAt: STAMP,
        phoneVerifiedAt: null,
      }),
    ).toBe("partial");
  });

  it("is unverified with nothing on file", () => {
    expect(verificationState({})).toBe("unverified");
  });

  // The stamp is meaningless without the value it vouches for: clearing a
  // detail must drop the tick even if an old timestamp is still lying around.
  it("a stamp without its value doesn't count", () => {
    expect(
      isChurchVerified({
        contactEmail: null,
        contactPhone: "2348012345678",
        emailVerifiedAt: STAMP,
        phoneVerifiedAt: STAMP,
      }),
    ).toBe(false);
  });

  // Dates come back as ISO strings once they've been through a cache or a
  // server→client boundary — the same rules have to hold for both shapes.
  it("accepts ISO strings as well as Dates", () => {
    expect(
      isChurchVerified({
        contactEmail: "office@church.org",
        contactPhone: "2348012345678",
        emailVerifiedAt: STAMP.toISOString(),
        phoneVerifiedAt: STAMP.toISOString(),
      }),
    ).toBe(true);
  });

  it("ignores an unparseable stamp rather than trusting it", () => {
    expect(
      isChurchVerified({
        contactEmail: "office@church.org",
        contactPhone: "2348012345678",
        emailVerifiedAt: "not a date",
        phoneVerifiedAt: STAMP,
      }),
    ).toBe(false);
  });
});

describe("missingVerificationLabel", () => {
  it("names both when nothing is verified", () => {
    expect(missingVerificationLabel({})).toBe("email address and phone number");
  });

  it("names only what's left", () => {
    expect(
      missingVerificationLabel({
        contactEmail: "office@church.org",
        emailVerifiedAt: STAMP,
      }),
    ).toBe("phone number");
  });
});

describe("masking", () => {
  it("keeps the domain and the first letter of an email", () => {
    expect(maskEmail("pastor@grace.org")).toBe("p•••••@grace.org");
  });

  it("keeps the last four digits of a phone number", () => {
    expect(maskPhone("+234 803 456 7890")).toBe("••• ••• 7890");
  });
});
