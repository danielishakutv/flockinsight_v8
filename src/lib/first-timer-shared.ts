/**
 * What a first-timer form accepts, and what it refuses.
 *
 * Pure — no database, no server-only imports — so the staff form, the public
 * page and the tests all validate against exactly the same rules. The public
 * half of this is reachable by anyone with the link, so "the client already
 * checked" is never a reason to trust anything here.
 *
 * The shape is deliberately short. The whole point of this module is that a
 * welcome desk should be asked the handful of things it actually knows, not
 * the twenty-five fields on the membership form.
 */

import { isRealCalendarDate, todayIso } from "@/lib/calendar-date";

export type FirstTimerIntake = {
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  gender?: string | null;
  /** YYYY-MM-DD. Defaults to today when left out. */
  firstVisitDate?: string | null;
  /** Picked from the register. */
  invitedById?: string | null;
  /** Typed, when they were not picked from the register. */
  invitedByName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  notes?: string | null;
};

export type CleanIntake = {
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  gender: "male" | "female" | null;
  firstVisitDate: string;
  invitedById: string | null;
  invitedByName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/*
 * Deliberately loose. An address written on a welcome card is not an
 * authentication factor, and a church in Jalingo should not have a visitor
 * turned away because a regular expression disagreed about their email. It
 * only has to be shaped enough that a confirmation could be attempted.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Longest value any single field may carry, to bound what a stranger can post. */
const LIMITS = {
  firstName: 80,
  lastName: 80,
  phone: 30,
  email: 160,
  invitedByName: 120,
  address: 200,
  city: 80,
  state: 80,
  notes: 1000,
} as const;

function trimmed(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

/** Re-exported so a form and its test share one idea of "today". */
export const today = todayIso;

export type CleanResult =
  | { ok: true; value: CleanIntake }
  | { ok: false; error: string };

/**
 * Validate and normalise. The error is the sentence a person reads, so it says
 * what to do rather than which rule failed.
 */
export function cleanIntake(
  input: FirstTimerIntake,
  now: Date = new Date(),
): CleanResult {
  const firstName = trimmed(input.firstName, LIMITS.firstName);
  if (!firstName) return { ok: false, error: "A first name is needed." };

  const phone = trimmed(input.phone, LIMITS.phone);
  const email = trimmed(input.email, LIMITS.email)?.toLowerCase() ?? null;

  if (email && !EMAIL.test(email)) {
    return { ok: false, error: "That email address does not look right." };
  }

  /*
   * One way to reach them, or there is no follow-up to do.
   *
   * This is the only field rule that refuses a submission outright, and it
   * earns it: the entire purpose of writing a first-timer down is so somebody
   * can contact them this week. A card with a name and nothing else is a row
   * that will sit in the list for ever being no use to anyone.
   */
  if (!phone && !email) {
    return {
      ok: false,
      error: "Add a phone number or an email, so someone can reach them.",
    };
  }

  const genderRaw = trimmed(input.gender, 10)?.toLowerCase() ?? null;
  const gender =
    genderRaw === "male" || genderRaw === "female" ? genderRaw : null;

  let firstVisitDate = trimmed(input.firstVisitDate, 10) ?? todayIso(now);
  /*
   * `isRealCalendarDate`, not a parse. `new Date("2026-02-31")` rolls over to
   * March the 3rd rather than failing, so the usual isNaN check lets an
   * impossible date through to Postgres, where it aborts the insert — losing
   * a visitor's card to a typo.
   */
  if (!isRealCalendarDate(firstVisitDate)) firstVisitDate = todayIso(now);
  else if (firstVisitDate > todayIso(now)) {
    /*
     * A visit cannot be in the future. Clamped rather than refused: somebody
     * mistyping the year at a busy welcome desk should not lose the whole
     * card, and "they came today" is the overwhelmingly likely truth.
     */
    firstVisitDate = today(now);
  }

  const invitedByIdRaw = trimmed(input.invitedById, 40);
  const invitedById = invitedByIdRaw && UUID.test(invitedByIdRaw) ? invitedByIdRaw : null;

  return {
    ok: true,
    value: {
      firstName,
      lastName: trimmed(input.lastName, LIMITS.lastName),
      phone,
      email,
      gender,
      firstVisitDate,
      invitedById,
      // A typed name is dropped once somebody was picked from the register —
      // two answers to "who invited them" is worse than one.
      invitedByName: invitedById
        ? null
        : trimmed(input.invitedByName, LIMITS.invitedByName),
      address: trimmed(input.address, LIMITS.address),
      city: trimmed(input.city, LIMITS.city),
      state: trimmed(input.state, LIMITS.state),
      notes: trimmed(input.notes, LIMITS.notes),
    },
  };
}
