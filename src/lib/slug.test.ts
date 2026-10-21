import { describe, expect, it } from "vitest";
import { slugify, slugifyTyping } from "@/lib/slug";

/**
 * A form's public address is typed into a field that tidies on every
 * keystroke. Running the full slugify there deleted a hyphen the moment it was
 * typed, so "youth-camp" could only ever be typed as "youthcamp".
 */

describe("slugifyTyping", () => {
  it("lets a two-word address be typed one key at a time", () => {
    let field = "";
    for (const ch of "Youth Camp") field = slugifyTyping(field + ch);
    expect(field).toBe("youth-camp");

    field = "";
    for (const ch of "youth-camp") field = slugifyTyping(field + ch);
    expect(field).toBe("youth-camp");
  });

  it("keeps one trailing separator and drops leading ones", () => {
    expect(slugifyTyping("youth-")).toBe("youth-");
    expect(slugifyTyping("youth  ")).toBe("youth-");
    expect(slugifyTyping(" -youth")).toBe("youth");
    expect(slugifyTyping("Youth!! Camp")).toBe("youth-camp");
  });

  it("finishes as slugify would, once the field is left", () => {
    for (const typed of ["youth-", "Youth Camp ", "--a--b--"]) {
      expect(slugify(slugifyTyping(typed))).toBe(slugify(typed));
    }
  });
});
