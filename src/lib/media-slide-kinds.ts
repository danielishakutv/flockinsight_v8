/**
 * Which library files may go on a meeting's shared screen.
 *
 * An ALLOW-list, so a kind added to the library later stays off the screen
 * until somebody decides it belongs there. The picker used to offer every
 * image the church had — including contribution receipts (photographed bank
 * tellers and transfer screenshots, with names, account numbers and amounts)
 * and members' photos — to anyone holding the host link, which a church hands
 * to a visiting speaker who has no account at all. The library page itself
 * hides receipts; the slide picker did not.
 *
 * Pure, so the rule can be tested without a database.
 */
export const SLIDE_KINDS = [
  "photo",
  "event",
  "sermon",
  "devotional",
  "studio",
  "cover",
  "logo",
  "file",
] as const;

export function isSlideKind(kind: string | null | undefined): boolean {
  return (SLIDE_KINDS as readonly string[]).includes(String(kind ?? ""));
}

/**
 * Escape LIKE's own wildcards in somebody's search text, so "50%" finds "50%"
 * rather than everything beginning with "50". Postgres's default escape
 * character is the backslash.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
