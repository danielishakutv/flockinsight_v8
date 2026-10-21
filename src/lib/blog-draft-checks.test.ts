import { describe, expect, it } from "vitest";
import { FORBIDDEN_CLAIMS } from "@/lib/seo/keywords";
import { draftFlags, forbiddenClaimsIn, mentionsPrice, publishRefusal } from "./blog-draft-checks";

const topic = { primary: "church attendance app", canonicalPath: "/solutions/church-attendance-app" };
const clean = {
  title: "How do churches count attendance on a phone?",
  body: "Start here. See [the attendance app](/solutions/church-attendance-app) for details.",
};

describe("draftFlags", () => {
  it("blocks every forbidden phrase, in any case", () => {
    for (const c of FORBIDDEN_CLAIMS) {
      const flags = draftFlags({ title: "t", body: `We are ${c.phrase.toUpperCase()} for churches.` }, null);
      expect(flags.blocking.length, c.phrase).toBeGreaterThan(0);
      expect(forbiddenClaimsIn(c.phrase.toLowerCase())).toHaveLength(1);
    }
  });

  it("warns on a price", () => {
    expect(mentionsPrice("only ₦5,000 a month")).toBe(true);
    expect(mentionsPrice("$20/mo")).toBe(true);
    expect(mentionsPrice("seven Sundays free")).toBe(false);
    const flags = draftFlags({ ...clean, body: `${clean.body} It costs ₦5000.` }, topic);
    expect(flags.blocking).toHaveLength(0);
    expect(flags.warnings.map((w) => w.code)).toContain("price");
  });

  it("warns on a missing canonical link and a keyword title", () => {
    const flags = draftFlags({ title: "Church attendance app", body: "No links here." }, topic);
    expect(flags.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["canonical", "title"]));
    expect(draftFlags(clean, topic).warnings).toHaveLength(0);
  });
});

describe("publishRefusal", () => {
  const none = { blocking: [], warnings: [] };

  it("refuses an AI post nobody has read or confirmed", () => {
    expect(publishRefusal({ source: "ai", reviewedAt: null, flags: none })).toMatch(/never published unread/);
  });

  it("passes an AI post that is confirmed now or was reviewed before", () => {
    expect(publishRefusal({ source: "ai", reviewedAt: null, confirmReviewed: true, flags: none })).toBeNull();
    expect(publishRefusal({ source: "ai", reviewedAt: new Date(), flags: none })).toBeNull();
  });

  it("passes human posts, whatever they say", () => {
    const flags = draftFlags({ title: "t", body: "trusted by thousands" }, null);
    expect(publishRefusal({ source: "human", reviewedAt: null, flags })).toBeNull();
  });

  it("blocks a forbidden claim on an AI post, naming the phrase and why", () => {
    const flags = draftFlags({ title: "t", body: "Trusted by thousands of churches" }, null);
    const refusal = publishRefusal({ source: "ai", reviewedAt: null, confirmReviewed: true, flags });
    expect(refusal).toContain('Remove "trusted by thousands"');
    expect(refusal).toContain(FORBIDDEN_CLAIMS[0].why);
  });
});
