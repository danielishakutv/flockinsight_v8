/**
 * A phone number as somebody typed it, turned into one we could actually dial.
 *
 * `normalizePhone` in `lib/sms.ts` already does this — for Nigeria. It assumes
 * a 10-digit national number and returns null for anything shorter, which is
 * correct for Termii and wrong for most of the continent: a Mozambican mobile
 * is nine digits, a Malian one is eight. Signing up a church in Maputo and
 * being told its pastor's own number "looks incomplete" is the same class of
 * mistake as pricing it in naira.
 *
 * So this takes the country's dial code — which the signup form already knows,
 * because the country decides the currency and the language — and leans the
 * other way: when in doubt it PREFIXES rather than refuses, because the common
 * case by a wide margin is somebody typing their local number.
 *
 * It is not libphonenumber and does not pretend to be. It cannot tell a valid
 * number from a plausible one; it only decides whether what arrived is already
 * international, and makes it international if it is not. What it refuses is
 * a number too short to be anybody's, and a number in the church's own country
 * that is not the length that country's numbers are (country-profile.ts) —
 * both typos rather than conventions.
 *
 * Pure, so the signup action and its test can both use it.
 */

import { nationalLengthForDial } from "@/lib/country-profile";

/** Shorter than this is a slip of the thumb, not a country's numbering plan. */
const SHORTEST_NATIONAL = 7;
/** E.164's ceiling: no number anywhere is longer, country code included. */
const LONGEST_INTERNATIONAL = 15;

/**
 * The national part of `rest` (what follows the church's own dial code), or
 * null when it is not the length that country's numbers are.
 *
 * The length check is the point. "Seven digits or more" accepted a Nigerian
 * number one digit short and stored it as somebody no message could reach,
 * which `normalizePhone` had always refused; a number in the church's own
 * country is now held to that country's plan (country-profile.ts).
 */
function ownNational(rest: string, code: string): string | null {
  const national = rest.replace(/^0+/, "");
  const [min, max] = nationalLengthForDial(code);
  return national.length >= min && national.length <= max ? national : null;
}

export function internationalPhone(
  raw: string | null | undefined,
  dial: string,
): string | null {
  const typed = (raw ?? "").trim();
  if (!typed) return null;

  const digits = typed.replace(/\D/g, "");
  if (!digits) return null;

  const code = (dial || "").replace(/\D/g, "");

  /*
   * A plus, or a 00, is the person telling us the number is already
   * international. Believed over every guess below it — declared beats
   * inferred, even when the digits that follow look like something else.
   * When what they declared is the church's own country, it is still held to
   * that country's length: "+234 803 123 456" is a slip, not a convention.
   */
  const declared = typed.startsWith("+")
    ? digits
    : digits.startsWith("00")
      ? digits.slice(2)
      : null;
  if (declared !== null) {
    if (declared.length < SHORTEST_NATIONAL || declared.length > LONGEST_INTERNATIONAL)
      return null;
    if (code && declared.startsWith(code)) {
      const national = ownNational(declared.slice(code.length), code);
      return national ? `${code}${national}` : null;
    }
    return declared;
  }

  if (digits.length < SHORTEST_NATIONAL) return null;
  if (!code) return digits.length <= LONGEST_INTERNATIONAL ? digits : null;

  /*
   * Already carries its own dial code.
   *
   * Length is what decides it, not the prefix alone: Mali's code is 223 and a
   * Malian national number is eight digits, so `22345678` is a local number
   * that merely begins with the same three digits. What follows the code has
   * to be a whole national number for it to count as one.
   */
  if (digits.startsWith(code)) {
    const national = ownNational(digits.slice(code.length), code);
    if (national) return `${code}${national}`;
  }

  // The ordinary case: a local number, with or without its trunk zero — and
  // the length that country's numbers are, or it is nobody's.
  const national = ownNational(digits, code);
  return national ? `${code}${national}` : null;
}

/**
 * The forms a number already in the database might be stored in.
 *
 * Phone numbers were written by several different routes over the life of the
 * platform — `normalizePhone` from the SMS path, raw from an import, and now
 * `internationalPhone` from signup — so "is this number already on an account?"
 * cannot be a single equality. Checking the handful of shapes the same number
 * could wear is the difference between a duplicate warning that works and one
 * that quietly never fires.
 */
