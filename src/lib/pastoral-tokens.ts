import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The two secrets a booking hands out.
 *
 * 1. The MANAGE LINK token: 32 random bytes, of which only the SHA-256 is
 *    stored. Random-and-hashed rather than an HMAC of the appointment id, for
 *    three reasons: it can be revoked (a reschedule writes a new hash and the
 *    old email's link dies), a database leak yields no working links, and it
 *    needs no shared secret, where devotionals and the SFU route fall back to
 *    a literal string when one is missing. The token itself is never logged.
 *
 * 2. The MEMBERS-ONLY ticket: proof, for half an hour, that whoever holds it
 *    passed a one-time code for one member of one church. HMAC-signed with
 *    BETTER_AUTH_SECRET and NO fallback: without the secret, members mode
 *    refuses rather than signing with something guessable. It travels in the
 *    page's state, never a cookie, so there is nothing for a cross-site
 *    request to ride on.
 *
 * Server-only in practice (node:crypto); kept free of the "server-only"
 * marker so the tests can import it directly.
 */

/** 256 bits, base64url: 43 characters, safe in a URL path. */
export function newManageToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cheap shape check before any database read. */
export function looksLikeManageToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export const MEMBER_TICKET_TTL_MS = 30 * 60_000;

export type MemberTicketPayload = { churchId: string; memberId: string; exp: number };

/** The signing secret, or null. Deliberately no fallback. */
export function memberTicketSecret(): string | null {
  const s = process.env.BETTER_AUTH_SECRET;
  return s && s.trim() ? s : null;
}

/*
 * BETTER_AUTH_SECRET signs other things too, so the MAC covers a purpose
 * label as well as the body: a signature made for some other feature can
 * never be replayed here as a member ticket, whatever its body says.
 */
const TICKET_CONTEXT = "flockinsight:pastoral-member-ticket:v1:";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(TICKET_CONTEXT + body).digest("base64url");
}

export function signMemberTicket(payload: MemberTicketPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/**
 * The member a ticket vouches for, or null when it is tampered with, expired,
 * for another church, or there is no secret to check it against.
 */
export function verifyMemberTicket(
  ticket: string,
  churchId: string,
  now: Date,
  secret: string | null,
): { memberId: string } | null {
  if (!secret || typeof ticket !== "string") return null;
  const [body, sig, extra] = ticket.split(".");
  if (!body || !sig || extra !== undefined) return null;

  const want = Buffer.from(sign(body, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (e) {
    // A signed body that is not JSON cannot happen without the secret; say so.
    console.error("[pastoral-tokens] a correctly signed ticket did not parse", e);
    return null;
  }
  const p = payload as Partial<MemberTicketPayload>;
  if (typeof p.churchId !== "string" || typeof p.memberId !== "string" || typeof p.exp !== "number")
    return null;
  if (p.churchId !== churchId) return null;
  if (p.exp <= now.getTime()) return null;
  return { memberId: p.memberId };
}
