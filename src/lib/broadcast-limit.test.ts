import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The composer's limit and the server's limit are two numbers in two files
 * with nothing holding them together.
 *
 * The composer counts the visible text as you type and warns before you go
 * over; the action re-counts it and refuses the save. They agree today, and
 * the comment above each says it must. Nothing checked, which is how the
 * version constant next door ended up three releases stale under the same
 * kind of comment.
 *
 * The failure is one-sided and quiet. If the composer's limit drifts ABOVE the
 * action's, it lets you keep writing past the point where the save will be
 * refused, turning a warning you could act on into a rejection at the end of a
 * long announcement. Below, and it warns early — annoying, not destructive.
 *
 * Read from source rather than imported: the action is a server module and the
 * composer is a client component, so neither can be pulled into a unit test
 * for the sake of one number. Same approach as `meeting-timing.test.ts`.
 */

const SRC = join(import.meta.dirname, "..");

function numberFrom(relativePath: string, pattern: RegExp): number {
  const src = readFileSync(join(SRC, relativePath), "utf8");
  const match = src.match(pattern);
  expect(match, `${relativePath} no longer declares ${pattern}`).toBeTruthy();
  return Number((match as RegExpMatchArray)[1].replace(/_/g, ""));
}

describe("the broadcast body limit", () => {
  const composer = numberFrom(
    "components/superadmin/notification-composer.tsx",
    /const BODY_LIMIT = ([\d_]+)/,
  );
  const action = numberFrom(
    "app/superadmin/notifications/actions.ts",
    /richTextToPlain\(v\)\.trim\(\)\.length <= ([\d_]+)/,
  );

  it("never lets the composer accept more than the action will save", () => {
    expect(composer).toBeLessThanOrEqual(action);
  });

  it("is the same number on both sides, so the warning lands where it should", () => {
    expect(composer).toBe(action);
  });
});
