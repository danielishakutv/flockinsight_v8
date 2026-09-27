/**
 * Who may watch a livestream.
 *
 * Pure, and separate from the page, because this is the one decision on the
 * public watch route that has anything to protect — the playback urls ARE the
 * secret. Anybody holding a WHEP url can watch, so the check has to happen
 * before those urls are put into a response, not inside the player.
 */

export type WatchDecision = "allow" | "sign-in" | "not-yours";

/**
 * `visibility` is the church's own setting; the rest describes the viewer.
 *
 * The mistake this exists to prevent: treating "signed in" as "allowed". A
 * members-only stream belongs to ONE church, and every other church's staff
 * are signed in too — so a session alone would have let any church in the
 * country watch any other church's private service.
 */
export function canWatch(opts: {
  visibility: string;
  streamChurchId: string;
  /** Null when nobody is signed in. */
  viewerUserId: string | null;
  /** Churches this viewer actually belongs to. */
  viewerChurchIds: readonly string[];
}): WatchDecision {
  if (opts.visibility !== "members") return "allow";
  if (!opts.viewerUserId) return "sign-in";
  return opts.viewerChurchIds.includes(opts.streamChurchId) ? "allow" : "not-yours";
}
