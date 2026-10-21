/**
 * The checks an AI-drafted blog post must pass before it can be published.
 *
 * Client-safe (it imports only the keyword map's FORBIDDEN_CLAIMS), so the
 * editor recomputes the flags live as the body changes, and the server runs
 * the very same functions when Publish is pressed.
 */
import { FORBIDDEN_CLAIMS } from "@/lib/seo/keywords";

export type DraftFlag = { code: "forbidden" | "price" | "canonical" | "title"; message: string };
export type DraftFlags = { blocking: DraftFlag[]; warnings: DraftFlag[] };

export function forbiddenClaimsIn(text: string): { phrase: string; why: string }[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_CLAIMS.filter((c) => lower.includes(c.phrase.toLowerCase()));
}

/*
 * A currency sign or code followed by a digit, or a "/mo". Prices live in an
 * admin override (/superadmin/pricing) and change; a post that quotes one is
 * wrong the day the price moves, so a draft links /pricing instead.
 */
const PRICE = /(?:₦|\bNGN|\$|\bUSD|\bKES|\bGHS|£|€)\s?\d|\/mo\b/i;

export function mentionsPrice(text: string): boolean {
  return PRICE.test(text);
}

/**
 * What is wrong with a draft. A forbidden claim blocks publishing; a price, a
 * missing link to the page that owns the term, or a title that is just the
 * keyword are warnings a reviewer should look at.
 */
export function draftFlags(
  post: { title: string; body: string },
  topic: { primary: string; canonicalPath: string } | null,
): DraftFlags {
  const blocking: DraftFlag[] = forbiddenClaimsIn(`${post.title}\n${post.body}`).map((c) => ({
    code: "forbidden",
    message: `Contains "${c.phrase}" — ${c.why}`,
  }));
  const warnings: DraftFlag[] = [];
  if (mentionsPrice(`${post.title}\n${post.body}`)) {
    warnings.push({
      code: "price",
      message: "Mentions a price. Prices change in /superadmin/pricing; link /pricing instead.",
    });
  }
  if (topic) {
    if (!post.body.includes(`](${topic.canonicalPath}`)) {
      warnings.push({
        code: "canonical",
        message: `Does not link ${topic.canonicalPath}, the page that owns "${topic.primary}".`,
      });
    }
    if (post.title.trim().toLowerCase() === topic.primary.trim().toLowerCase()) {
      warnings.push({
        code: "title",
        message: "The title is the keyword itself, which competes with the page that owns it. Answer the question instead.",
      });
    }
  }
  return { blocking, warnings };
}

/**
 * Why this post may not be published, or null. An AI draft must have been
 * read: either it was reviewed before, or the reviewer ticks the box now. A
 * forbidden claim blocks an AI post outright; human posts keep the editor's
 * existing freedom.
 */
export function publishRefusal(input: {
  source: string;
  reviewedAt: Date | string | null;
  confirmReviewed?: boolean;
  flags: DraftFlags;
}): string | null {
  if (input.source !== "ai") return null;
  if (!input.reviewedAt && !input.confirmReviewed) {
    return "Read the draft and tick 'I've checked every claim' before publishing — AI drafts are never published unread.";
  }
  const claim = input.flags.blocking.find((f) => f.code === "forbidden");
  if (claim) {
    const hit = FORBIDDEN_CLAIMS.find((c) => claim.message.includes(`"${c.phrase}"`));
    return hit
      ? `Remove "${hit.phrase}" before publishing — ${hit.why}`
      : `${claim.message} Remove it before publishing.`;
  }
  return null;
}
