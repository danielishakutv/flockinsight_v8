/**
 * Text matching used by the searchable dropdowns (see components/ui/select.tsx).
 *
 * Rules we care about for church data:
 *  - accents don't matter ("Adéwalé" is found by typing "adewale")
 *  - case doesn't matter
 *  - words can be typed in any order ("john doe" finds "Doe, John")
 *  - punctuation the user leaves out shouldn't break a phone-number match
 */

/** Fold one string to its searchable form, keeping a map back to the original index. */
function fold(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const chunk = text[i]
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    for (const char of chunk) {
      folded += char;
      map.push(i);
    }
  }
  return { folded, map };
}

/**
 * Lower-cased, accent-stripped, whitespace-collapsed form used for comparisons.
 * Whole-string (so it stays cheap) — `fold` is only for highlight positions.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Split what the user typed into the words that must all be present. */
export function searchTokens(query: string): string[] {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(" ") : [];
}

const DIGITS_ONLY = /^[0-9]+$/;

/**
 * True when every typed word appears in an already-normalised option text.
 * Options normalise once (they don't change as you type), so the per-keystroke
 * cost of a long list stays down to a few `includes` calls per option.
 */
export function matchesNormalized(
  normalized: string,
  tokens: string[],
): boolean {
  if (tokens.length === 0) return true;
  if (!normalized) return false;
  let digits: string | null = null;
  for (const token of tokens) {
    if (normalized.includes(token)) continue;
    // Digits-only queries also match numbers written with spaces, dashes or +.
    if (DIGITS_ONLY.test(token)) {
      digits ??= normalized.replace(/[^0-9]/g, "");
      if (digits.includes(token)) continue;
    }
    return false;
  }
  return true;
}

/** True when every typed word appears somewhere in the option's text. */
export function matchesSearch(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  return matchesNormalized(normalizeSearchText(haystack), tokens);
}

export type HighlightRange = [start: number, end: number];

/**
 * Index ranges of `text` covered by the typed words, merged and ordered, so the
 * dropdown can bold the part of the label the person actually typed.
 */
export function highlightRanges(
  text: string,
  tokens: string[],
): HighlightRange[] {
  if (tokens.length === 0) return [];
  const { folded, map } = fold(text);
  const found: HighlightRange[] = [];

  for (const token of tokens) {
    if (!token) continue;
    let from = 0;
    for (;;) {
      const at = folded.indexOf(token, from);
      if (at === -1) break;
      const start = map[at];
      const end = (map[at + token.length - 1] ?? map[map.length - 1]) + 1;
      if (start !== undefined) found.push([start, end]);
      from = at + token.length;
    }
  }

  if (found.length === 0) return [];
  found.sort((a, b) => a[0] - b[0]);

  const merged: HighlightRange[] = [found[0]];
  for (const [start, end] of found.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Split `text` into alternating plain / matched segments for rendering. */
export function splitOnMatches(
  text: string,
  tokens: string[],
): Array<{ text: string; match: boolean }> {
  const ranges = highlightRanges(text, tokens);
  if (ranges.length === 0) return [{ text, match: false }];

  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}
