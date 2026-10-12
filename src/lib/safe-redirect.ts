/**
 * A `?redirect=` value that can only ever lead back into this site.
 *
 * /login?redirect=https://flockinsight-login.example/expired used to send a
 * pastor off-site the moment they had signed in on the real domain — Next's
 * router hard-navigates to any URL whose origin differs — straight onto a
 * lookalike "session expired, sign in again" page. Every legitimate redirect
 * in the app is a path on this site, so that is the only shape accepted:
 *
 * - one leading "/" (not "//host", which is protocol-relative, and not "/\host",
 *   which browsers normalise to the same thing);
 * - no backslash or control character anywhere (tab/newline are stripped by
 *   the URL parser, so "/\t/evil.com" is "//evil.com" in disguise);
 * - and, as the final word, resolving it against a placeholder origin must
 *   leave that origin unchanged.
 *
 * Anything else is null, and the caller uses its normal landing page.
 *
 * Pure and dependency-free: used on the client (the login form) and testable.
 */
const PLACEHOLDER = "https://placeholder.invalid";

export function safeRedirectPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return null;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw, PLACEHOLDER);
  } catch {
    // Unparseable is unsafe; the caller falls back to its default landing.
    return null;
  }
  if (u.origin !== PLACEHOLDER) return null;
  return u.pathname + u.search + u.hash;
}
