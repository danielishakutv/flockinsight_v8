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
 * So the cron expression lives here, beside the job. The in-app scheduler
 * (`scheduler.ts`) fires on it, `scripts/print-crontab.ts` can render a
 * crontab from it, and `cron-schedule.test.ts` fails the build if an
 * expression and its declared interval disagree. Adding a job to this object
 * is adding it to the schedule; there is no second place to remember.
 *
 * THE EXPRESSIONS ARE WHAT FIRES, AND THEY ARE IN UTC.
 *
 * Until 2026-10-14 the in-app scheduler never read `cron`. It ran a job once
 * `intervalMinutes` had passed since the job last STARTED, which is a
 * stopwatch, not a schedule: an hourly job fired at whatever minute its first
 * run happened to land on, and because a tick is a minute wide and the test
 * was "at least an hour", every few runs slipped a minute later. Nine days
 * after the switch the birthday sweep had drifted from :00 to :33, so a church
 * that asked for greetings at 08:00 got them at 08:29 — and the drift had no
 * end. `isCronDue` now asks whether a minute matching the expression has
 * passed since the last start, and the scheduler ticks just after the top of
 * each minute, so a job runs within a second of the minute it names. Evaluated
 * in UTC, so the box's own timezone and its daylight-saving changes cannot
 * move anything.
 *
 * Pure — no database, no server-only imports — so the rules can be unit-tested
 * directly. `cron-run.ts` owns the recording and reading.
 */

export type CronJobMeta = {
  label: string;
  /** How often it is expected to run; what "overdue" is measured against. */
  intervalMinutes: number;
  /** The five-field crontab expression, in UTC. This is what fires the job. */
  cron: string;
};

