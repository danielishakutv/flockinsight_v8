/**
 * Which parts of a sidebar are open, and how a stored preference survives the
 * menu changing underneath it.
 *
 * Extracted from `admin-nav.ts` when the church-facing sidebar grew the same
 * two behaviours — a collapsible group and an icon rail. Two copies of
 * "remember what they collapsed" is exactly the shape of bug this codebase has
 * already paid for twice (see the note at the top of `lib/nav.ts`), so there
 * is one copy and `admin-nav.ts` re-exports it.
 *
 * Pure: no React, no DOM, no localStorage. The storage keys and the reactive
 * read live with the components that own them; the rules live here, where they
 * can be tested in plain Node.
 */

export type NavGroup = { title: string; hrefs: string[] };

/** The group holding the current page, if any. */
export function groupOf(
  groups: NavGroup[],
  active: string | undefined,
): string | undefined {
  if (!active) return undefined;
  return groups.find((g) => g.hrefs.includes(active))?.title;
}

/**
 * Which groups are open, given what the person last collapsed.
 *
 * The stored value is the list of CLOSED groups, not open ones, and that is
 * the whole trick: absence then means "open", so a group added in a later
 * release arrives expanded instead of hidden. Storing open groups cannot tell
 * a group somebody collapsed from one that did not exist yet, and a new
 * section nobody can find is worse than a preference not quite honoured.
 *
 * The group containing the current page is always open, whatever was saved —
 * otherwise following a link from elsewhere lands you on a page whose own menu
 * entry is invisible.
 */
export function resolveOpenGroups(
  groups: NavGroup[],
  closed: string[],
  active: string | undefined,
): Set<string> {
  const open = new Set(
    groups.map((g) => g.title).filter((t) => !closed.includes(t)),
  );
  const current = groupOf(groups, active);
  if (current) open.add(current);
  return open;
}

/** Toggling a group is toggling its membership of the closed list. */
export function toggleClosed(closed: string[], title: string): string[] {
  return closed.includes(title)
    ? closed.filter((t) => t !== title)
    : [...closed, title];
}

/** Parse a stored value, falling back rather than throwing on anything odd. */
export function parseStored<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Written by an older build, or by hand. A sidebar in its default shape
    // is a non-event; throwing here would not be.
    return fallback;
  }
}
