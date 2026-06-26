import "server-only";
import { cookies } from "next/headers";

/**
 * Super-admin "act as a church" overlay.
 *
 * A superadmin can operate any church's workspace to help resolve issues
 * without knowing the church's password. We do this with a dedicated cookie
 * (NOT by swapping the Better Auth session), so:
 *   - the superadmin keeps their own identity — any change they make is still
 *     attributable to them, never spoofed as the church owner;
 *   - it's decoupled from Better Auth's 5-minute session cookie cache, so
 *     entering/leaving a church takes effect immediately;
 *   - leaving is a single cookie clear — instant and lossless.
 *
 * The cookie is only ever honoured after re-checking server-side that the
 * current user is a superadmin (see `getActAsChurchId` in session.ts), so a
 * forged cookie from a normal user grants nothing.
 */
export const ACT_AS_COOKIE = "fi_act_as";

export async function readActAsCookie(): Promise<string | null> {
  const c = await cookies();
  return c.get(ACT_AS_COOKIE)?.value || null;
}

export async function writeActAsCookie(churchId: string): Promise<void> {
  const c = await cookies();
  c.set(ACT_AS_COOKIE, churchId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours, then auto-expires
  });
}

export async function clearActAsCookie(): Promise<void> {
  const c = await cookies();
  c.delete(ACT_AS_COOKIE);
}
