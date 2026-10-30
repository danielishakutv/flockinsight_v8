import { describe, expect, it } from "vitest";
import {
  CRON_JOBS,
  cronIntervalMinutes,
  cronMatches,
  isCronDue,
  isCronOverdue,
  lastFireAtOrBefore,
  msUntilNextMinute,
  nextFireAfter,
  type CronJob,
} from "@/lib/cron-schedule";

const NOW = new Date("2026-08-11T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const at = (iso: string) => new Date(iso);

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
      "branch-reports",
      "usage-days",
      "blog-drafts",
      "assistant-retention",
    ] as const) {
      expect(CRON_JOBS[job].intervalMinutes).toBe(1440);
    }
  });

  /*
   * The four daily jobs send email to church owners, and the hours are the
   * ones the crontab had been using: morning where most churches are. A
   * "quiet hours" tidy-up once moved them to 02:00 UTC — 03:00 in Lagos —
   * where an inactivity nudge is buried by breakfast.
   */
  it("sends the daily owner emails in the morning, UTC+1", () => {
    expect(CRON_JOBS.reminders.cron).toBe("0 7 * * *");
  });

  it("checks trial endings hourly, so the 3-hour warning is possible", () => {
    // Daily, the last reminder a church got was three days before the lock.
    // The day-based steps still wait for the church's daytime themselves.
    expect(CRON_JOBS["trial-reminders"].intervalMinutes).toBe(60);
    expect(CRON_JOBS["trial-reminders"].cron).toBe("0 * * * *");
  });

  it("runs first-timer follow-up hourly, on the hour", () => {
    // Hourly because it honours each church's own local send time; a daily
    // sweep could only ever satisfy the churches whose hour it happened to
    // land after. On the hour so "10:00" is met at 10:00.
    expect(CRON_JOBS["first-timers"].intervalMinutes).toBe(60);
    expect(CRON_JOBS["first-timers"].cron).toBe("0 * * * *");
  });

  /*
   * A church types the send time, to the minute. Hourly could only honour it
   * to the hour — and the drifting stopwatch it ran on sent "08:00" birthday
   * texts at 08:29. Both jobs claim each send before making it, so running
   * every five minutes is safe; see celebration-runs.ts for why a failure is
   * still retried hourly rather than at the next sweep.
   */
  it("sweeps birthdays and service reminders every five minutes", () => {
    for (const job of ["celebrations", "service-reminders", "pastoral-reminders"] as const) {
      expect(CRON_JOBS[job].intervalMinutes).toBe(5);
      expect(CRON_JOBS[job].cron).toBe("*/5 * * * *");
    }
  });

  it("declares the minute-level jobs tightly enough to notice a delay", () => {
    for (const job of ["broadcasts", "devotionals"] as const) {
      expect(CRON_JOBS[job].intervalMinutes).toBeLessThanOrEqual(5);
    }
  });

  it("checks the float every half hour", () => {
    expect(CRON_JOBS["platform-health"].intervalMinutes).toBe(30);
  });

  it("drafts the blog from a daily tick, because the week is claimed in the job", () => {
    // parseFive refuses a day-of-week expression; the ISO-week claim on
    // blog_draft_run is what makes this weekly. See blog-drafts.ts.
    expect(CRON_JOBS["blog-drafts"].intervalMinutes).toBe(1440);
    expect(CRON_JOBS["blog-drafts"].cron).toBe("0 5 * * *");
    expect(CRON_JOBS["assistant-retention"].intervalMinutes).toBe(1440);
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

  it("every expression can be fired on — a last and a next minute exist", () => {
    for (const job of jobs) {
      const last = lastFireAtOrBefore(CRON_JOBS[job].cron, NOW);
      const next = nextFireAfter(CRON_JOBS[job].cron, NOW);
      expect(last.getTime(), job).toBeLessThanOrEqual(NOW.getTime());
      expect(next.getTime(), job).toBeGreaterThan(NOW.getTime());
      expect(
        (next.getTime() - last.getTime()) / 60_000,
        `${job}: gap between consecutive fires`,
      ).toBeLessThanOrEqual(CRON_JOBS[job].intervalMinutes);
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
    expect(cronIntervalMinutes("* * * * *")).toBe(1);
  });

  it("refuses to guess at anything else", () => {
    expect(() => cronIntervalMinutes("0 2 * * 1")).toThrow();
    expect(() => cronIntervalMinutes("0,30 * * * *")).toThrow();
    expect(() => cronIntervalMinutes("0 2 * *")).toThrow();
    expect(() => cronIntervalMinutes("*/5 2 * * *")).toThrow();
  });

  it("refuses a step that is not a fixed interval", () => {
    // */7 fires at :56 and then :00 — four minutes later, not seven.
    expect(() => cronIntervalMinutes("*/7 * * * *")).toThrow(/divide 60/);
    expect(() => cronIntervalMinutes("0 */5 * * *")).toThrow(/divide 24/);
  });

  it("refuses a value off the clock", () => {
    expect(() => cronIntervalMinutes("60 * * * *")).toThrow(/out of range/);
    expect(() => cronIntervalMinutes("0 24 * * *")).toThrow(/out of range/);
  });
});

describe("cronMatches", () => {
  it("matches a step on the multiples, in UTC", () => {
    expect(cronMatches("*/5 * * * *", at("2026-08-11T12:05:00Z"))).toBe(true);
    expect(cronMatches("*/5 * * * *", at("2026-08-11T12:05:59Z"))).toBe(true);
    expect(cronMatches("*/5 * * * *", at("2026-08-11T12:06:00Z"))).toBe(false);
  });

  it("matches a fixed minute every hour", () => {
    expect(cronMatches("20 * * * *", at("2026-08-11T03:20:00Z"))).toBe(true);
    expect(cronMatches("20 * * * *", at("2026-08-11T03:21:00Z"))).toBe(false);
  });

  it("matches a daily hour and minute", () => {
    expect(cronMatches("0 7 * * *", at("2026-08-11T07:00:30Z"))).toBe(true);
    expect(cronMatches("0 7 * * *", at("2026-08-11T08:00:00Z"))).toBe(false);
  });

  it("matches a stepped hour at a fixed minute", () => {
    expect(cronMatches("0 */2 * * *", at("2026-08-11T14:00:00Z"))).toBe(true);
    expect(cronMatches("0 */2 * * *", at("2026-08-11T15:00:00Z"))).toBe(false);
  });

  it("reads the clock in UTC whatever offset the instant was written in", () => {
    // 08:20 at +02:00 is 06:20 UTC. The server lives in CEST; the schedule
    // does not.
    const d = at("2026-08-11T08:20:00+02:00");
    expect(cronMatches("20 6 * * *", d)).toBe(true);
    expect(cronMatches("20 8 * * *", d)).toBe(false);
  });
});

describe("lastFireAtOrBefore / nextFireAfter", () => {
  it("finds the step just gone and the step to come", () => {
    const now = at("2026-08-11T12:07:40Z");
    expect(lastFireAtOrBefore("*/5 * * * *", now).toISOString()).toBe(
      "2026-08-11T12:05:00.000Z",
    );
    expect(nextFireAfter("*/5 * * * *", now).toISOString()).toBe(
      "2026-08-11T12:10:00.000Z",
    );
  });

  it("treats the named minute itself as 'at or before', and not as 'after'", () => {
    const now = at("2026-08-11T12:05:00.250Z");
    expect(lastFireAtOrBefore("*/5 * * * *", now).toISOString()).toBe(
      "2026-08-11T12:05:00.000Z",
    );
    expect(nextFireAfter("*/5 * * * *", now).toISOString()).toBe(
      "2026-08-11T12:10:00.000Z",
    );
  });

  it("crosses midnight for a daily job", () => {
    const now = at("2026-08-11T03:00:00Z");
    expect(lastFireAtOrBefore("0 7 * * *", now).toISOString()).toBe(
      "2026-08-10T07:00:00.000Z",
    );
    expect(nextFireAfter("0 7 * * *", now).toISOString()).toBe(
      "2026-08-11T07:00:00.000Z",
    );
  });

  it("crosses the hour for a fixed minute", () => {
    const now = at("2026-08-11T12:10:00Z");
    expect(lastFireAtOrBefore("20 * * * *", now).toISOString()).toBe(
      "2026-08-11T11:20:00.000Z",
    );
    expect(nextFireAfter("20 * * * *", now).toISOString()).toBe(
      "2026-08-11T12:20:00.000Z",
    );
  });
});

/*
 * The in-app scheduler used to run a job once `intervalMinutes` had elapsed
 * since its last START — a stopwatch, checked once a minute. The hourly
 * birthday sweep therefore ran at whatever minute its first run landed on,
 * and slipped a minute later every few hours: :00 became :33 in nine days,
 * and a church that asked for greetings at 08:00 got them at 08:29.
 */
describe("isCronDue follows the expression, not a stopwatch", () => {
  it("never having run is due", () => {
    expect(isCronDue(null, "*/5 * * * *", NOW)).toBe(true);
  });

  it("is not due again inside the minute it just ran in", () => {
    const ranAt = at("2026-08-11T12:05:00.400Z");
    expect(isCronDue(ranAt, "*/5 * * * *", at("2026-08-11T12:05:00.600Z"))).toBe(false);
    expect(isCronDue(ranAt, "*/5 * * * *", at("2026-08-11T12:09:59.900Z"))).toBe(false);
  });

  it("is due the moment the next named minute arrives", () => {
    const ranAt = at("2026-08-11T12:05:00.400Z");
    expect(isCronDue(ranAt, "*/5 * * * *", at("2026-08-11T12:10:00.250Z"))).toBe(true);
  });

  it("a run started by hand does not move the schedule", () => {
    // Somebody curled the route at 08:10. The :20 fire still happens.
    const manual = at("2026-08-11T08:10:00Z");
    expect(isCronDue(manual, "20 * * * *", at("2026-08-11T08:19:00Z"))).toBe(false);
    expect(isCronDue(manual, "20 * * * *", at("2026-08-11T08:20:00.250Z"))).toBe(true);
  });

  it("a job that missed several minutes is due once, not once per minute missed", () => {
    // Deployed at 12:03, back at 12:31: the :05 .. :30 fires were missed.
    const ranAt = at("2026-08-11T12:00:00.300Z");
    const back = at("2026-08-11T12:31:00.250Z");
    expect(isCronDue(ranAt, "*/5 * * * *", back)).toBe(true);
    // Having run at 12:31, it is not due again until :35 — the backlog is not
    // replayed.
    const caughtUp = at("2026-08-11T12:31:00.900Z");
    expect(isCronDue(caughtUp, "*/5 * * * *", at("2026-08-11T12:32:00.250Z"))).toBe(false);
    expect(isCronDue(caughtUp, "*/5 * * * *", at("2026-08-11T12:35:00.250Z"))).toBe(true);
  });

  it("a daily job that ran yesterday at its hour is due today at its hour, and not before", () => {
    const ranAt = at("2026-08-10T07:00:00.300Z");
    expect(isCronDue(ranAt, "0 7 * * *", at("2026-08-11T06:59:00.250Z"))).toBe(false);
    expect(isCronDue(ranAt, "0 7 * * *", at("2026-08-11T07:00:00.250Z"))).toBe(true);
  });

  /*
   * The whole point, as a simulation: ticks just after every minute for six
   * hours, each run recorded a few hundred milliseconds in, the way the real
   * scheduler does. Under the stopwatch rule the hourly job's minute crept
   * later each hour; under the expression it stays put.
   */
  it("keeps an hourly job on its minute across hours of ticks", () => {
    const expr = "20 * * * *";
    let lastRunAt: Date | null = at("2026-08-11T00:20:00.400Z");
    const runs: string[] = [];
    const start = at("2026-08-11T00:21:00.250Z");
    for (let i = 0; i < 6 * 60; i++) {
      const tickAt = new Date(start.getTime() + i * 60_000);
      if (isCronDue(lastRunAt, expr, tickAt)) {
        lastRunAt = new Date(tickAt.getTime() + 150); // the route's own clock
        runs.push(lastRunAt.toISOString().slice(11, 19));
      }
    }
    expect(runs).toEqual([
      "01:20:00",
      "02:20:00",
      "03:20:00",
      "04:20:00",
      "05:20:00",
      "06:20:00",
    ]);
  });

  it("keeps a five-minute job on the fives", () => {
    const expr = "*/5 * * * *";
    let lastRunAt: Date | null = null;
    const minutes: number[] = [];
    const start = at("2026-08-11T09:02:00.250Z");
    for (let i = 0; i < 60; i++) {
      const tickAt = new Date(start.getTime() + i * 60_000);
      if (isCronDue(lastRunAt, expr, tickAt)) {
        lastRunAt = new Date(tickAt.getTime() + 150);
        minutes.push(lastRunAt.getUTCMinutes());
      }
    }
    // The first tick runs it (never run); every one after that is on a five.
    expect(minutes).toEqual([2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 0]);
  });

  it("anything overdue is also due", () => {
    for (const job of Object.keys(CRON_JOBS) as CronJob[]) {
      const { cron, intervalMinutes } = CRON_JOBS[job];
      for (const mins of [0, 1, 7, 20, 90, 1500, 5000]) {
        const last = minutesAgo(mins);
        if (isCronOverdue(last, intervalMinutes, NOW)) {
          expect(isCronDue(last, cron, NOW), `${job}/${mins}`).toBe(true);
        }
      }
    }
  });
});

describe("msUntilNextMinute", () => {
  it("counts down to :00 seconds", () => {
    expect(msUntilNextMinute(at("2026-08-11T12:05:00.000Z"))).toBe(60_000);
    expect(msUntilNextMinute(at("2026-08-11T12:05:00.250Z"))).toBe(59_750);
    expect(msUntilNextMinute(at("2026-08-11T12:05:59.000Z"))).toBe(1_000);
  });
});
