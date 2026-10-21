import { describe, expect, it } from "vitest";
import { GUIDES } from "@/lib/help-guides";
import { guideChunks, guideMap, retrieve } from "./grounding";

const SLUGS = new Set(GUIDES.map((g) => g.slug));

describe("guideChunks", () => {
  it("yields at least one chunk for every guide", () => {
    const chunks = guideChunks();
    for (const g of GUIDES) expect(chunks.some((c) => c.slug === g.slug)).toBe(true);
  });

  it("tags every chunk with a real guide slug", () => {
    for (const c of guideChunks()) {
      expect(SLUGS.has(c.slug)).toBe(true);
      expect(c.header.startsWith(`[guide:${c.slug}]`)).toBe(true);
    }
  });

  it("lists every guide in the map", () => {
    const map = guideMap();
    for (const s of SLUGS) expect(map).toContain(`guide:${s} `);
  });
});

describe("retrieve", () => {
  it("finds the SMS guides for an SMS question", () => {
    const out = retrieve("How do I send an SMS to one group?", []);
    expect(out.guideSlugs.slice(0, 3)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^(communication|sms-sender-id)$/)]),
    );
  });

  it("stays within the budget and is deterministic", () => {
    const a = retrieve("How do I record attendance for two services?", [], 4000);
    const b = retrieve("How do I record attendance for two services?", [], 4000);
    expect(a.extracts.length).toBeLessThanOrEqual(4000);
    expect(a.extracts).toBe(b.extracts);
  });

  it("puts an approved answer first on its own keywords", () => {
    const out = retrieve("how do I zorbify the bulletin", [
      {
        id: "11111111-1111-4111-8111-111111111111",
        question: "How do I zorbify the weekly bulletin?",
        answer: "Open Media and press Zorbify.",
        keywords: ["zorbify", "bulletin"],
      },
    ]);
    expect(out.extracts.startsWith("[answer:A1]")).toBe(true);
    expect(out.answerCodes.get("A1")).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("falls back to getting-started when nothing matches", () => {
    const out = retrieve("", []);
    expect(out.guideSlugs).toEqual(["getting-started"]);
    const nonsense = retrieve("qqqxv wwwzt", []);
    expect(nonsense.guideSlugs).toEqual(["getting-started"]);
  });
});
