import { describe, expect, it } from "vitest";
import {
  NOT_A_NAME,
  PLACEHOLDERS,
  isOnlyPlaceholders,
  nameCandidates,
  redactKnownNames,
  scrub,
  scrubPatterns,
} from "./scrub";

describe("scrubPatterns removes personal details", () => {
  it.each([
    ["write to pastor.john@example.org about it", PLACEHOLDERS.email],
    ["call +234 803 123 4567 please", PLACEHOLDERS.phone],
    ["call 0803-123-4567 please", PLACEHOLDERS.phone],
    ["call 08031234567 please", PLACEHOLDERS.phone],
    ["her UK number is +44 20 7946 0958", PLACEHOLDERS.phone],
    ["my BVN is 22123456789", PLACEHOLDERS.number],
    ["account 0123456789 at the bank", PLACEHOLDERS.phone],
    ["she lives at 12 Adeola Odeku Street, Lagos", PLACEHOLDERS.address],
  ])("%s", (input, placeholder) => {
    const out = scrubPatterns(input);
    expect(out.text).toContain(placeholder);
    expect(out.redactions).toBe(1);
    expect(out.text).not.toMatch(/\d{7,}/);
  });

  it.each(["₦1,000,000", "50,000", "2026-10-21", "08:30", "7 Sundays", "3 groups on the way"])(
    "leaves %s alone",
    (input) => {
      const out = scrubPatterns(`How do I record ${input} for the service?`);
      expect(out.redactions).toBe(0);
      expect(out.text).toContain(input);
    },
  );

  it("is idempotent, so a second pass never eats a placeholder", () => {
    const once = scrubPatterns("mail a@b.co or call 08031234567");
    const twice = scrubPatterns(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.redactions).toBe(0);
  });
});

describe("names on the register", () => {
  it("redacts known names and keeps product words", () => {
    const out = redactKnownNames("how do I mark Grace Adebayo present", ["grace", "adebayo"]);
    expect(out.redactions).toBe(2);
    expect(out.text).toBe("how do I mark [name removed] [name removed] present");
  });

  it("never treats stoplisted words as candidates", () => {
    const cand = nameCandidates("How do I record Sunday church service attendance for Chidinma");
    for (const w of ["record", "sunday", "church", "service"]) expect(cand).not.toContain(w);
    expect(cand).toContain("chidinma");
  });

  it("never redacts a church-name word like assembly, even if a member is called that", () => {
    const out = redactKnownNames("how do I add an assembly admin", ["assembly", "admin"]);
    expect(out.redactions).toBe(0);
    expect(NOT_A_NAME.has("assembly")).toBe(true);
  });

  it("caps candidates at 40", () => {
    const words = Array.from({ length: 60 }, (_, i) => `zz${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}q`);
    expect(nameCandidates(words.join(" "))).toHaveLength(40);
  });

  it("scrub runs patterns and names together", () => {
    const out = scrub("Text Grace on 08031234567", ["grace"]);
    expect(out.text).toBe("Text [name removed] on [phone removed]");
    expect(out.redactions).toBe(2);
  });
});

describe("isOnlyPlaceholders", () => {
  it("is true when nothing but placeholders is left", () => {
    expect(isOnlyPlaceholders("[name removed] [phone removed]?")).toBe(true);
    expect(isOnlyPlaceholders("")).toBe(true);
  });
  it("is false when a question remains", () => {
    expect(isOnlyPlaceholders("how do I edit [name removed]?")).toBe(false);
  });
});