export function phoneMatchCandidates(
  raw: string | null | undefined,
  dial: string,
): string[] {
  const typed = (raw ?? "").trim();
  if (!typed) return [];
  const digits = typed.replace(/\D/g, "");
  const intl = internationalPhone(typed, dial);
  const code = (dial || "").replace(/\D/g, "");

  const out = new Set<string>();
  if (typed) out.add(typed);
  if (digits) out.add(digits);
  if (intl) {
    out.add(intl);
    out.add(`+${intl}`);
    // And the national form, which is what an import or a hand-typed row holds.
    if (code && intl.startsWith(code)) {
      const national = intl.slice(code.length);
      if (national) {
        out.add(national);
        out.add(`0${national}`);
      }
    }
  }
  return [...out];
}

/**
 * The number in the form we store it: E.164, `+` and the full international
 * digits, or null when it is not a number at all.
 *
 * Stored with the plus because the plus is what makes it unambiguous later.
 * "0841234567" means one thing in Maputo and nothing in Lagos; "+258841234567"
 * means the same thing everywhere it is read, which matters now that the same
 * register is matched, texted and exported by code that does not know which
 * country typed it.
 *
 * When the church's country has no dial code we know of AND the person did not
 * write one, there is nothing honest to put after a plus, so the digits are
 * returned bare — still a usable number, without claiming to be international.
 */
export function e164Phone(
  raw: string | null | undefined,
  dial: string,
): string | null {
  const intl = internationalPhone(raw, dial);
  if (!intl) return null;
  const typed = (raw ?? "").trim();
  const declared = typed.startsWith("+") || typed.replace(/\D/g, "").startsWith("00");
  const code = (dial || "").replace(/\D/g, "");
  return declared || code ? `+${intl}` : intl;
}

/**
 * The national part of a number — what is left once its country code and any
 * trunk zero are taken off — for deciding "is this somebody already on file?".
 *
 * Duplicate detection used to compare the last TEN digits, which is the length
 * of a Nigerian national number and nobody else's. A Mozambican, Kenyan or
 * Ghanaian national number is nine digits, so the last ten of "+258 84 123
 * 4567" are "8841234567" — a digit of the country code dragged in — and they
 * never equal the "841234567" at the end of the same number stored locally.
 * The same visitor registered on two Sundays became two people.
 *
 * Comparing on the national number's OWN length makes every stored shape of
 * one number agree: "+258841234567", "258 84 123 4567", "084 123 4567" and
 * "84 123 4567" all end in "841234567". Nigeria still compares ten digits,
 * exactly as before.
 *
 * A number from somewhere else (a UK mobile in a Nigerian church) has no
 * national part we can name, so the whole international form is returned and
 * matched on its full length instead.
 */
export function nationalNumber(
  raw: string | null | undefined,
  dial: string,
): string | null {
  const intl = internationalPhone(raw, dial);
  if (!intl) return null;
  const code = (dial || "").replace(/\D/g, "");
  /*
   * `internationalPhone` only returns the church's code followed by a national
   * number of that country's own length, so the slice below is always a whole
   * number — never seven stray digits that would match whoever's phone ends
   * the same way.
   */
  if (code && intl.startsWith(code)) {
    const national = ownNational(intl.slice(code.length), code);
    if (national) return national;
  }
  return intl.length >= SHORTEST_NATIONAL ? intl : null;
}

/**
 * Whether a stored phone matches what somebody typed into a search box.
 *
 * New members from sign-up, first-timers and the import are stored E.164
 * ("+2348031234567"), while older rows and Members → Add keep what was typed
 * ("08031234567"). A plain substring search then found one shape and not the
 * other: "0803…" missed every new row, "+234 803…" every old one. So a query
 * that looks like a phone number is reduced to its national digits — no
 * spaces, no plus, no trunk zero, no church dial code — and matched against
 * the stored number's digits, which every shape of the same number contains.
 *
 * Returns false for a query that is not phone-like (a name, an email), so the
 * caller's ordinary text match decides those.
 */
export function phoneMatchesQuery(
  phone: string | null | undefined,
  query: string,
  dial: string,
): boolean {
  if (!phone) return false;
  const q = query.trim();
  if (!/^[\d\s()+\-.]+$/.test(q)) return false;
  let key = q.replace(/\D/g, "");
  if (key.startsWith("00")) key = key.slice(2);
  const code = (dial || "").replace(/\D/g, "");
  // The church's own code is dropped only when a meaningful number follows,
  // so a search for "234" still finds a 234 inside a number.
  if (code && key.startsWith(code) && key.length - code.length >= 3) key = key.slice(code.length);
  key = key.replace(/^0+/, "");
  if (key.length < 3) return false;
  return phone.replace(/\D/g, "").includes(key);
}
