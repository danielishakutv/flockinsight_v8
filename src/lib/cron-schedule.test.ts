import { describe, expect, it } from "vitest";
import {
  CRON_JOBS,
  cronIntervalMinutes,
  isCronDue,
  isCronOverdue,
  type CronJob,
} from "@/lib/cron-schedule";

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
      "trial-reminders",
      "branch-reports",
    ] as const) {
      expect(CRON_JOBS[job].intervalMinutes).toBe(1440);
    }
  });

  it("declares the hourly jobs as hourly", () => {
    for (const job of [
      "service-reminders",
      "celebrations",
      // Hourly because it honours each church's own local send time; a daily
      // sweep could only ever satisfy the churches whose hour it happened to
      // land after. See the note on the job.
      "first-timers",
    ] as const) {
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

/*
 * The schedule used to live only in a crontab on the server, and `sms-queue`
 * had never been added to it — so every SMS held for the 8am-8pm delivery
 * window sat unsent for months with nothing able to notice. These tests exist
 * so a job cannot be declared without a real schedule, and so an expression
 * and the interval written beside it cannot drift apart.
 */
describe("every job carries the cron expression that actually runs it", () => {
  const jobs = Object.keys(CRON_JOBS) as CronJob[];

  it("has at least one job, and a cron expression for every one of them", () => {
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(CRON_JOBS[job].cron, job).toMatch(/^\S+( \S+){4}$/);
    }
  });

  it("every expression fires exactly as often as the job declares", () => {
    for (const job of jobs) {
      expect(cronIntervalMinutes(CRON_JOBS[job].cron), job).toBe(
        CRON_JOBS[job].intervalMinutes,
      );
    }
  });

  // The specific job that was missing. Named, so deleting its line fails here.
  it("flushes the SMS queue every five minutes", () => {
    expect(CRON_JOBS["sms-queue"].cron).toBe("*/5 * * * *");
    expect(CRON_JOBS["sms-queue"].intervalMinutes).toBe(5);
  });

  it("gives each daily job its own minute so they do not pile up", () => {
    const dailyMinutes = jobs
      .filter((j) => CRON_JOBS[j].intervalMinutes === 1440)
      .map((j) => CRON_JOBS[j].cron.split(" ").slice(0, 2).join(" "));
    expect(new Set(dailyMinutes).size).toBe(dailyMinutes.length);
  });
});

describe("cronIntervalMinutes", () => {
  it("reads the shapes the schedule uses", () => {
    expect(cronIntervalMinutes("*/5 * * * *")).toBe(5);
    expect(cronIntervalMinutes("*/30 * * * *")).toBe(30);
    expect(cronIntervalMinutes("10 * * * *")).toBe(60);
    expect(cronIntervalMinutes("0 */2 * * *")).toBe(120);
    expect(cronIntervalMinutes("0 2 * * *")).toBe(1440);
  });

  it("refuses to guess at anything else", () => {
    expect(() => cronIntervalMinutes("0 2 * * 1")).toThrow();
    expect(() => cronIntervalMinutes("0,30 * * * *")).toThrow();
    expect(() => cronIntervalMinutes("0 2 * *")).toThrow();
  });
});

/*
 * The in-app scheduler used `isCronOverdue` to decide what to run, so every
 * job ran at up to half its declared rate — the 5-minute SMS queue flush went
 * every 10 minutes, and nothing reported it because the health page applies
 * the same lenient rule.
 */
describe("isCronDue is the interval, with no grace in it", () => {
  it("never having run is due", () => {
    expect(isCronDue(null, 5, NOW)).toBe(true);
  });

  it("is due the moment the interval has elapsed", () => {
    expect(isCronDue(minutesAgo(4), 5, NOW)).toBe(false);
    expect(isCronDue(minutesAgo(5), 5, NOW)).toBe(true);
  });

  it("fires a 5-minute job at 5 minutes, where overdue waits for 10", () => {
    const at6 = minutesAgo(6);
    expect(isCronDue(at6, 5, NOW)).toBe(true);
    expect(isCronOverdue(at6, 5, NOW)).toBe(false);
  });

  it("fires a 15-minute job at 15 minutes, not 30", () => {
    const at16 = minutesAgo(16);
    expect(isCronDue(at16, 15, NOW)).toBe(true);
    expect(isCronOverdue(at16, 15, NOW)).toBe(false);
  });

  it("anything overdue is also due", () => {
    for (const interval of [5, 10, 15, 30, 60, 120, 1440]) {
      for (const mins of [0, 1, 7, 20, 90, 1500, 5000]) {
        const last = minutesAgo(mins);
        if (isCronOverdue(last, interval, NOW)) {
          expect(isCronDue(last, interval, NOW), `${interval}/${mins}`).toBe(true);
        }
      }
    }
  });
});
