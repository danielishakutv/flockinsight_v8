/**
 * The cookie that remembers which Partner brought a visitor.
 *
 * Its own file, with no database import, so the capture route, the signup
 * action and any client component can all read the same two constants without
 * dragging the server-only partner module in behind them.
 */

/** How long a captured attribution stays valid, in seconds (30 days). */
export const PARTNER_TTL_SECONDS = 60 * 60 * 24 * 30;

export const PARTNER_COOKIE = "fi_partner";

/**
 * The link a Partner shares: `flockinsight.com/a/bc3k9m`.
 *
 * Short enough to read down a phone line or write on the back of a card, and
 * it goes through a route that records the attribution in a cookie before
 * landing the visitor on the marketing page — so they learn what FlockInsight
 * is before signing up, and the credit survives them reading the pricing page
 * first.
 */
export function partnerShareLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/a/${code}`;
}
