/**
 * Finds the parts of the help guides that answer a question.
 *
 * Server use only, by convention: GUIDES is about 233 KB and has no business
 * in a phone's bundle, so client components receive slugs, titles and hrefs
 * as props instead of importing this. It is pure (no database, no network),
 * which is what lets vitest test retrieval directly.
 *
 * BM25-lite over the guides, sliced one chunk per section and one per FAQ.
 * Good enough for 32 guides, deterministic, and free: an embedding model would
 * be a second AI dependency to answer a question this one already can.
 */
import { GUIDES, sectionBlocks, type GuideBlock } from "@/lib/help-guides";
import { normalizeSearchText } from "@/lib/option-search";

export type GuideChunk = {
  ref: string;
  slug: string;
  header: string;
  body: string;
  /** Tokens of the guide and section titles; a hit here counts double. */
  titleTokens: string[];
  /** The guide's own keywords; a hit here counts double too. */
  keywordTokens: string[];
  bodyTokens: string[];
};

export type ApprovedAnswer = {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
};

export type Retrieved = {
  /** The text that goes in the prompt. */
  extracts: string;
  /** Guide slugs in the extracts, in order. */
  guideSlugs: string[];
  /** Short codes used in the extracts ("A1") mapped to approved answer ids. */
  answerCodes: Map<string, string>;
};

export const DEFAULT_EXTRACT_BUDGET = 12_000;
const FALLBACK_SLUG = "getting-started";

const STOPWORDS = new Set(
  "a an the and or but if then of to in on at by for with from into onto is are was were be been being am do does did doing have has had i me my we our you your it its this that these those there here how what when where which who whom why can could would should will shall may might must not no so too very just about as up out over under again also any all each some such only own same than via per one two get got want need please".split(
    " ",
  ),
);

/** Light plural and tense folding, so "messages" meets "message" and "sending" meets "send". */
function fold(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && /(?:s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  return normalizeSearchText(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(fold);
}

function blockText(b: GuideBlock): string {
  switch (b.kind) {
    case "text":
      return b.text;
    case "note":
      return `Note: ${b.text}`;
    case "warning":
      return `Warning: ${b.text}`;
    case "bullets":
      return b.items.map((i) => `- ${i}`).join("\n");
    case "steps":
      return b.items
        .map((s, i) => `${i + 1}. ${s.title}${s.detail ? ` — ${s.detail}` : ""}`)
        .join("\n");
    case "example":
      return `Example: ${b.title}\n${b.lines.join("\n")}`;
    case "table":
      return [b.headers.join(" | "), ...b.rows.map((r) => r.join(" | "))].join("\n");
  }
}

let chunkCache: GuideChunk[] | null = null;

/** Every guide as retrievable chunks. Memoised: GUIDES is fixed per build. */
export function guideChunks(): GuideChunk[] {
  if (chunkCache) return chunkCache;
  const out: GuideChunk[] = [];
  for (const g of GUIDES) {
    const keywordTokens = tokenize((g.keywords ?? []).join(" "));
    const push = (heading: string, body: string) => {
      out.push({
        ref: `guide:${g.slug}`,
        slug: g.slug,
        header: `[guide:${g.slug}] ${g.title} — ${heading}`,
        body,
        titleTokens: tokenize(`${g.title} ${heading}`),
        keywordTokens,
        bodyTokens: tokenize(body),
      });
    };
    if (g.sections.length === 0) push("Summary", g.summary);
    g.sections.forEach((s, i) => {
      const body = sectionBlocks(s).map(blockText).join("\n");
      // The first section carries the summary, so "what is X" finds the guide.
      push(s.title ?? g.summary, i === 0 ? `${g.summary}\n${body}` : body);
    });
    for (const f of g.faq ?? []) push(`FAQ: ${f.q}`, f.a);
  }
  chunkCache = out;
  return out;
}

/** One short line per guide, so the model knows what exists beyond the extracts. */
export function guideMap(): string {
  return GUIDES.map((g) => `guide:${g.slug} — ${g.title}`).join("\n");
}

/** Guide slug to title, for source chips. */
export function guideTitle(slug: string): string | null {
  return GUIDES.find((g) => g.slug === slug)?.title ?? null;
}

export function guideSlugs(): Set<string> {
  return new Set(GUIDES.map((g) => g.slug));
}

const K1 = 1.2;
const B = 0.75;

type Stats = { idf: Map<string, number>; avgLen: number; n: number };
let statsCache: Stats | null = null;

function corpusStats(): Stats {
  if (statsCache) return statsCache;
  const chunks = guideChunks();
  const df = new Map<string, number>();
  let total = 0;
  for (const c of chunks) {
    const terms = new Set([...c.bodyTokens, ...c.titleTokens, ...c.keywordTokens]);
    for (const t of terms) df.set(t, (df.get(t) ?? 0) + 1);
    total += c.bodyTokens.length + c.titleTokens.length;
  }
  const n = chunks.length;
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(1 + (n - d + 0.5) / (d + 0.5)));
  statsCache = { idf, avgLen: total / Math.max(1, n), n };
  return statsCache;
}

function idfOf(stats: Stats, term: string): number {
  // A term in no guide is rare by definition; it matters for canned answers.
  return stats.idf.get(term) ?? Math.log(1 + (stats.n + 0.5) / 0.5);
}

function bm25(stats: Stats, query: string[], tf: Map<string, number>, len: number): number {
  let score = 0;
  for (const q of query) {
    const f = tf.get(q) ?? 0;
    if (f === 0) continue;
    score +=
      idfOf(stats, q) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * len) / stats.avgLen)));
  }
  return score;
}