export const CRON_JOBS = {
  /*
   * Daily. The hours are UTC, chosen so the emails these send land in the
   * morning where most churches are (UTC+1): an owner nudged at 03:00 has
   * buried it by breakfast. They are also the hours these four had been
   * running at since the crontab days, so nothing moved when the app took the
   * schedule over. Each has its own minute, so the heavier ones never start
   * together.
   */
  storage: {
    label: "Storage add-on billing",
    intervalMinutes: 1440,
    cron: "20 0 * * *",
  },
  "branch-reports": {
    label: "Branch roll-up reports",
    intervalMinutes: 1440,
    cron: "0 4 * * *",
  },
  "trial-reminders": {
    label: "Trial ending reminders",
    intervalMinutes: 1440,
    cron: "0 6 * * *",
  },
  reminders: {
    label: "Inactivity reminders",
    intervalMinutes: 1440,
    cron: "0 7 * * *",
  },
  /*
   * Who actually used FlockInsight yesterday, kept for good.
   *
   * The certification ranks count weeks of real use. The raw evidence,
   * analytics_event, is pruned at 180 days by the reminders job (07:00), so a
   * year cannot be read from it. This job rolls each day into user_active_day
   * long before the prune can reach it, then issues any Master or Expert rank
   * that a Professional active yesterday has just crossed. After midnight UTC
   * so "yesterday" is complete; its own minute so it never starts together
   * with storage billing at 00:20. Sends nothing, so no SMS window applies.
   */
  "usage-days": {
    label: "Active days & certification ranks",
    intervalMinutes: 1440,
    cron: "40 0 * * *",
  },
  /*
   * The weekly blog draft, run DAILY on purpose. parseFive refuses a
   * day-of-week field, so the week is enforced inside the job, which claims
   * the ISO week on blog_draft_run's partial unique index. The first tick of
   * a week drafts. A failed draft is retried on the next two ticks. Every
   * other tick is one INSERT that conflicts and does nothing. With no
   * ANTHROPIC_API_KEY it writes nothing and reports "skipped". 05:00 UTC
   * means the draft is waiting when Lagos opens the admin on Monday.
   */
  "blog-drafts": {
    label: "Weekly blog draft",
    intervalMinutes: 1440,
    cron: "0 5 * * *",
  },
  /*
   * Help-assistant transcripts past the retention window (180 days after the
   * last message). This is a promise made to churches in the assistant's
   * privacy line, so it is scheduled here rather than left to a future
   * tidy-up. Deletes in batches. An approved canned answer keeps its own copy
   * of the question.
   */
  "assistant-retention": {
    label: "Assistant transcript retention",
    intervalMinutes: 1440,
    cron: "40 3 * * *",
  },

  /*
   * EVERY FIVE MINUTES, NOT HOURLY, because a church types the send time.
   *
   * The settings page takes any "HH:MM", and a sweep that runs once an hour
   * can only honour it to the hour: "send at 08:00" was met at 08:20 by the
   * old expression and at 08:29 by the drifting stopwatch, and "08:30" would
   * have waited for 09:00. Both of these claim each send before making it (a
   * reminder_run row, a celebration_run row), so running them often is safe,
   * and a pass with nothing due is one query. A failed greeting is still
   * retried at hourly spacing — see celebration-runs.ts — so the retry budget
   * across the send window is unchanged.
   */
  "service-reminders": {
    label: "Service reminders",
    intervalMinutes: 5,
    cron: "*/5 * * * *",
  },
  celebrations: {
    label: "Birthdays & anniversaries",
    intervalMinutes: 5,
    cron: "*/5 * * * *",
  },

  /*
   * HOURLY, ON THE HOUR — not daily, and not at five past.
   *
   * A church sets "send the welcome at 10:00" in its own timezone. A sweep
   * that runs once a day at a fixed UTC hour can only ever satisfy churches
   * whose send time falls before it, so this is hourly, and it sends anything
   * whose hour has come rather than only what falls in a window — so a missed
   * tick delays a welcome by an hour, never a day. On the hour, so a whole-hour
   * setting is met on the minute.
   *
   * Cheap to run often: idempotent per member per stage per channel, so a
   * sweep with nothing due is two queries and no sends.
   */
  "first-timers": {
    label: "First-timer follow-up",
    intervalMinutes: 60,
    cron: "0 * * * *",
  },
  /*
   * Hourly at a quarter past, for two reasons that both want an hour.
   *
   * A status email that failed when superadmin changed a Partner's account is
   * retried each hour until it is accepted. And the twice-weekly progress
   * email goes on Mondays and Thursdays from 09:00 Lagos — parseFive refuses
   * a day-of-week, so the days are decided inside the job (digestSlotFor),
   * which claims each Partner's send day on partner_digest's unique index. A
   * 09:00 run that hit a provider outage is made up at 10:00, not next week.
   * Its own minute, so it never starts with first-timers on the hour.
   */
  "partner-emails": {
    label: "Partner emails (status & twice-weekly progress)",
    intervalMinutes: 60,
    cron: "15 * * * *",
  },

  /*
   * Every five minutes, because remind_at is a minute worked out from
   * somebody's appointment and already moved inside the 8am-8pm SMS window.
   * An hourly sweep would send a 19:00 reminder at 19:59, and a minute later
   * the text could not go at all. Each reminder is claimed before it is sent
   * (conditional UPDATE of reminder_sent_at, returning), so running often is
   * safe, and a pass with nothing due is one indexed query.
   */
  "pastoral-reminders": {
    label: "Pastor appointment reminders",
    intervalMinutes: 5,
    cron: "*/5 * * * *",
  },

  /*
   * Time-sensitive: these deliver things people are waiting for at a time
   * somebody chose, so they run every five minutes. Both were fifteen for a
   * while, which sent a broadcast scheduled for 10:05 at 10:15.
   */
  broadcasts: {
    label: "Scheduled broadcasts",
    intervalMinutes: 5,
    cron: "*/5 * * * *",
  },
  devotionals: {
    label: "Devotional delivery",
    intervalMinutes: 5,
    cron: "*/5 * * * *",
  },
  /*
   * The SMS held overnight for the 8am-8pm delivery window.
   *
   * At 8am a queue that built up overnight is a church's Sunday reminders,
   * and every tick of delay is a minute later than they asked for.
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

  /*
   * The safety net under the Paystack webhook: settles platform checkouts
   * still pending after ten minutes. A missed webhook is a church that has
   * paid and is still locked out, so this is time-sensitive — but it asks
   * Paystack about each reference, so not every five minutes.
   */
  "payment-reconcile": {
    label: "Payment reconcile",
    intervalMinutes: 15,
    cron: "*/15 * * * *",
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

const MINUTE_MS = 60_000;

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
 * NOT the same question as `isCronOverdue`. Overdue is the interval plus
 * patience — the rule for deciding whether to complain. Due is "has a minute
 * this expression names gone by since the job last started": the rule for
 * deciding whether to run, and the only one a schedule can be built on.
 *
 * Two consequences worth knowing. A run started by hand (curl, the health
 * page) does not move the schedule — the next named minute still fires, as it
 * would under cron. And a job that missed several named minutes (a deploy, a
 * long run of its own) is run ONCE to catch up, not once per minute missed:
 * the question is whether the latest fire time is after the last start, and
 * the answer is the same whether one minute was missed or forty.
 */
export function isCronDue(
  lastRunAt: Date | null,
  cron: string,
  now: Date = new Date(),
): boolean {
  if (lastRunAt === null) return true;
  return lastFireAtOrBefore(cron, now).getTime() > lastRunAt.getTime();
}

/** Has this job missed its window? A job that has never run always has. */
export function isCronOverdue(
  lastRunAt: Date | null,
  intervalMinutes: number,
  now: Date = new Date(),
): boolean {
  if (lastRunAt === null) return true;
  const allowedMs = (intervalMinutes + graceMinutes(intervalMinutes)) * MINUTE_MS;
  return now.getTime() - lastRunAt.getTime() > allowedMs;
}

type ParsedCron = { minute: string; hour: string };

/**
 * Read a five-field expression, refusing anything this module cannot reason
 * about exactly.
 *
 * Deliberately narrow: a wildcard, a fixed value, or a step that divides the
 * field evenly, and only daily-or-shorter schedules. A minute step of seven
 * would fire at :56 and then :00, four minutes later, which is not "every 7
 * minutes" by anybody's reckoning; a day-of-week would make the interval test
 * lie. (Steps are not written out here: the two characters that open one
 * also close a comment like this.) The
 * whole point of these helpers is to catch an expression that disagrees with
 * what is written beside it, so a wrong answer is worse than no answer.
 */
function parseFive(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`not a five-field cron expression: "${expr}"`);
  }
  const [minute, hour, dom, month, dow] = parts;

  const checks: [string, string, number][] = [
    [minute, "minute", 60],
    [hour, "hour", 24],
  ];
  for (const [field, name, size] of checks) {
    const s = step(field);
    if (field !== "*" && !fixed(field) && s === null) {
      throw new Error(`unsupported ${name} field "${field}" in "${expr}"`);
    }
    if (fixed(field) && Number(field) >= size) {
      throw new Error(`${name} ${field} is out of range in "${expr}"`);
    }
    if (s !== null && (s < 1 || size % s !== 0)) {
      throw new Error(
        `a ${name} step must divide ${size} evenly, so "${field}" in "${expr}" is not a fixed interval`,
      );
    }
  }
  if (dom !== "*" || month !== "*" || dow !== "*") {
    throw new Error(`only daily-or-shorter schedules are supported: "${expr}"`);
  }
  return { minute, hour };
}

