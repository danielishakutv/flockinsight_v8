import { randomInt } from "node:crypto";

/**
 * A one-time password an admin reads out loud.
 *
 * Two requirements that pull against each other: it has to survive being
 * dictated down a bad phone line, and it has to be a real credential. The
 * first version optimised only for the first — two words from a list of twelve
 * plus a three-digit number, about 129,600 possibilities, roughly 17 bits, and
 * drawn from Math.random() which is a fast PRNG rather than a secure one. A
 * church's contact email is usually public, so anyone who knew an account had
 * just been created had a very small haystack to search.
 *
 * Crockford's base-32 answers both. Its alphabet deliberately omits the
 * characters people mishear or mistype — no 0/O, no 1/I/L, no U — so it is
 * easier to dictate than words are to spell, and it is dense: 5 bits a
 * character against about 3.6 bits for a word from a twelve-word list.
 * Fifteen characters is 75 bits, which is not worth attacking online or off.
 *
 * Every character comes from randomInt(), which draws from the OS CSPRNG and
 * is free of the modulo bias you get from scaling a float.
 */

/** Crockford base-32: no I, L, O or U, so nothing is ambiguous aloud. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const GROUPS = 3;
const PER_GROUP = 5;

/** Bits of entropy in a generated password. 15 chars x 5 bits. */
export const TEMP_PASSWORD_BITS = GROUPS * PER_GROUP * 5;

/**
 * e.g. "K7F9Q-M3XR2-TPWNH".
 *
 * Grouped because a run of fifteen characters is hard to keep your place in
 * when reading it to someone.
 */
export function generateTempPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let s = "";
    for (let i = 0; i < PER_GROUP; i++) {
      s += ALPHABET[randomInt(0, ALPHABET.length)];
    }
    groups.push(s);
  }
  return groups.join("-");
}

/**
 * A short random suffix for a slug collision retry.
 *
 * Not a secret — a slug is public and a collision only costs another attempt —
 * but there is no reason to reach for a weaker source when the strong one is
 * the same call.
 */
export function randomSlugSuffix(): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += "abcdefghijklmnopqrstuvwxyz0123456789"[randomInt(0, 36)];
  }
  return s;
}
