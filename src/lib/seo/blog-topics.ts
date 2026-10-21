/**
 * What the weekly blog drafter writes about: the keyword map, one topic per
 * term, minus the category terms.
 *
 * WHY: every term already has a page that owns its primary phrase. A post
 * answers the term's QUESTION, links to that page once, and never takes the
 * primary phrase as its title, so the blog supports the page instead of
 * competing with it for the same search. The category terms are left out
 * ("don't chase the head term"): they are won by accumulating everything
 * else, not by a 1,200-word post.
 *
 * Pure, so the tests can check every topic has a real page to link to.
 */
import {
  ALL_TERMS,
  ENTITY_SENTENCE,
  type ComparisonTerm,
  type GeoTerm,
  type SeoTerm,
  type TermTier,
} from "@/lib/seo/keywords";
import {
  SOLUTION_TERMS,
  compareContent,
  comparePath,
  countryPath,
  geoContent,
  solutionContent,
  solutionPath,
  type PageContent,
} from "@/lib/seo/pages";

export type BlogTopic = {
  /** The term's primary phrase. Stored as blog_post.topic_key and blog_draft_run.topic_key. */
  key: string;
  tier: TermTier;
  question: string;
  primary: string;
  variants: string[];
  backedBy: string[];
  /** The page that owns the primary phrase; the post links to it once. */
  canonicalPath: string;
  /** Sentences the post may state. Nothing else is claimed. */
  facts: string[];
  competitor?: string;
  ourEdge?: string;
  honestWeakness?: string;
};

/** The order topics are interleaved in: the rarest, most winnable terms first. */
const TIER_ORDER: TermTier[] = ["differentiator", "useCase", "geographic", "position", "comparison"];

function factsFrom(content: PageContent | undefined): string[] {
  if (!content) return [];
  return [
    content.summary,
    ...content.points.map((p) => `${p.title}: ${p.body}`),
    ...content.faq.map((f) => `${f.q} ${f.a}`),
  ];
}

function toTopic(term: SeoTerm): BlogTopic {
  let canonicalPath = "/";
  let content: PageContent | undefined;
  const extra: Partial<BlogTopic> = {};
  if (term.tier === "geographic") {
    const geo = term as GeoTerm;
    canonicalPath = countryPath(geo);
    content = geoContent(geo);
    extra.facts = [geo.localTruth];
  } else if (term.tier === "comparison") {
    const cmp = term as ComparisonTerm;
    canonicalPath = comparePath(cmp);
    content = compareContent(cmp);
    extra.competitor = cmp.competitor;
    extra.ourEdge = cmp.ourEdge;
    extra.honestWeakness = cmp.honestWeakness;
  } else if (SOLUTION_TERMS.includes(term)) {
    canonicalPath = solutionPath(term);
    content = solutionContent(term);
  }
  return {
    key: term.primary,
    tier: term.tier,
    question: term.question,
    primary: term.primary,
    variants: term.variants,
    backedBy: term.backedBy,
    canonicalPath,
    facts: [...(extra.facts ?? []), ...factsFrom(content), ENTITY_SENTENCE],
    competitor: extra.competitor,
    ourEdge: extra.ourEdge,
    honestWeakness: extra.honestWeakness,
  };
}

function interleave(): BlogTopic[] {
  const byTier = TIER_ORDER.map((tier) =>
    ALL_TERMS.filter((t) => t.tier === tier && t.backedBy.length > 0).map(toTopic),
  );
  const out: BlogTopic[] = [];
  const longest = Math.max(...byTier.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of byTier) if (list[i]) out.push(list[i]);
  }
  return out;
}

export const BLOG_TOPICS: readonly BlogTopic[] = Object.freeze(interleave());

export function findTopic(key: string | null | undefined): BlogTopic | null {
  if (!key) return null;
  return BLOG_TOPICS.find((t) => t.key === key) ?? null;
}

/** The first topic not yet drafted, or null when the map is exhausted. */
export function nextTopic(used: Iterable<string>): BlogTopic | null {
  const seen = new Set(used);
  return BLOG_TOPICS.find((t) => !seen.has(t.key)) ?? null;
}