function step(field: string): number | null {
  const m = /^\*\/(\d+)$/.exec(field);
  return m ? Number(m[1]) : null;
}

function fixed(field: string): boolean {
  return /^\d+$/.test(field);
}

function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  const s = step(field);
  if (s !== null) return value % s === 0;
  return value === Number(field);
}

function matchesParsed(p: ParsedCron, at: Date): boolean {
  return (
    fieldMatches(p.minute, at.getUTCMinutes()) &&
    fieldMatches(p.hour, at.getUTCHours())
  );
}

/** Does the expression name this UTC minute? Seconds are ignored. */
export function cronMatches(expr: string, at: Date): boolean {
  return matchesParsed(parseFive(expr), at);
}

/*
 * A day and one minute: every expression this module accepts fires at least
 * once a day, so a search that long cannot miss. Walking minute by minute is
 * a few hundred comparisons for a daily job and one for a `* * * * *`, which
 * is nothing per tick — and it is the same predicate as `cronMatches`, so the
 * two cannot disagree the way a cleverer closed form could.
 */
const SEARCH_MINUTES = 1441;

function floorToMinute(at: Date): Date {
  return new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS);
}

/** The most recent minute at or before `now` that the expression fires on. */
export function lastFireAtOrBefore(expr: string, now: Date): Date {
  const p = parseFive(expr);
  const t = floorToMinute(now);
  for (let i = 0; i < SEARCH_MINUTES; i++) {
    if (matchesParsed(p, t)) return t;
    t.setTime(t.getTime() - MINUTE_MS);
  }
  throw new Error(`"${expr}" did not fire in the day before ${now.toISOString()}`);
}

/** The first minute strictly after `now` that the expression fires on. */
export function nextFireAfter(expr: string, now: Date): Date {
  const p = parseFive(expr);
  const t = new Date(floorToMinute(now).getTime() + MINUTE_MS);
  for (let i = 0; i < SEARCH_MINUTES; i++) {
    if (matchesParsed(p, t)) return t;
    t.setTime(t.getTime() + MINUTE_MS);
  }
  throw new Error(`"${expr}" does not fire in the day after ${now.toISOString()}`);
}

/**
 * How long until the clock next reads :00 seconds. The scheduler ticks on
 * that, so a job named for a minute runs in that minute rather than up to a
 * minute into the next one.
 */
export function msUntilNextMinute(now: Date): number {
  return MINUTE_MS - (now.getTime() % MINUTE_MS);
}

/**
 * How often a five-field cron expression actually fires, in minutes.
 *
 * Its whole job is to catch an expression that disagrees with the interval
 * declared next to it, and it accepts only the shapes `parseFive` does.
 */
export function cronIntervalMinutes(expr: string): number {
  const { minute, hour } = parseFive(expr);

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
