import "server-only";
import { headers } from "next/headers";
import { authenticatePeer, type PeerIdentity } from "@/lib/meetings";

/* ============================================================
 * Small, shared plumbing for the /api/meet/* routes.
 * ========================================================== */

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      // A room's state is never worth caching for even a second.
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return json({ ok: false, error: message, ...(extra ?? {}) }, status);
}

export async function readJson<T = Record<string, unknown>>(
  request: Request,
): Promise<T | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as T) : null;
  } catch {
    return null;
  }
}

export async function clientContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    return {
      // Same reasoning as lib/auth.ts: cf-connecting-ip is the only address
      // header on this deployment a client cannot set for itself.
      ip: h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? null,
      userAgent: h.get("user-agent"),
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * Authenticate the peer behind a request. Every write to a room goes through
 * here, so this is the one place that decides whether a caller is who they
 * claim to be.
 */
export async function requirePeer(
  meetingId: string,
  body: { peer?: unknown; secret?: unknown } | null,
): Promise<PeerIdentity | null> {
  const peer = typeof body?.peer === "string" ? body.peer : "";
  const secret = typeof body?.secret === "string" ? body.secret : "";
  if (!peer || !secret) return null;
  return authenticatePeer(meetingId, peer, secret);
}

/* ============================================================
 * Rate limiting
 *
 * A meeting passcode is six digits — a million combinations, which a script
 * works through in minutes if nothing stops it. The counter itself now lives
 * in `lib/rate-limit.ts`, because four things outside this module were importing
 * it from here and pulling the whole meetings tree in behind it. Re-exported
 * so the join route and its tests go on reading it from one place.
 * ========================================================== */

export { rateLimit, clearRateLimit } from "@/lib/rate-limit";

/* ============================================================
 * Names
 * ========================================================== */

/**
 * Tidy up whatever someone typed into the name box.
 *
 * It goes on a tile in front of the whole church, so it is trimmed, collapsed,
 * stripped of the control characters that would let someone fake a second
 * line, and capped. Empty falls back to "Guest" rather than rejecting — nobody
 * should be kept out of a prayer meeting over a name field.
 */
export function cleanDisplayName(raw: unknown, fallback = "Guest"): string {
  if (typeof raw !== "string") return fallback;
  const stripped = Array.from(raw)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      // C0 and C1 controls, the zero-width / bidi-override range, and the two
      // Unicode line separators. Expressed as code points rather than a
      // character class because several of them would end the very line of
      // source they appeared on.
      if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return false;
      if (c >= 0x200b && c <= 0x200f) return false;
      if (c === 0x2028 || c === 0x2029 || c === 0xfeff) return false;
      return true;
    })
    .join("");
  const cleaned = stripped.replace(/\s+/g, " ").trim().slice(0, 60);
  return cleaned || fallback;
}

