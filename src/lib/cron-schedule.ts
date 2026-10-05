/**
 * Every scheduled job: what it does, when it runs, and when it counts as late.
 *
 * THIS FILE IS THE SCHEDULE, not a description of one kept somewhere else.
 *
 * It used to hold only `intervalMinutes`, and the actual times lived in a
 * crontab on the server that nothing in this repository mentioned. Nine of the
 * thirteen jobs had their schedule written down nowhere at all — and one of
 * them, `sms-queue`, had simply never been added. Every SMS handed in outside
 * the 8am-8pm delivery window sat in `scheduled_sms` unsent, for months,
 * because the only thing that would have flushed it was a line somebody forgot
 * to type. Nothing could detect that: the health page can say a job is overdue,
 * but not that it was never meant to run in the first place.
 *
 * So the cron expression lives here, beside the job, and
 * `scripts/print-crontab.ts` renders the server's crontab from it. Adding a
 * job to this object is adding it to the schedule; there is no second place to
 * remember. `cron-schedule.test.ts` fails the build if an expression and its
 * declared interval disagree.
 *
 * Pure — no database, no server-only imports — so the rules can be unit-tested
 * directly. `cron-run.ts` owns the recording and reading.
 */

export type CronJobMeta = {
  label: string;
  /** How often it is expected to run; what "overdue" is measured against. */
  intervalMinutes: number;
  /** The five-field crontab expression. Rendered by print-crontab.ts. */
  cron: string;
};

export const CRON_JOBS = {
  /*
   * Daily, staggered through the quiet hours so they never contend for the
   * database or the mail server at the same minute.
   */
  reminders: {
    label: "Inactivity reminders",
    intervalMinutes: 1440,
    cron: "0 2 * * *",
  },
  storage: {
    label: "Storage add-on billing",
    intervalMinutes: 1440,
    cron: "15 2 * * *",
  },
  "trial-reminders": {
    label: "Trial ending reminders",
    intervalMinutes: 1440,
    cron: "30 2 * * *",
  },
  "branch-reports": {
    label: "Branch roll-up reports",
    intervalMinutes: 1440,
    cron: "45 2 * * *",
  },

  // Hourly.
  "service-reminders": {
    label: "Service reminders",
    intervalMinutes: 60,
    cron: "10 * * * *",
  },
  celebrations: {
    label: "Birthdays & anniversaries",
    intervalMinutes: 60,
    cron: "20 * * * *",
  },
  /*
   * HOURLY, NOT DAILY — changed once the sequence started honouring the
   * church's own `sendTime`.
   *
   * A church sets "send the welcome at 10:00" in its own timezone. A sweep
   * that runs once a day at a fixed UTC hour can only ever satisfy churches
   * whose send time falls before it, and on a UTC box 10:00 in Lagos is a
   * different hour again — so the setting was unreachable, and the sends
   * landed in the middle of the night, outside the hours SMS may be delivered
   * in. Hourly means every church's own hour comes round.
   *
   * Cheap to run often: idempotent per member per stage per channel, so a
   * sweep with nothing due is two queries and no sends.
   */
  "first-timers": {
    label: "First-timer follow-up",
    intervalMinutes: 60,
    cron: "5 * * * *",
  },

  // Time-sensitive: these deliver things people are waiting for, so a delay
  // matters and they run every few minutes.
  broadcasts: {
    label: "Scheduled broadcasts",
    intervalMinutes: 15,
    cron: "*/15 * * * *",
  },
  devotionals: {
    label: "Devotional delivery",
    intervalMinutes: 15,
    cron: "*/15 * * * *",
  },
  /*
   * The SMS held overnight for the 8am-8pm delivery window.
   *
   * Five minutes, the shortest interval here: at 8am a queue that built up
   * overnight is a church's Sunday reminders, and every tick of delay is a
   * minute later than they asked for.
   *
   * THIS IS THE JOB THAT WAS MISSING FROM THE SERVER. If it is not running,
   * nothing else reports it — the messages queue successfully and simply stay
   * there. `flushSmsQueue` now expires anything older than a day and logs that
   * the job may not be scheduled, which is the only automatic signal there is.
   */
  "sms-queue": {
    label: "Queued SMS",
    intervalMinutes: 5,
    cron: "*/5 * * * *",
  },

  // Meeting housekeeping: closes rooms whose last person vanished, and sweeps
  // the signalling buffer. Cheap, and wanted often — a room that shows as live
  // for an hour after everyone left is the thing people notice.
  meetings: {
    label: "Meeting housekeeping",
    intervalMinutes: 10,
    cron: "*/10 * * * *",
  },

  // The float check.
  "platform-health": {
    label: "Platform health & float",
    intervalMinutes: 30,
    cron: "*/30 * * * *",
  },

  /*
   * The demonstration church, wiped and rebuilt.
   *
   * Two hours is the promise made on the demo itself ("nothing here is real —
   * it is rebuilt every two hours"), so this interval is a published fact
   * rather than a tuning choice.
   */
  "demo-reset": {
    label: "Demo church reset",
    intervalMinutes: 120,
    cron: "0 */2 * * *",
  },
} as const satisfies Record<string, CronJobMeta>;

