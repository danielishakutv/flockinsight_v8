/**
 * When the watch page's player tries again, and what its overlay says.
 *
 * The page tells a viewer "Leave this page open — it starts on its own", and
 * the player used to make one attempt at load and never another. Somebody who
 * opened the link ten minutes early, or whose 3G blinked at the wrong moment,
 * was told the broadcast "may have ended" for the rest of the service, and a
 * drop mid-sermon left a frozen frame with no message at all. So the player
 * keeps trying, and these are the rules it keeps to. Pure, so they are pinned
 * in live-reconnect.test.ts.
 */

/** Consecutive failed attempts before the overlay says it cannot reach the stream. */
export const UNREACHABLE_AFTER = 3;

/**
 * How long a connection may sit at "disconnected" before it is rebuilt.
 * Shorter than this and a tunnel or a lift would tear down a call that was
 * about to recover by itself.
 */
export const DISCONNECTED_GRACE_MS = 5_000;

/** The wait before attempt `failures + 1`: 3s, 6s, 12s, 24s, then every 30s. */
export function reconnectDelayMs(failures: number): number {
  const n = Math.max(1, Math.floor(failures));
  return Math.min(30_000, 3_000 * 2 ** (n - 1));
}

export type LiveOverlay =
  | "none"
  | "not-started"
  | "connecting"
  | "reconnecting"
  | "unreachable"
  | "refused";

/**
 * One overlay, saying the true thing — never one state that means five.
 *
 * Before any picture, a stream that was not live when the page loaded stays
 * "not started" however many attempts are refused: that is what the page
 * promised the viewer, and the attempts carry on until it goes live.
 */
export function liveOverlay(s: {
  playing: boolean;
  /** The stream's status when the page loaded. */
  live: boolean;
  /** A picture played on this page and was then lost. */
  dropped: boolean;
  /** Consecutive failed attempts since the last picture. */
  failures: number;
  /** The browser would not start playback of a stream that did arrive. */
  refused: boolean;
}): LiveOverlay {
  if (s.playing) return "none";
  if (s.refused) return "refused";
  if (!s.dropped && !s.live) return "not-started";
  if (s.failures >= UNREACHABLE_AFTER) return "unreachable";
  return s.dropped ? "reconnecting" : "connecting";
}
