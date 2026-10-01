/**
 * Turn text into something safe to drop inside HTML.
 *
 * There is one of these, deliberately. There used to be seventeen — a private
 * copy in every module that builds an email — and they had drifted into two
 * different functions wearing the same name: ten escaped `& < > "`, and seven
 * escaped only `& < >`.
 *
 * Nothing was exploitable at the time, because by luck none of the weaker
 * seven fed a quoted attribute. But that is a property of today's call sites,
 * not of the function, and it holds only until somebody moves one value into an
 * `alt="…"`. With seventeen copies the next person does not pick the right one
 * on purpose; they copy whichever file they happen to have open.
 *
 * So: the strict set, in one place, used everywhere.
 *
 * `&` goes first and must stay first. Escaping it after the others would
 * rewrite the ampersands they just introduced and produce `&amp;lt;`.
 *
 * This escapes for TEXT and for QUOTED ATTRIBUTE values. It is not enough on
 * its own for an unquoted attribute, a `javascript:` URL, inside a `<script>`
 * or `<style>` block, or for a whole author-written document — a URL needs
 * validating as a URL, and a rich-text body goes through the allowlist
 * sanitiser in `rich-text.ts` instead.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
