/**
 * Typed text for the features that carry it (chat, blog). Analytics can never
 * use this: its policy has freeText: false and runAi refuses text there.
 *
 * BEST EFFORT, and the code says so plainly: patterns can remove an email, a
 * phone number, an id or a link with a query string, but a name cannot be
 * reliably scrubbed. So free text must never carry database rows (that is the
 * serialiser's job), and every scrubbed message is still kept verbatim in
 * ai_call.requestJson, so what left can always be produced afterwards.
 *
 * Pure. Idempotent: the replacement markers contain no digits, @ or ?, so a
 * second pass changes nothing (runAi scrubs again on every call).
 */

export type ScrubbedText = {
  readonly kind: "text";
  readonly text: string;
} & { readonly __scrubbed: true };

const URL_WITH_QUERY = /\bhttps?:\/\/[^\s?#]+\?[^\s]*/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// A digit run with phone separators (space, dash, dot, brackets), optionally
// "+"-led. Commas are never separators, so ₦1,000,000 survives.
const PHONE_LIKE = /\+?\(?\d[\d\s().-]{5,}\d\)?/g;
const LONG_DIGITS = /\d{7,}/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function digitCount(s: string): number {
  let n = 0;
  for (const ch of s) if (ch >= "0" && ch <= "9") n++;
  return n;
}

export function scrubFreeText(s: string, maxChars: number): ScrubbedText {
  let text = String(s ?? "");
  text = text.replace(URL_WITH_QUERY, "[link removed]");
  text = text.replace(EMAIL, "[email removed]");
  text = text.replace(UUID, "[id removed]");
  text = text.replace(PHONE_LIKE, (m) => {
    const trimmed = m.trim();
    // A date reads as a digit run with dashes; it is not a phone number.
    if (ISO_DATE.test(trimmed)) return m;
    if (digitCount(m) < 7) return m;
    // Keep the whitespace around the match so words do not run together.
    const lead = m.match(/^\s*/)?.[0] ?? "";
    const tail = m.match(/\s*$/)?.[0] ?? "";
    return `${lead}[phone removed]${tail}`;
  });
  text = text.replace(LONG_DIGITS, "[number removed]");
  const cap = Math.max(0, Math.floor(maxChars));
  if (text.length > cap) text = text.slice(0, cap);
  return Object.freeze({ kind: "text", text }) as ScrubbedText;
}
