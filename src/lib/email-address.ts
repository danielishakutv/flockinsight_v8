import { z } from "zod";

/**
 * One definition of "an email address we will hand to a mail provider".
 *
 * Client-safe on purpose (no server-only, no node imports): the same rule has
 * to hold in a form as it later does in the mailer, or a form accepts what the
 * mailer then refuses and nobody is told.
 *
 * WHY NOT THE OLD REGEX. `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` was copied into half a
 * dozen places, and it passes "john@gmail.com.", "john@gmail..com",
 * "<john@gmail.com>", "john@gmail.com," and "john@gmail.com;". Every one of
 * those was stored, then refused by the provider (Resend's 422 "Invalid `to`
 * field") at send time - one request of the rate limit spent on a message that
 * could never go, and nothing on screen to say why that member never hears.
 *
 * NORMALISE, THEN JUDGE. The common damage is mechanical - a trailing full
 * stop from the end of a sentence, a comma from a pasted list, angle brackets
 * from a copied header - and the address underneath is fine. Those are
 * rescued. What is still malformed after that is refused (null), never guessed
 * at.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();

  // Wrappers and punctuation that came from the text around the address.
  s = s.replace(/^mailto:/i, "");
  s = s.replace(/^[<"'(\[]+/, "").replace(/[>"')\]]+$/, "");
  s = s.replace(/[.,;:]+$/, "");
  s = s.trim().toLowerCase();

  if (!s || s.length > 254) return null;
  if (/\s/.test(s)) return null;

  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@")) return null;
  const local = s.slice(0, at);
  let domain = s.slice(at + 1);

  if (local.length > 64) return null;
  if (s.includes("..")) return null;
  if (local.startsWith(".") || local.endsWith(".")) return null;
  if (!domain || domain.startsWith(".") || domain.endsWith(".")) return null;

  /*
   * An internationalised domain ("münchen.de") is sent as its ASCII form.
   * `URL` does that conversion in both the browser and Node, which keeps this
   * module importable from a client component.
   */
  if (/[^\x00-\x7f]/.test(domain)) {
    try {
      domain = new URL(`http://${domain}`).hostname;
    } catch {
      // Not a hostname at all - the domain is the problem, so refuse it.
      return null;
    }
  }

  const labels = domain.split(".");
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!label || label.length > 63) return null;
    if (!/^[a-z0-9-]+$/.test(label)) return null;
    if (label.startsWith("-") || label.endsWith("-")) return null;
  }
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld) && !/^xn--[a-z0-9-]+$/.test(tld)) return null;

  const out = `${local}@${domain}`;
  // The final gate: whatever the rules above missed, zod's checker will not.
  return z.email().safeParse(out).success ? out : null;
}

/** True when `normalizeEmail` can make a sendable address out of it. */
export function isValidEmail(raw: string | null | undefined): boolean {
  return normalizeEmail(raw) !== null;
}
