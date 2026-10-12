import "server-only";
import type { requireChurch } from "@/lib/session";

/**
 * The church behind an API request, as an answer rather than a redirect.
 *
 * `requireChurch()` is written for pages: with no session it calls
 * `redirect("/login")`. Inside a route handler that becomes a 307, `fetch`
 * follows it, and the caller receives the HTML of the sign-in page with a 200.
 * The recording uploader then failed to parse it and recorded "Could not start
 * the upload." — so a host who ran a meeting from the host link without signing
 * in was never told the one thing that would have fixed it, while somebody who
 * WAS signed in but lacked a permission was told to sign in, for ever.
 *
 * This keeps every rule requireChurch enforces (superadmin, membership, the
 * demo door, suspension) by calling it, and turns its redirects into a status
 * and a code a client can branch on. Anything that is not one of its redirects
 * is rethrown untouched.
 */

export type ApiChurchRefusal = {
  ok: false;
  status: number;
  code: "signin" | "no-church" | "suspended" | "elsewhere";
  error: string;
};

type Resolved = Awaited<ReturnType<typeof requireChurch>>;

/**
 * Where a Next redirect was going, or null if this is not one.
 *
 * Read from the error's digest ("NEXT_REDIRECT;<type>;<url>;<status>;"), which
 * is the shape `isRedirectError` in next/navigation checks. Parsed here rather
 * than imported from next/dist, whose internal paths are not a public API.
 */
export function redirectTarget(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("digest" in err)) return null;
  const digest = (err as { digest?: unknown }).digest;
  if (typeof digest !== "string") return null;
  const parts = digest.split(";");
  if (parts[0] !== "NEXT_REDIRECT") return null;
  const url = parts.slice(2, -2).join(";");
  return url || null;
}

/** What a redirect from requireChurch means for somebody calling an API. */
export function refusalForRedirect(url: string): ApiChurchRefusal {
  const path = url.split("?")[0];
  if (path === "/login")
    return {
      ok: false,
      status: 401,
      code: "signin",
      error: "Sign in to the church account in this browser to do that.",
    };
  if (path === "/suspended")
    return {
      ok: false,
      status: 403,
      code: "suspended",
      error: "This church's account is paused.",
    };
  if (path === "/onboarding" || path === "/select-church")
    return {
      ok: false,
      status: 409,
      code: "no-church",
      error: "Choose which church you are working in, in this browser, and try again.",
    };
  // /superadmin, /try and anything added later: signed in, but this request
  // cannot be served for this account in this church.
  return {
    ok: false,
    status: 403,
    code: "elsewhere",
    error: "This account can't do that in this church from here.",
  };
}

export async function churchForApi(): Promise<
  ({ ok: true } & Resolved) | ApiChurchRefusal
> {
  // Imported here rather than at the top so the pure functions above can be
  // unit-tested without bringing up auth and the database.
  const session = await import("@/lib/session");
  try {
    const r = await session.requireChurch();
    return { ok: true, ...r };
  } catch (err) {
    const url = redirectTarget(err);
    if (url) return refusalForRedirect(url);
    throw err;
  }
}

/** A JSON response for a refusal, in the shape the media routes already speak. */
export function refusalResponse(r: ApiChurchRefusal): Response {
  return new Response(JSON.stringify({ ok: false, code: r.code, error: r.error }), {
    status: r.status,
    headers: { "Content-Type": "application/json" },
  });
}
