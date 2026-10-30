/**
 * When a church hears that its free trial is ending, and in what words.
 *
 * Pure: no database, no clock of its own. The hourly job in
 * `api/cron/trial-reminders` reads the church, asks these functions what is
 * due, sends it, and records the stage, so each step goes once.
 *
 * EMAIL goes at 14 days, 7 days, 3 days, 2 days, 1 day and 3 hours. It used to
 * stop at 3 days, from a job that ran once a day, so the last thing a church
 * heard was half a week before it was locked out. The day-based ones wait for
 * the church's morning-to-evening (07:00-21:00 local) rather than landing at
 * whatever hour the threshold is crossed, which for a trial ending at midnight
 * is midnight. The 3-hour one is the last warning there is, so it goes when it
 * is due, whatever the hour.
 *
 * SMS goes at 7 days, 3 days and 1 day, only inside the networks' delivery
 * window (`sms-window.ts`): a text handed over at 9pm is charged and dropped,
 * so the hourly job simply waits for 08:00. Three, not six — these are paid
 * for by the platform, and a text is for the warnings that must arrive.
 *
 * Stage numbers are stored on the church (`trialReminderStage`,
 * `trialSmsStage`) and only ever move forward. Email stages 1-3 mean what they
 * meant before this ladder grew (14 / 7 / 3 days), so a church part-way through
 * the old ladder carries on from where it was.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type Rung = { stage: number; within: number; anyHour?: boolean };

export const TRIAL_EMAIL_LADDER: readonly Rung[] = [
  { stage: 1, within: 14 * DAY },
  { stage: 2, within: 7 * DAY },
  { stage: 3, within: 3 * DAY },
  { stage: 4, within: 2 * DAY },
  { stage: 5, within: 1 * DAY },
  { stage: 6, within: 3 * HOUR, anyHour: true },
];

export const TRIAL_SMS_LADDER: readonly Rung[] = [
  { stage: 1, within: 7 * DAY },
  { stage: 2, within: 3 * DAY },
  { stage: 3, within: 1 * DAY },
];

/** The church's local hours in which a day-based email may go. */
export const EMAIL_HOURS = { start: 7, end: 21 } as const;

/** The furthest rung already reached, or null when none is. */
function reached(ladder: readonly Rung[], msLeft: number): Rung | null {
  if (msLeft <= 0) return null;
  let hit: Rung | null = null;
  for (const r of ladder) if (msLeft <= r.within) hit = r;
  return hit;
}

/**
 * The email stage to send now, or null.
 *
 * Only the furthest rung reached is sent: a trial shortened by an admin to two
 * days gets the 2-day email, not a burst of the 14-, 7- and 3-day ones in the
 * same hour.
 */
export function trialEmailDue(
  msLeft: number,
  localHour: number,
  sentStage: number,
): number | null {
  const rung = reached(TRIAL_EMAIL_LADDER, msLeft);
  if (!rung || rung.stage <= sentStage) return null;
  if (!rung.anyHour && (localHour < EMAIL_HOURS.start || localHour >= EMAIL_HOURS.end)) {
    return null;
  }
  return rung.stage;
}

/** The SMS stage to send now, or null. `inWindow` is `withinSmsWindow(...)`. */
export function trialSmsDue(
  msLeft: number,
  inWindow: boolean,
  sentStage: number,
): number | null {
  const rung = reached(TRIAL_SMS_LADDER, msLeft);
  if (!rung || rung.stage <= sentStage || !inWindow) return null;
  return rung.stage;
}

/**
 * "in 6 days", "in 18 hours", "in about 3 hours".
 *
 * Hours below a day and a half, because a day-based reminder sent at 07:00 for
 * a trial ending just after midnight has 17 hours left, and "in 1 day" would
 * tell a pastor they have until tomorrow evening.
 */
export function timeLeftPhrase(msLeft: number): string {
  const hours = Math.max(1, Math.round(msLeft / HOUR));
  if (msLeft <= 4 * HOUR) return `in about ${hours} hour${hours === 1 ? "" : "s"}`;
  if (msLeft < 36 * HOUR) return `in ${hours} hours`;
  const days = Math.round(msLeft / DAY);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/** "Sunday 15 November at 11:59 pm", in the church's own timezone. */
export function trialEndLabel(endsAt: Date, timeZone: string): string {
  const fmt = (o: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat("en-GB", { ...o, timeZone }).format(endsAt);
    } catch {
      // A timezone Intl does not know: say it in UTC rather than throw and
      // stop the reminders for every church after this one.
      return new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "UTC" }).format(endsAt);
    }
  };
  const day = fmt({ weekday: "long", day: "numeric", month: "long" });
  const time = fmt({ hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
  return `${day} at ${time}`;
}
