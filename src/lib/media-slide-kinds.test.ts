import { describe, expect, it } from "vitest";
import { escapeLike, isSlideKind, SLIDE_KINDS } from "@/lib/media-slide-kinds";

describe("what the slide picker may put on a meeting's screen", () => {
  it("never offers a contribution receipt or somebody's own photo", () => {
    // Receipts are bank tellers and transfer screenshots; anyone holding the
    // host link — a visiting speaker with no account — can open the picker.
    expect(isSlideKind("receipt")).toBe(false);
    expect(isSlideKind("member")).toBe(false);
    expect(isSlideKind("avatar")).toBe(false);
    expect(SLIDE_KINDS).not.toContain("receipt");
  });

  it("offers what a church would put on a screen", () => {
    for (const k of ["photo", "event", "sermon", "devotional", "studio", "file"])
      expect(isSlideKind(k)).toBe(true);
  });

  it("keeps a kind nobody has decided about off the screen", () => {
    expect(isSlideKind("something-new")).toBe(false);
    expect(isSlideKind(null)).toBe(false);
  });

  it("searches for the text typed, not LIKE's wildcards", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(escapeLike("Easter")).toBe("Easter");
  });
});
