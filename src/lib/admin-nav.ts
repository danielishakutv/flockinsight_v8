/**
 * Which parts of the admin sidebar are open, and which link is lit.
 *
 * The rules themselves now live in `lib/nav-state.ts`, because the
 * church-facing sidebar grew the same ones and a second copy of "remember what
 * they collapsed" would drift the first time one of them was fixed. What is
 * left here is what is genuinely the admin's own: its two storage keys, and
 * the fact that "/superadmin" prefixes every other page in the admin and so
 * has to be matched exactly.
 */

export {
  groupOf,
  parseStored,
  resolveOpenGroups,
  toggleClosed,
  type NavGroup,
} from "./nav-state";

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

/* ============================================================
 * Persistence
 *
 * Only the keys live here. Reading is done reactively through
 * `useStoredValue` in lib/client-state.ts, which already solves the part that
 * matters: localStorage is an external store, so reading it in an effect
 * schedules an extra render and makes the first client render disagree with
 * the markup it is hydrating.
 * ========================================================== */

export const NAV_RAIL_KEY = "fi-admin-nav-rail";
export const NAV_CLOSED_GROUPS_KEY = "fi-admin-nav-closed";
