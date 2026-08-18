/**
 * What each scheduled job is *supposed* to do, and when it counts as late.
 *
 * Pure — no database, no server-only imports — so the liveness rules can be
 * unit-tested directly. `cron-run.ts` owns the recording and reading.
 *
 * The intervals here must match the crontab on the server AND the schedule
 * documented at the top of each route. When they drifted apart, the health
 * page reported daily jobs as overdue after two hours (a false alarm) while
 * giving minute-level jobs two hours of silence before saying anything.
 */

export const CRON_JOBS = {
  // Daily — see the doc comment on each route.
  reminders: { label: "Inactivity reminders", intervalMinutes: 1440 },
  storage: { label: "Storage add-on billing", intervalMinutes: 1440 },
  "first-timers": { label: "First-timer follow-up", intervalMinutes: 1440 },
  "trial-reminders": { label: "Trial ending reminders", intervalMinutes: 1440 },
  "branch-reports": { label: "Branch roll-up reports", intervalMinutes: 1440 },

  // Hourly.
  "service-reminders": { label: "Service reminders", intervalMinutes: 60 },
  celebrations: { label: "Birthdays & anniversaries", intervalMinutes: 60 },

  // Time-sensitive: these deliver things people are waiting for, so a delay
  // matters and the crontab should run them every few minutes.
  broadcasts: { label: "Scheduled broadcasts", intervalMinutes: 15 },
  devotionals: { label: "Devotional delivery", intervalMinutes: 15 },

  // The float check.
  "platform-health": { label: "Platform health & float", intervalMinutes: 30 },
} as const;

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
