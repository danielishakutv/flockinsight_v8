import { siteUrl } from "@/lib/site";

/**
 * Church-to-church referrals.
 *
 * A church's referral code is its own public handle — the thing already
 * printed on its page and its PDFs. No second code to generate, look up or
 * lose, and a pastor reading `flockinsight.com/?ref=grace-chapel` can see at a
 * glance whose link it is.
 *
 * The link is attached to every PDF the church produces, so a document handed
 * round a board meeting or forwarded to another pastor carries the referral
 * with it. That is the whole point: churches recommend each other, and the one
 * that did the recommending should get the credit.
 *
 * Pure — no DB, no `server-only` — so it can be used on the client too.
 */

/** How long a captured referral stays valid, in seconds (30 days). */
export const REFERRAL_TTL_SECONDS = 60 * 60 * 24 * 30;

export const REFERRAL_COOKIE = "fi_ref";

/** The code that identifies a referring church. Falls back to the slug. */
export function referralCode(church: {
  handle?: string | null;
  slug: string;
}): string {
  return church.handle?.trim() || church.slug;
}

/**
 * The link a church shares: `flockinsight.com/r/grace-chapel`.
 *
 * Short enough to read out or print, and it goes through a route that records
 * the referral in a cookie before landing the visitor on the marketing page —
 * so they learn what this is before signing up, and the credit survives them
 * reading the pricing page first. A plain `?ref=` on the landing page could
 * not do that: the page is statically cached, and only a route handler can set
 * a cookie.
 */
export function referralUrl(church: {
  handle?: string | null;
  slug: string;
}): string {
  return `${siteUrl()}/r/${encodeURIComponent(referralCode(church))}`;
}

/**
 * Codes are compared case-insensitively and trimmed, because they get typed
 * out by hand from a printed page more often than you would think.
 */
export function normaliseCode(raw: string | null | undefined): string | null {
  const s = raw?.trim().toLowerCase();
  if (!s) return null;
  // A handle is a slug; anything else is not a code we issued.
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(s)) return null;
  return s;
}
