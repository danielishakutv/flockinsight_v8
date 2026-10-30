import { describe, expect, it } from "vitest";
import {
  timeLeftPhrase,
  trialEmailDue,
  trialEndLabel,
  trialSmsDue,
} from "@/lib/trial-reminders";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MORNING = 9;
const NIGHT = 2;

/**
 * Walk a trial's last fortnight an hour at a time, the way the hourly job
 * does, and record what goes out. `hourAt` gives the church's local hour for
 * each step back from the end.
 */
function simulate(endLocalHour: number) {
  const emails: number[] = [];
  const texts: number[] = [];
  let emailStage = 0;
  let smsStage = 0;
  for (let h = 15 * 24; h >= 0; h--) {
    const msLeft = h * HOUR - 1; // just inside each hour
    const local = (((endLocalHour - h) % 24) + 24) % 24;
    const e = trialEmailDue(msLeft, local, emailStage);
    if (e !== null) {
      emails.push(e);
      emailStage = e;
    }
    const s = trialSmsDue(msLeft, local >= 8 && local < 20, smsStage);
    if (s !== null) {
      texts.push(s);
      smsStage = s;
    }
  }
  return { emails, texts };
}

describe("the trial-ending ladder", () => {
  it("emails at 14, 7, 3, 2 and 1 days and 3 hours, each once", () => {
    // A trial ending just before midnight, church time.
    expect(simulate(23).emails).toEqual([1, 2, 3, 4, 5, 6]);
    // And one ending just after midnight (a UTC end seen from Lagos).
    expect(simulate(1).emails).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("texts at 7, 3 and 1 days, each once, and only between 8am and 8pm", () => {
    expect(simulate(23).texts).toEqual([1, 2, 3]);
    expect(simulate(1).texts).toEqual([1, 2, 3]);
  });

  it("holds a days-out email until the church's daytime", () => {
    expect(trialEmailDue(6 * DAY, NIGHT, 1)).toBeNull();
    expect(trialEmailDue(6 * DAY, MORNING, 1)).toBe(2);
  });

  it("sends the 3-hour warning at any hour — it is the last one", () => {
    expect(trialEmailDue(2 * HOUR, NIGHT, 5)).toBe(6);
    expect(trialEmailDue(2 * HOUR, NIGHT, 6)).toBeNull();
  });

  it("skips straight to the current step rather than sending a backlog", () => {
    // A trial cut to two days by an admin gets the 2-day email, once.
    expect(trialEmailDue(2 * DAY - HOUR, MORNING, 0)).toBe(4);
    expect(trialSmsDue(2 * DAY - HOUR, true, 0)).toBe(2);
  });

  it("carries on from a church already part-way through the old 14/7/3 ladder", () => {
    // Old stage 3 meant "the 3-day email went"; the next is the 2-day one.
    expect(trialEmailDue(3 * DAY - HOUR, MORNING, 3)).toBeNull();
    expect(trialEmailDue(2 * DAY - HOUR, MORNING, 3)).toBe(4);
  });

  it("sends nothing before the fortnight or after the end", () => {
    expect(trialEmailDue(15 * DAY, MORNING, 0)).toBeNull();
    expect(trialEmailDue(0, MORNING, 0)).toBeNull();
    expect(trialEmailDue(-HOUR, MORNING, 0)).toBeNull();
    expect(trialSmsDue(8 * DAY, true, 0)).toBeNull();
  });

  it("never texts outside the delivery window", () => {
    expect(trialSmsDue(20 * HOUR, false, 2)).toBeNull();
  });
});

describe("the words", () => {
  it("says hours, not '1 day', when it is less than a day and a half", () => {
    expect(timeLeftPhrase(3 * HOUR)).toBe("in about 3 hours");
    expect(timeLeftPhrase(17 * HOUR)).toBe("in 17 hours");
    expect(timeLeftPhrase(42 * HOUR)).toBe("in 2 days");
    expect(timeLeftPhrase(14 * DAY - HOUR)).toBe("in 14 days");
  });

  it("names the end in the church's own timezone", () => {
    const end = new Date("2026-11-15T23:59:59Z");
    expect(trialEndLabel(end, "UTC")).toBe("Sunday 15 November at 11:59 pm");
    expect(trialEndLabel(end, "Africa/Lagos")).toBe("Monday 16 November at 12:59 am");
    // An unknown zone falls back rather than throwing.
    expect(trialEndLabel(end, "Not/AZone")).toBe("Sunday 15 November at 11:59 pm");
  });
});
