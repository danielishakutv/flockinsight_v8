import { describe, expect, it } from "vitest";
import { claimsKeyForSearch } from "@/lib/select-keys";

describe("claimsKeyForSearch", () => {
  it("takes letters, digits and punctuation for the search field", () => {
    for (const key of ["a", "Z", "7", "-", "'"]) {
      expect(claimsKeyForSearch({ key }, "")).toBe(true);
    }
  });

  it("takes Backspace so the query can be corrected from the list", () => {
    expect(claimsKeyForSearch({ key: "Backspace" }, "mary")).toBe(true);
    expect(claimsKeyForSearch({ key: "Backspace" }, "")).toBe(true);
  });

  it("takes a space once something has been typed", () => {
    // Regression: a space used to reach the option under the pointer, which
    // Radix reads as "pick this one", so two-word names closed the dropdown.
    expect(claimsKeyForSearch({ key: " " }, "mary")).toBe(true);
  });

  it("leaves a space alone while the query is empty", () => {
    // Nothing typed yet, so space keeps its usual meaning: pick this option.
    expect(claimsKeyForSearch({ key: " " }, "")).toBe(false);
  });

  it("leaves named keys to the list", () => {
    for (const key of [
      "Enter",
      "ArrowDown",
      "ArrowUp",
      "Tab",
      "Escape",
      "Home",
    ]) {
      expect(claimsKeyForSearch({ key }, "mary")).toBe(false);
    }
  });

  it("leaves shortcuts alone", () => {
    expect(claimsKeyForSearch({ key: "a", ctrlKey: true }, "mary")).toBe(false);
    expect(claimsKeyForSearch({ key: "c", metaKey: true }, "mary")).toBe(false);
    expect(claimsKeyForSearch({ key: "f", altKey: true }, "mary")).toBe(false);
  });
});
