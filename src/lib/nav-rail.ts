/**
 * Whether the sidebar is collapsed to a rail — a cookie, not localStorage.
 *
 * Every other menu preference in the app lives in localStorage, and this one
 * deliberately does not. The rail changes the sidebar from 288px to 68px, so
 * it changes where the whole page is. Read from localStorage it cannot be
 * known until after hydration, which means anybody who prefers the rail gets
 * the wide sidebar on first paint and then watches 220px of the page jump
 * sideways under their cursor, on every single navigation.
 *
 * A cookie is readable in the layout, on the server, before a byte is sent —
 * so the first paint is already right. The app shell is dynamic anyway (it
 * reads the session and the locale from cookies), so this costs nothing it was
 * not already paying.
 *
 * Pure string handling, no `next/headers`, so it is importable from the client
 * component that writes it as well as the layout that reads it.
 */

export const RAIL_COOKIE = "fi-nav-rail";

/** One year. A menu preference that expires is a menu preference that resets. */
const MAX_AGE = 60 * 60 * 24 * 365;

/** Is the sidebar collapsed, given the cookie's value? Absent means expanded. */
export function railFromCookie(value: string | undefined): boolean {
  return value === "1";
}

/**
 * The `document.cookie` string to write.
 *
 * `SameSite=Lax` because nothing cross-site has any business reading which
 * shape somebody's menu is in, and no `Secure` flag so it still works on
 * `localhost` during development.
 */
export function railCookieString(rail: boolean): string {
  return `${RAIL_COOKIE}=${rail ? "1" : "0"}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`;
}
