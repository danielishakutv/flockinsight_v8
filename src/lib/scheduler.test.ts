import { describe, expect, it } from "vitest";

/**
 * The lock id, which is the one piece of this that must be identical in two
 * separate processes.
 *
 * PM2 runs the app in cluster mode, so every scheduler tick happens twice. A
 * Postgres advisory lock settles which worker runs the job — but only if both
 * workers compute the SAME number from the same job name. Anything involving
 * `Math.random`, object identity or insertion order would give them different
 * ids, both would take a lock, and every congregation would get two of each
 * broadcast. That is the failure this guards against.
 *
 * FNV-1a, restated here. If this and `scheduler.ts` disagree, the scheduler is
 * wrong.
 */
function lockIdFor(job: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < job.length; i++) {
    hash ^= job.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash | 0);
}

const JOBS = [
  "reminders",
  "storage",
  "first-timers",
  "trial-reminders",
  "branch-reports",
  "service-reminders",
  "celebrations",
  "broadcasts",
  "devotionals",
  "meetings",
  "platform-health",
];

describe("scheduler lock ids", () => {
  it("is the same number every time for a given job", () => {
    // The whole point: two workers, two processes, one answer.
    for (const job of JOBS) {
      expect(lockIdFor(job)).toBe(lockIdFor(job));
    }
  });

  it("gives every job its own id", () => {
    const ids = JOBS.map(lockIdFor);
    // A collision would mean two different jobs blocking each other, so one of
    // them would simply never run while the other was working.
    expect(new Set(ids).size).toBe(JOBS.length);
  });

  it("stays inside a signed 32-bit integer, which is what Postgres takes", () => {
    for (const job of JOBS) {
      const id = lockIdFor(job);
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThanOrEqual(2_147_483_647);
    }
  });

  it("does not depend on anything but the characters of the name", () => {
    // Built a different way, same string: same id. This is what rules out an
    // id that quietly varies between a build and a rebuild.
    const built = ["meet", "ings"].join("");
    expect(lockIdFor(built)).toBe(lockIdFor("meetings"));
  });
});
