/**
 * When SMS may actually be sent.
 *
 * Nigerian networks only deliver corporate/bulk SMS between 8am and 8pm, and a
 * message handed over outside that window is not held for later — it is
 * charged and dropped. So a 9pm "service tomorrow" blast was money spent on
 * nothing, with a cheerful "sent" in the history to prove otherwise.
 *
 * This file is the rule, and nothing else. Pure, no database, no server-only
 * import, so the composer, the sender, the queue worker and a unit test all
 * read the same hours — and the one place that decides "too late to send" can
 * be tested directly instead of inferred from behaviour at 7:58pm.
 *
 * LOCAL TO THE CHURCH, never to the server. The box is in UTC and the church
 * is in Lagos or Maputo; comparing a UTC hour against 8 would open the window
 * at 9am for one of them and shut it at 7pm for the other.
 */

/** First hour messages may go out, in the church's own timezone. */
export const SMS_WINDOW_START_HOUR = 8;
/** First hour they may NOT — so 20 means the last message goes at 19:59. */
export const SMS_WINDOW_END_HOUR = 20;

/** "8am - 8pm", for any sentence that has to say it. */
export const SMS_WINDOW_LABEL = "8am – 8pm";

/**
 * The wall-clock parts of an instant in a given timezone.
 *
 * `Intl` rather than any date library: it is the only thing on hand that knows
 * every zone's rules, including the ones that change.
 */
function zonedParts(at: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const got: Record<string, number> = {};
  for (const p of fmt.formatToParts(at)) {
    if (p.type !== "literal") got[p.type] = Number(p.value);
  }
  return {
    year: got.year,
    month: got.month,
    day: got.day,
    // Intl's h23 can report hour 24 for midnight in some runtimes.
    hour: got.hour === 24 ? 0 : got.hour,
    minute: got.minute,
    second: got.second,
  };
}

/**
 * A timezone that `Intl` does not recognise throws, and the caller is usually
 * a send path. A bad timezone must not stop a church's messages, so it falls
 * back to the platform's home zone rather than failing.
 */
function safeZone(timeZone: string | null | undefined): string {
  const tz = (timeZone || "").trim() || "Africa/Lagos";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "Africa/Lagos";
  }
}

/** The hour of the day, 0–23, where this church is. */
export function localHour(at: Date, timeZone: string): number {
  return zonedParts(at, safeZone(timeZone)).hour;
}

/**
 * Minutes since local midnight where this church is — so a setting written as
 * "10:00" can be compared against the clock on the wall there.
 *
 * Exported because a church's configured send time is stored as local HH:MM and
 * every job that honours one needs the same comparison. The first-timer
 * sequence did not have this and so ignored its own `sendTime` entirely,
 * running whenever the daily cron happened to fire — which on a UTC box is
 * the middle of the night in Lagos, outside the hours SMS may be delivered.
 */
export function localMinutesOfDay(at: Date, timeZone: string): number {
  const p = zonedParts(at, safeZone(timeZone));
  return p.hour * 60 + p.minute;
}

/** Minutes since midnight for a stored "HH:MM". Unparseable reads as 00:00. */
export function minutesFromHHMM(hhmm: string): number {
  const [h, m] = (hhmm || "").split(":").map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(h)) return 0;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

/** Can a message go out right now? */
export function withinSmsWindow(at: Date, timeZone: string): boolean {
  const h = localHour(at, timeZone);
  return h >= SMS_WINDOW_START_HOUR && h < SMS_WINDOW_END_HOUR;
}

/**
 * The UTC instant for a given wall-clock time in a zone.
 *
 * Two passes, because the offset to apply is the offset AT the answer, not at
 * the guess: the first pass lands within an hour, and the second corrects for
 * a DST boundary crossed on the way. Nigeria has no DST, but churches in zones
 * that do run the same code.
 */
function zonedTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number },
  timeZone: string,
): Date {
  const wanted = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, 0, 0, 0);
  let guess = new Date(wanted);
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(guess, timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const drift = seen - guess.getTime(); // the zone's offset at this instant
    guess = new Date(wanted - drift);
  }
  return guess;
}

/**
 * The next moment a message could be delivered — today at 8am if the day has
 * not started yet, otherwise tomorrow at 8am. Returns `at` itself when the
 * window is already open, so a caller can use the answer unconditionally.
 */
export function nextSmsWindowStart(at: Date, timeZone: string): Date {
  const tz = safeZone(timeZone);
  if (withinSmsWindow(at, tz)) return at;

  const p = zonedParts(at, tz);
  if (p.hour < SMS_WINDOW_START_HOUR) {
    // Early morning — later today.
    return zonedTimeToUtc({ ...p, hour: SMS_WINDOW_START_HOUR }, tz);
  }
  /*
   * Evening — tomorrow morning. The date is advanced in UTC and then read back
   * in the church's zone, so the last day of a month, a leap day and the end
   * of a year all come out right without a calendar of their own.
   */
  const tomorrow = zonedParts(
    new Date(zonedTimeToUtc({ ...p, hour: 12 }, tz).getTime() + 86_400_000),
    tz,
  );
  return zonedTimeToUtc({ ...tomorrow, hour: SMS_WINDOW_START_HOUR }, tz);
}

/**
 * What to tell somebody who has just pressed Send too late.
 *
 * Says the hours, the actual time it will go, and that nothing is charged
 * until then — the three things somebody needs to decide whether to wait or to
 * send an email instead.
 */
export function smsWindowNotice(sendAfter: Date, timeZone: string): string {
  const tz = safeZone(timeZone);
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(sendAfter);
  return `Networks only deliver SMS between ${SMS_WINDOW_LABEL}, so this is queued for ${when}. Nothing is charged to your wallet until it goes out.`;
}
