import { describe, expect, it } from "vitest";
import { LOG_STALLED_AFTER_MINUTES, logState, logStateNotice } from "@/lib/comm-log-state";

const now = new Date("2026-10-12T10:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("logState", () => {
  it("treats every row written before the column existed as finished", () => {
    expect(logState("done", minutesAgo(600), now)).toBe("done");
    expect(logState(null, minutesAgo(600), now)).toBe("done");
  });

  it("shows a send with recent progress as still sending", () => {
    expect(logState("sending", minutesAgo(2), now)).toBe("sending");
  });

  it("calls a send with no progress for too long interrupted, not sending for ever", () => {
    expect(logState("sending", minutesAgo(LOG_STALLED_AFTER_MINUTES + 1), now)).toBe(
      "interrupted",
    );
    expect(logState("sending", minutesAgo(LOG_STALLED_AFTER_MINUTES + 1).toISOString(), now)).toBe(
      "interrupted",
    );
  });

  it("keeps a row the sender itself marked interrupted", () => {
    expect(logState("interrupted", minutesAgo(1), now)).toBe("interrupted");
  });
});

describe("logStateNotice", () => {
  it("says how far an interrupted send got", () => {
    const n = logStateNotice("interrupted", { sent: 120, failed: 3, recipients: 400 });
    expect(n).toContain("123 of 400");
    expect(n).toContain("120 marked sent");
  });

  it("says nothing about a finished send", () => {
    expect(logStateNotice("done", { sent: 1, failed: 0, recipients: 1 })).toBeNull();
  });
});
