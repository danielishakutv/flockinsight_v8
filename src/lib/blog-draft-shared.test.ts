import { describe, expect, it } from "vitest";
import { FORBIDDEN_CLAIMS } from "@/lib/seo/keywords";
import { BLOG_TOPICS } from "@/lib/seo/blog-topics";
import { mentionsPrice } from "@/lib/blog-draft-checks";
import { PROMPTS, PROMPT_SCOPE, isPromptId } from "@/lib/ai/prompts";
import {
  BLOG_DRAFT_SYSTEM_PROMPT,
  BLOG_PROMPT_ID,
  MAX_TAGS,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  buildBlogDraftPrompt,
  isoWeekKey,
  parseBlogDraft,
} from "./blog-draft-shared";

describe("isoWeekKey", () => {
  it("handles the year boundaries in UTC", () => {
    expect(isoWeekKey(new Date("2026-12-31T12:00:00Z"))).toBe("2026-W53");
    expect(isoWeekKey(new Date("2027-01-04T00:30:00Z"))).toBe("2027-W01");
    expect(isoWeekKey(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(isoWeekKey(new Date("2026-10-21T05:00:00Z"))).toBe("2026-W43");
  });
});

describe("buildBlogDraftPrompt", () => {
  it("lists every forbidden claim with its reason", () => {
    for (const c of FORBIDDEN_CLAIMS) {
      expect(BLOG_DRAFT_SYSTEM_PROMPT).toContain(`"${c.phrase}"`);
      expect(BLOG_DRAFT_SYSTEM_PROMPT).toContain(c.why);
    }
  });

  it("never puts a price in the prompt", () => {
    for (const t of BLOG_TOPICS) {
      const p = buildBlogDraftPrompt(t);
      expect(mentionsPrice(p.system), t.key).toBe(false);
      expect(mentionsPrice(p.user), t.key).toBe(false);
    }
  });

  it("includes the honest weakness for a comparison topic", () => {
    const cmp = BLOG_TOPICS.find((t) => t.tier === "comparison");
    expect(cmp).toBeTruthy();
    const p = buildBlogDraftPrompt(cmp!);
    expect(p.user).toContain(cmp!.honestWeakness!);
    expect(p.user).toContain(cmp!.canonicalPath);
  });
});

function draft(words: number, header = "TITLE: Why visitors stop coming\nSEO_TITLE: Short\nSEO_DESCRIPTION: Desc\nTAGS: follow-up, visitors") {
  return `${header}\n---\n${Array.from({ length: words }, (_, i) => `word${i}`).join(" ")}`;
}

describe("parseBlogDraft", () => {
  it("accepts a well-formed draft", () => {
    const out = parseBlogDraft(draft(450));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.draft.title).toBe("Why visitors stop coming");
      expect(out.draft.tags).toEqual(["follow-up", "visitors"]);
      expect(out.draft.body.startsWith("word0")).toBe(true);
    }
  });

  it("strips a wrapping fence", () => {
    const out = parseBlogDraft("```markdown\n" + draft(450) + "\n```");
    expect(out.ok).toBe(true);
  });

  it("refuses a draft with no separator or under 400 words", () => {
    expect(parseBlogDraft(draft(450).replace("\n---\n", "\n")).ok).toBe(false);
    const short = parseBlogDraft(draft(120));
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toContain("120 words");
    expect(parseBlogDraft(draft(450, "SEO_TITLE: x")).ok).toBe(false);
  });

  it("clips tags and SEO fields to what savePost accepts", () => {
    const header = [
      "TITLE: A title",
      `SEO_TITLE: ${"long ".repeat(30)}`,
      `SEO_DESCRIPTION: ${"longer ".repeat(60)}`,
      `TAGS: ${Array.from({ length: 9 }, (_, i) => `tag${i}${"x".repeat(50)}`).join(", ")}`,
    ].join("\n");
    const out = parseBlogDraft(draft(450, header));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.draft.seoTitle!.length).toBeLessThanOrEqual(SEO_TITLE_MAX);
      expect(out.draft.seoDescription!.length).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX);
      expect(out.draft.tags).toHaveLength(MAX_TAGS);
      for (const t of out.draft.tags) expect(t.length).toBeLessThanOrEqual(40);
    }
  });
});

describe("the prompt registry", () => {
  it("registers the blog prompt as a platform prompt with exactly this text", () => {
    expect(isPromptId(BLOG_PROMPT_ID)).toBe(true);
    expect(PROMPTS[BLOG_PROMPT_ID]).toBe(BLOG_DRAFT_SYSTEM_PROMPT);
    expect(PROMPT_SCOPE[BLOG_PROMPT_ID]).toBe("platform");
  });
});
