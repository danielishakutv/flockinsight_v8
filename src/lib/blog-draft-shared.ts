/**
 * The weekly blog drafter's pure half: the ISO week, the prompt, and reading
 * the model's draft back. No database and no church data, ever: the prompt is
 * built from the keyword map and the SEO pages alone.
 */
import { FORBIDDEN_CLAIMS } from "@/lib/seo/keywords";
import type { BlogTopic } from "@/lib/seo/blog-topics";
import { mentionsPrice } from "@/lib/blog-draft-checks";

/** Registered in lib/ai/prompts.ts under this id, mapped to BLOG_DRAFT_SYSTEM_PROMPT. */
export const BLOG_PROMPT_ID = "blog-draft@1" as const;
/** Must equal FEATURE_POLICY.blog.model in lib/ai/config.ts, or runAi refuses. */
export const BLOG_MODEL = "claude-sonnet-5-5" as const;
/*
 * The policy maximum. A 1,400-word post is about 2,000 tokens, but thinking
 * tokens count against max_tokens, and a truncated draft is thrown away
 * rather than saved, so the headroom is cheaper than a failed week.
 */
export const BLOG_MAX_TOKENS = 8000;
export const BLOG_MIN_WORDS = 400;
export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 155;
export const MAX_TAGS = 5;
export const TAG_MAX = 40;

/** "2026-W43", the ISO-8601 week of a date, computed in UTC. */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday decides the year: shift to the Thursday of this ISO week.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * The fixed system prompt. It names every forbidden claim with its reason,
 * because a model told only "don't overclaim" will still write "trusted by
 * thousands"; a model told why usually will not.
 */
export const BLOG_DRAFT_SYSTEM_PROMPT = [
  "You draft blog posts for FlockInsight's website, read by pastors and church administrators.",
  "A human editor reads every draft and checks every claim before anything is published.",
  "Rules:",
  "1. Open with the direct answer to the question in the first two sentences. No throat-clearing.",
  "2. 900 to 1,400 words, in short paragraphs under H2 (##) sections. Plain words a pastor would use.",
  "3. State only the facts you are given about FlockInsight. Never invent features, statistics, customers, churches, testimonials or quotes.",
  "4. Never state a price, a discount or a currency amount. Where cost matters, link [our pricing](/pricing) instead, because prices change.",
  "5. Link the canonical page you are given exactly once, as a relative Markdown link.",
  "6. The title must answer the question; it must NOT be the target phrase itself.",
  "7. For a comparison, include the honest weakness you are given, word for word, and spell the competitor exactly as given.",
  "8. Never use these phrases:",
  ...FORBIDDEN_CLAIMS.map((c) => `   - "${c.phrase}": ${c.why}`),
  "Reply in exactly this format:",
  "TITLE: <the post title>",
  `SEO_TITLE: <at most ${SEO_TITLE_MAX} characters>`,
  `SEO_DESCRIPTION: <at most ${SEO_DESCRIPTION_MAX} characters>`,
  `TAGS: <up to ${MAX_TAGS} short tags, comma-separated>`,
  "---",
  "<the post body in Markdown, without repeating the title>",
].join("\n");

/** The prompt for one topic. Facts that quote a price are left out. */
export function buildBlogDraftPrompt(topic: BlogTopic): { system: string; user: string } {
  const facts = topic.facts.filter((f) => !mentionsPrice(f));
  const lines = [
    `QUESTION TO ANSWER: ${topic.question}`,
    `TARGET PHRASE (use naturally in the body, never as the title): ${topic.primary}`,
  ];
  if (topic.variants.length) lines.push(`RELATED PHRASES: ${topic.variants.join(", ")}`);
  lines.push(
    `CANONICAL PAGE TO LINK ONCE: ${topic.canonicalPath}`,
    `FLOCKINSIGHT MODULES THAT BACK THIS: ${topic.backedBy.join(", ")}`,
  );
  if (topic.competitor) {
    lines.push(`COMPETITOR (spell exactly): ${topic.competitor}`);
    if (topic.ourEdge) lines.push(`WHERE FLOCKINSIGHT IS STRONGER: ${topic.ourEdge}`);
    if (topic.honestWeakness) {
      lines.push(`HONEST WEAKNESS (include word for word): ${topic.honestWeakness}`);
    }
  }
  lines.push("", "FACTS YOU MAY STATE:", ...facts.map((f) => `- ${f}`));
  return { system: BLOG_DRAFT_SYSTEM_PROMPT, user: lines.join("\n") };
}

export type ParsedDraft = {
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  tags: string[];
  body: string;
};

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Reads a draft back. Strips a wrapping code fence, then requires a title,
 * the separator and at least 400 words. Tags and SEO fields are clipped to
 * the limits savePost's schema accepts, so the row can be edited and saved.
 */
export function parseBlogDraft(
  text: string,
): { ok: true; draft: ParsedDraft } | { ok: false; error: string } {
  let raw = text.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(raw);
  if (fence) raw = fence[1].trim();

  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const sep = lines.findIndex((l) => l.trim() === "---");
  if (sep === -1) {
    return { ok: false, error: "The draft had no '---' line between its header and body, so it was not saved. The next run tries again." };
  }
  const header = new Map<string, string>();
  for (const l of lines.slice(0, sep)) {
    const m = /^\s*(TITLE|SEO_TITLE|SEO_DESCRIPTION|TAGS)\s*:\s*(.*)$/i.exec(l);
    if (m) header.set(m[1].toUpperCase(), m[2].trim());
  }
  const title = (header.get("TITLE") ?? "").replace(/^["']|["']$/g, "").trim();
  if (!title) {
    return { ok: false, error: "The draft had no TITLE line, so it was not saved. The next run tries again." };
  }
  const body = lines.slice(sep + 1).join("\n").trim();
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words < BLOG_MIN_WORDS) {
    return {
      ok: false,
      error: `The draft was only ${words} words (at least ${BLOG_MIN_WORDS} are needed), so it was not saved. The next run tries again.`,
    };
  }
  const tags = [
    ...new Set(
      (header.get("TAGS") ?? "")
        .split(",")
        .map((t) => t.trim().replace(/^#/, "").slice(0, TAG_MAX).trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_TAGS);
  const seoTitle = header.get("SEO_TITLE");
  const seoDescription = header.get("SEO_DESCRIPTION");
  return {
    ok: true,
    draft: {
      title: clip(title, 200),
      seoTitle: seoTitle ? clip(seoTitle, SEO_TITLE_MAX) : null,
      seoDescription: seoDescription ? clip(seoDescription, SEO_DESCRIPTION_MAX) : null,
      tags,
      body,
    },
  };
}
