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

/**
 * How the groups decide what is open.
 *
 * `manual` is the honest default: every group is open until somebody closes
 * it, and what they closed is remembered. `focus` hands that decision to the
 * page instead — only the group you are working in is open, and it changes as
 * you move. Both exist because the two preferences are genuinely different
 * people: one wants the whole map in front of them, the other wants one thing
 * at a time, and guessing which is which from a screen size would be wrong
 * half the time.
 */
export type GroupMode = "manual" | "focus";

/** A stored mode, or the default. Anything unrecognised reads as the default. */
export function parseGroupMode(raw: string | null | undefined): GroupMode {
  return raw === "focus" ? "focus" : "manual";
}

/** The group holding the current page, if any. */
export function groupOf(
  groups: NavGroup[],
  active: string | undefined,
): string | undefined {
  if (!active) return undefined;
  return groups.find((g) => g.hrefs.includes(active))?.title;
}

/** Every group's title — what "collapse all" stores. */
export function allClosed(groups: NavGroup[]): string[] {
  return groups.map((g) => g.title);
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
 * entry is invisible. That holds under "collapse all" too: it closes the other
 * five, not the one you are reading.
 *
 * In `focus` mode the stored list is ignored entirely rather than merged with.
 * Merging would make "only the section I'm in" mean "that one, plus whatever
 * you happened to have open in the other mode", which is neither thing.
 *
 * `peek` is the one group somebody has opened by hand WHILE in focus mode, and
 * it wins over the page for as long as it lasts. Without it, focus mode had no
 * answer to "let me look in there for a second": pressing a heading had to
 * leave the mode altogether, so a glance at Media silently cost the setting,
 * and the only way back was the sliders menu. With it the mode is what it
 * says — one group open — and a heading press simply chooses which one. The
 * caller holds it in memory and drops it on arriving anywhere, so the rule
 * re-asserts itself the moment you actually go somewhere; it is a glance, not
 * a second preference competing with the first.
 */
export function resolveOpenGroups(
  groups: NavGroup[],
  closed: string[],
  active: string | undefined,
  mode: GroupMode = "manual",
  peek?: string | null,
): Set<string> {
  if (mode === "focus") {
    /*
     * The fallback matters more than the rule. Plenty of pages are not in the
     * menu at all — /profile, a single member's record, a meeting room — and
     * on one of those there is no current group, so the strict reading of
     * "only the section I'm in" is a sidebar with every group shut: a menu
     * that looks broken and tells you nothing about why. The first group opens
     * instead.
     *
     * A `peek` naming a group that no longer exists is ignored rather than
     * honoured into an empty set — a module can leave the menu between the
     * press and the render when a plan lapses or a permission is withdrawn.
     */
    const chosen =
      peek && groups.some((g) => g.title === peek) ? peek : undefined;
    const only = chosen ?? groupOf(groups, active) ?? groups[0]?.title;
    return new Set(only ? [only] : []);
  }

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