export type CronJob = keyof typeof CRON_JOBS;

/**
 * Grace on top of the expected interval before a job is called late.
 *
 * Capped at an hour: a plain multiplier is fine for short intervals but
 * absurd for a daily job, where doubling would mean staying silent for two
 * days. One missed daily run should be visible the next morning, not the
 * morning after that.
 */
function graceMinutes(intervalMinutes: number): number {
  return Math.min(intervalMinutes, 60);
}

/**
 * Is it time to run this job? A job that has never run always is.
 *
 * NOT the same question as `isCronOverdue`, and the difference cost the queue
 * half its speed. The in-app scheduler used the overdue rule to decide what to
 * run, and the overdue rule adds a grace period before complaining — so a job
 * declared every 5 minutes only became "overdue" after 10, and ran at half the
 * rate it asked for. Queued SMS waited twice as long as intended, and a
 * 15-minute broadcast job ran every half hour.
 *
 * Due is the interval, exactly. Overdue is the interval plus patience. The
 * scheduler wants the first; the health page and the alerts want the second.
 */
export function isCronDue(
  lastRunAt: Date | null,
  intervalMinutes: number,
  now: Date = new Date(),
): boolean {
  if (lastRunAt === null) return true;
  return now.getTime() - lastRunAt.getTime() >= intervalMinutes * 60_000;
}

/** Has this job missed its window? A job that has never run always has. */
export function isCronOverdue(
  lastRunAt: Date | null,
  intervalMinutes: number,
  now: Date = new Date(),
): boolean {
  if (lastRunAt === null) return true;
  const allowedMs = (intervalMinutes + graceMinutes(intervalMinutes)) * 60_000;
  return now.getTime() - lastRunAt.getTime() > allowedMs;
}

/**
 * How often a five-field cron expression actually fires, in minutes.
 *
 * Deliberately narrow: it understands only the shapes used above — a wildcard,
 * a fixed value, and a step — and throws on anything else rather than guessing.
 * Its whole job is to catch an expression that disagrees with the interval
 * declared next to it, so a wrong answer would be worse than no answer.
 */
export function cronIntervalMinutes(expr: string): number {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`not a five-field cron expression: "${expr}"`);
  }
  const [minute, hour, dom, month, dow] = parts;

  const step = (field: string): number | null => {
    const m = /^\*\/(\d+)$/.exec(field);
    return m ? Number(m[1]) : null;
  };
  const fixed = (field: string): boolean => /^\d+$/.test(field);

  const assertSimple = (field: string, name: string) => {
    if (field !== "*" && !fixed(field) && step(field) === null) {
      throw new Error(`unsupported ${name} field "${field}" in "${expr}"`);
    }
  };
  for (const [f, n] of [
    [minute, "minute"],
    [hour, "hour"],
    [dom, "day-of-month"],
    [month, "month"],
    [dow, "day-of-week"],
  ] as const) {
    assertSimple(f, n);
  }
  if (dom !== "*" || month !== "*" || dow !== "*") {
    throw new Error(`only daily-or-shorter schedules are supported: "${expr}"`);
  }

  const minuteStep = step(minute);
  if (minuteStep !== null) {
    if (hour !== "*") {
      throw new Error(`a stepped minute needs an hourly wildcard: "${expr}"`);
    }
    return minuteStep;
  }
  if (!fixed(minute)) {
    // `* * * * *` — every minute.
    return hour === "*" ? 1 : 60;
  }
  // A fixed minute: how often does the hour field come round?
  const hourStep = step(hour);
  if (hourStep !== null) return hourStep * 60;
  if (hour === "*") return 60;
  return 1440; // fixed minute, fixed hour — once a day.
}
