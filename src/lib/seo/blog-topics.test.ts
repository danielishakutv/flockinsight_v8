import { describe, expect, it } from "vitest";
import { allSeoPaths } from "./pages";
import { BLOG_TOPICS, nextTopic } from "./blog-topics";

describe("BLOG_TOPICS", () => {
  it("leaves the category terms out", () => {
    expect(BLOG_TOPICS.some((t) => t.tier === "category")).toBe(false);
    expect(BLOG_TOPICS.length).toBeGreaterThan(5);
  });

  it("links every topic to a page that exists", () => {
    const paths = new Set(allSeoPaths());
    for (const t of BLOG_TOPICS) {
      expect(t.canonicalPath === "/" || paths.has(t.canonicalPath), `${t.key} -> ${t.canonicalPath}`).toBe(true);
    }
  });

  it("carries the honest weakness on every comparison", () => {
    for (const t of BLOG_TOPICS.filter((x) => x.tier === "comparison")) {
      expect(t.honestWeakness, t.key).toBeTruthy();
      expect(t.competitor, t.key).toBeTruthy();
    }
  });

  it("has unique keys", () => {
    const keys = BLOG_TOPICS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every topic facts to state", () => {
    for (const t of BLOG_TOPICS) expect(t.facts.length, t.key).toBeGreaterThan(0);
  });
});

describe("nextTopic", () => {
  it("skips used topics", () => {
    const [first, second] = BLOG_TOPICS;
    expect(nextTopic([])?.key).toBe(first.key);
    expect(nextTopic([first.key])?.key).toBe(second.key);
  });

  it("returns null when every topic is used", () => {
    expect(nextTopic(BLOG_TOPICS.map((t) => t.key))).toBeNull();
  });
});
