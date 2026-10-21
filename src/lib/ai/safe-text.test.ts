import { describe, expect, it } from "vitest";
import { scrubFreeText } from "./safe-text";

const s = (t: string, max = 2000) => scrubFreeText(t, max).text;

describe("scrubFreeText", () => {
  it("removes email addresses", () => {
    expect(s("Write to pastor@example.org today")).toBe("Write to [email removed] today");
  });

  it("removes Nigerian phone formats: 080…, +234…, spaced and dashed", () => {
    for (const phone of ["08031234567", "+2348031234567", "0803 123 4567", "+234 803-123-4567", "(0803) 123 4567"]) {
      const out = s(`Call ${phone} now`);
      expect(out, phone).not.toMatch(/\d{3}/);
      expect(out).toContain("[phone removed]");
    }
  });

  it("removes UUIDs and links with query strings, keeps plain links", () => {
    expect(s("id 6f1c2b8e-3d4a-4e5f-9a7b-1c2d3e4f5a6b")).toBe("id [id removed]");
    expect(s("see https://x.org/p?member=7&t=abc ok")).toBe("see [link removed] ok");
    expect(s("see https://flockinsight.com/help")).toBe("see https://flockinsight.com/help");
  });

  it("leaves dates, money with commas and small numbers alone", () => {
    expect(s("On 2026-10-21 we gave ₦1,000,000 over 7 Sundays")).toBe(
      "On 2026-10-21 we gave ₦1,000,000 over 7 Sundays",
    );
  });

  it("removes long digit runs", () => {
    expect(s("account 1234567890123")).not.toMatch(/\d{7}/);
  });

  it("is idempotent", () => {
    const once = s("Mail a@b.co or call +234 803 123 4567, ref 6f1c2b8e-3d4a-4e5f-9a7b-1c2d3e4f5a6b", 60);
    expect(s(once, 60)).toBe(once);
  });

  it("caps the length", () => {
    expect(s("a".repeat(50), 10)).toHaveLength(10);
    expect(scrubFreeText("hello", 100).kind).toBe("text");
  });
});
