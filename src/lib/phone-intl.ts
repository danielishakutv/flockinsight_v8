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
 * international, and makes it international if it is not. The one thing it does
 * refuse is a number too short to be anybody's, which is a typo rather than a
 * convention.
 *
 * Pure, so the signup action and its test can both use it.
 */

/** Shorter than this is a slip of the thumb, not a country's numbering plan. */
const SHORTEST_NATIONAL = 7;

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
   */
  if (typed.startsWith("+")) {
    return digits.length >= SHORTEST_NATIONAL ? digits : null;
  }
  if (digits.startsWith("00")) {
    const rest = digits.slice(2);
    return rest.length >= SHORTEST_NATIONAL ? rest : null;
  }

  if (digits.length < SHORTEST_NATIONAL) return null;
  if (!code) return digits;

  /*
   * Already carries its own dial code.
   *
   * Length is what decides it, not the prefix alone: Mali's code is 223 and a
   * Malian national number is eight digits, so `22345678` is a local number
   * that merely begins with the same three digits. Requiring room for a whole
   * national number after the code tells the two apart.
   */
  if (digits.startsWith(code) && digits.length >= code.length + SHORTEST_NATIONAL) {
    return digits;
  }

  // The ordinary case: a local number, with or without its trunk zero.
  return `${code}${digits.replace(/^0+/, "")}`;
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