function countInto(tf: Map<string, number>, tokens: string[], weight: number) {
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + weight);
}

/** Scores every chunk for a question. Exported for the tests. */
export function scoreChunks(question: string): { chunk: GuideChunk; score: number; index: number }[] {
  const stats = corpusStats();
  const query = [...new Set(tokenize(question))];
  return guideChunks().map((chunk, index) => {
    const tf = new Map<string, number>();
    countInto(tf, chunk.bodyTokens, 1);
    countInto(tf, chunk.titleTokens, 2);
    countInto(tf, chunk.keywordTokens, 2);
    const len = chunk.bodyTokens.length + chunk.titleTokens.length;
    return { chunk, score: query.length ? bm25(stats, query, tf, len) : 0, index };
  });
}

/**
 * The extracts for one question.
 *
 * Approved answers first (the top two that match at all), because a human
 * wrote them for exactly this kind of question. Then guide chunks, best first,
 * while they fit the budget. Ties break on guide order, so the same question
 * always builds the same prompt. With no hit at all, the getting-started guide
 * is the honest fallback.
 */
export function retrieve(
  question: string,
  approved: ApprovedAnswer[],
  budgetChars: number = DEFAULT_EXTRACT_BUDGET,
): Retrieved {
  const stats = corpusStats();
  const query = [...new Set(tokenize(question))];
  const parts: string[] = [];
  const answerCodes = new Map<string, string>();
  const slugs: string[] = [];
  let used = 0;

  const fits = (text: string) => used + text.length + 2 <= budgetChars;
  const add = (text: string) => {
    parts.push(text);
    used += text.length + 2;
  };

  if (query.length) {
    const ranked = approved
      .map((a, index) => {
        const tf = new Map<string, number>();
        countInto(tf, tokenize(a.question), 1);
        countInto(tf, tokenize(a.keywords.join(" ")), 1.5);
        const len = tokenize(a.question).length + a.keywords.length;
        return { a, index, score: bm25(stats, query, tf, len) };
      })
      .filter((r) => r.score > 0)
      .sort((x, y) => y.score - x.score || x.a.id.localeCompare(y.a.id))
      .slice(0, 2);
    ranked.forEach((r, i) => {
      const code = `A${i + 1}`;
      const text = `[answer:${code}] Q: ${r.a.question}\nA: ${r.a.answer}`;
      if (!fits(text)) return;
      answerCodes.set(code, r.a.id);
      add(text);
    });
  }

  const scored = scoreChunks(question)
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score || x.index - y.index);
  const chosen = scored.length
    ? scored
    : scoreChunks("").filter((s) => s.chunk.slug === FALLBACK_SLUG);

  for (const { chunk } of chosen) {
    const text = `${chunk.header}\n${chunk.body}`;
    if (!fits(text)) continue;
    add(text);
    if (!slugs.includes(chunk.slug)) slugs.push(chunk.slug);
  }

  return { extracts: parts.join("\n\n"), guideSlugs: slugs, answerCodes };
}
