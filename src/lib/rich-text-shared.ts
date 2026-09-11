/**
 * Rich-text helpers that are safe to import from a client component.
 *
 * The sanitiser itself is server-only (see `rich-text.ts`) because it parses
 * HTML properly and that parser has no business in a browser bundle. What the
 * composer needs is only this: is this body formatted, and how long is it
 * really?
 */

/** The tags a notification body is allowed to contain, and nothing else. */
export const RICH_TAGS = [
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "a",
  "p",
  "br",
  "ul",
  "ol",
  "li",
  "blockquote",
] as const;

/**
 * Does this body carry formatting, or is it plain text?
 *
 * Bodies written before the editor existed are plain, and so are the ones the
 * release drafter writes. Both must keep rendering correctly, so every reader
 * asks this first rather than assuming HTML.
 */
export function isRichText(body: string): boolean {
  return new RegExp(`<(${RICH_TAGS.join("|")})\\b[^>]*>`, "i").test(body);
}

/**
 * The visible length of a body.
 *
 * The 2,000-character limit is about how much someone has to read, not how
 * much markup it took — three words in bold must not cost more than three
 * words. In the browser this is measured off the editor's own `innerText`;
 * this exists for the server, which has no DOM.
 */
export function plainLength(plain: string): number {
  return plain.trim().length;
}

/**
 * What a body looks like once the tags are gone.
 *
 * Runs on plain bodies too, on purpose: by the time anything reaches here it
 * has been through the sanitiser, which escapes a stray `<` into `&lt;`. Only
 * decoding "formatted" text would leave an older notice reading "5 &lt; 6".
 */
export function stripTagsLoosely(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|blockquote|ul|ol)\s*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
