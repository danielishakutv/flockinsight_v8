/**
 * Which parts of the admin sidebar are open, and which link is lit.
 *
 * Pure, so the rules can be tested without a browser — the interesting ones
 * are all about not losing somebody's place: a collapsed group must never hide
 * the page they are currently on, and a saved preference must survive a group
 * being added or a permission being taken away.
 */

export type NavGroup = { title: string; hrefs: string[] };

/**
 * The link to highlight: the longest href that prefixes the current path.
 *
 * Longest wins so /superadmin/growth/outreach lights Outreach rather than also
 * lighting Pipeline, and the dashboard is matched exactly because "/superadmin"
 * prefixes every other page in the admin.
 */
export function activeHref(pathname: string, hrefs: string[]): string | undefined {
  return hrefs
    .filter((href) =>
      href === "/superadmin" ? pathname === href : pathname.startsWith(href),
    )
    .sort((a, b) => b.length - a.length)[0];
}

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
  const open = new Set(groups.map((g) => g.title).filter((t) => !closed.includes(t)));
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

/* ============================================================
 * Persistence
 *
 * Only the keys and the parsing live here. Reading is done reactively through
 * `useStoredValue` in lib/client-state.ts, which already solves the part that
 * matters: localStorage is an external store, so reading it in an effect
 * schedules an extra render and makes the first client render disagree with
 * the markup it is hydrating.
 * ========================================================== */

export const NAV_RAIL_KEY = "fi-admin-nav-rail";
export const NAV_CLOSED_GROUPS_KEY = "fi-admin-nav-closed";

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
