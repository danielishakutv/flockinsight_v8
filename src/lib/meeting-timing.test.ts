import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two numbers in two different files have to stay in a particular order, and
 * nothing in the type system says so.
 *
 * A listening peer holds a long-poll open for HOLD_MS and touches its
 * heartbeat when the request starts and again when the hold ends. So the widest
 * gap between beats is one hold. PRESENCE_TIMEOUT_MS is how long another peer
 * waits before deciding that row has stopped beating.
 *
 * Bring them close together and peers flicker out of each other's rosters and
 * straight back in — and every flicker tears down a working peer connection
 * and rebuilds it, which looks to everyone in the meeting like the video
 * dropping on a link that is perfectly fine. The first version of this shipped
 * with a 15s hold against a 17s timeout, which is exactly that bug.
 *
 * A third copy of the timeout lives in the meetings list page, which computes
 * the live headcount, and has to agree or the page contradicts the room.
 *
 * Read from source rather than imported: both modules are server-only and one
 * is a route handler, so neither can be pulled into a unit test.
 */

const SRC = join(import.meta.dirname, "..");

function numberFrom(relativePath: string, pattern: RegExp): number {
  const src = readFileSync(join(SRC, relativePath), "utf8");
  const match = src.match(pattern);
  expect(match, `${relativePath} no longer declares ${pattern}`).toBeTruthy();
  return Number((match as RegExpMatchArray)[1].replace(/_/g, ""));
}

describe("meeting presence timing", () => {
  const hold = numberFrom(
    "app/api/meet/[code]/sync/route.ts",
    /const HOLD_MS = ([\d_]+)/,
  );
  const timeout = numberFrom(
    "lib/meetings.ts",
    /export const PRESENCE_TIMEOUT_MS = ([\d_]+)/,
  );
  const listPage = numberFrom(
    "app/(app)/meetings/page.tsx",
    /const LIVE_WINDOW_MS = ([\d_]+)/,
  );

  it("gives a listening peer at least two missed beats of slack", () => {
    // Anything under 2x and a single slow request drops somebody from the room.
    expect(timeout / hold).toBeGreaterThanOrEqual(2);
  });

  it("keeps the meetings list in step with the room", () => {
    expect(listPage).toBe(timeout);
  });

  it("still notices a crashed tab within a minute", () => {
    // The other half of the trade: a tab that vanished must not sit in the
    // roster indefinitely, because nobody can see it is gone.
    expect(timeout).toBeLessThanOrEqual(60_000);
  });

  it("holds the poll long enough that an idle room is cheap", () => {
    // Under ~8s and an idle meeting is making a request every few seconds per
    // person, which is the polling cost this design exists to avoid.
    expect(hold).toBeGreaterThanOrEqual(8_000);
    // Over ~45s and proxies and mobile networks start closing it themselves.
    expect(hold).toBeLessThanOrEqual(45_000);
  });
});
