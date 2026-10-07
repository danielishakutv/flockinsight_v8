/**
 * Ranking the ⌘K results.
 *
 * Pure, and in its own file, because "the first row is usually the right one"
 * is the entire difference between a palette people use and one they try three
 * times and abandon. A filter is easy; an ORDER is the thing worth testing.
 */

export type RankableRow = {
  /** What the row says. Weighted most heavily. */
  label: string;
  /** Description plus synonyms, lower-cased by the caller. */
  haystack: string;
  kind: "do" | "go" | "settings";
};

/**
 * How well a row answers what was typed, or 0 for "not at all".
 *
 * Prefix beats word-start beats anywhere, and the label beats the
 * description — so "giv" puts Giving above "Giving categories", and both above
 * Finance, whose description happens to mention giving.
 *
 * The two adjustments afterwards are judgements about what somebody typing
 * three letters into a command box on a Sunday morning actually wants: an
 * action slightly ahead of a page, and a settings page behind the module it
 * configures. "members" should offer Members before "Member signup link".
 */
export function scoreRow(r: RankableRow, q: string): number {
  const label = r.label.toLowerCase();
  let s: number;

  if (label === q) s = 100;
  else if (label.startsWith(q)) s = 80;
  else if (wordStart(label, q)) s = 60;
  else if (label.includes(q)) s = 40;
  else if (r.haystack.includes(q)) s = 20;
  else return 0;

  if (r.kind === "do") s += 6;
  if (r.kind === "settings") s -= 5;
  return s;
}

/** Does any word in `text` begin with `q`? */
function wordStart(text: string, q: string): boolean {
  // Built from an escaped needle: a church typing "giving (" into the box must
  // not produce an invalid-regex crash in the app shell.
  return new RegExp(`\\b${escapeRegExp(q)}`).test(text);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Best first, ties broken alphabetically so the order never jitters. */
export function rankRows<T extends RankableRow>(
  rows: readonly T[],
  query: string,
  limit: number,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return rows
    .map((r) => ({ r, score: scoreRow(r, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.r.label.localeCompare(b.r.label))
    .slice(0, limit)
    .map((x) => x.r);
}
