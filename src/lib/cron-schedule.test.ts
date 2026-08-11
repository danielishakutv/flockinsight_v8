import { describe, expect, it } from "vitest";
import { CRON_JOBS, isCronOverdue } from "@/lib/cron-schedule";

const NOW = new Date("2026-08-11T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("isCronOverdue", () => {
  it("never having run is overdue", () => {
    expect(isCronOverdue(null, 60, NOW)).toBe(true);
  });

  // The exact false alarm reported on the health page: daily jobs that ran
  // 12-13 hours ago were flagged because they were declared hourly.
  it("a daily job that ran 12 hours ago is fine", () => {
    expect(isCronOverdue(hoursAgo(12), 1440, NOW)).toBe(false);
  });

  it("a daily job that ran 13 hours ago is fine", () => {
    expect(isCronOverdue(hoursAgo(13), 1440, NOW)).toBe(false);
  });

  it("a daily job is overdue once it has missed its window plus grace", () => {
    expect(isCronOverdue(hoursAgo(24.5), 1440, NOW)).toBe(false);
    expect(isCronOverdue(hoursAgo(26), 1440, NOW)).toBe(true);
  });

  it("an hourly job tolerates a late run but not a missed one", () => {
    expect(isCronOverdue(minutesAgo(90), 60, NOW)).toBe(false);
    expect(isCronOverdue(minutesAgo(180), 60, NOW)).toBe(true);
  });

  it("a 15-minute job is caught within the hour, not after two hours", () => {
    expect(isCronOverdue(minutesAgo(20), 15, NOW)).toBe(false);
    expect(isCronOverdue(minutesAgo(45), 15, NOW)).toBe(true);
  });

  it("a job that just ran is never overdue", () => {
    expect(isCronOverdue(minutesAgo(0), 1440, NOW)).toBe(false);
  });
});

describe("CRON_JOBS intervals match what each route actually does", () => {
  it("declares the daily jobs as daily", () => {
    for (const job of [
      "reminders",
      "storage",
      "first-timers",
      "trial-reminders",
    ] as const) {
      expect(CRON_JOBS[job].intervalMinutes).toBe(1440);
    }
  });

  it("declares the hourly jobs as hourly", () => {
    for (const job of ["service-reminders", "celebrations"] as const) {
      expect(CRON_JOBS[job].intervalMinutes).toBe(60);
    }
  });

  it("declares the minute-level jobs tightly enough to notice a delay", () => {
    for (const job of ["broadcasts", "devotionals"] as const) {
      expect(CRON_JOBS[job].intervalMinutes).toBeLessThanOrEqual(15);
    }
  });

  it("checks the float every half hour", () => {
    expect(CRON_JOBS["platform-health"].intervalMinutes).toBe(30);
  });
});
