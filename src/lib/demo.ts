import "server-only";
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, demoSession, lead } from "@/db/schema";
import { issueOtp, verifyOtp } from "@/lib/otp";
import { emailLayout, isEmailConfigured, sendEmail } from "@/lib/mailer";
import { escapeHtml } from "@/lib/html-escape";
import { normalizePhone } from "@/lib/sms";
import { maskEmail } from "@/lib/verification-shared";
import { DEMO_GRACE_MINUTES } from "@/lib/demo-shared";

/**
 * The demonstration church, and the people trying it.
 *
 * ONE LOGIN, MANY VISITORS. The demo is a single shared account, so nothing
 * about a visitor can live on the user row — everything here is per browser,
 * keyed by an httpOnly cookie, and a visitor is a `demo_session` rather than
 * a user.
 *
 * THE BARGAIN. Entry costs an email address and a phone number, which become
 * a lead. Fifteen minutes in, the email has to be proved with a code. That
 * order is deliberate: the first fifteen minutes is where somebody decides
 * whether this is worth their attention, and a verification wall in front of
 * that loses more real prospects than it stops abuse.
 */

export const DEMO_COOKIE = "fi_demo";

// The grace period lives in demo-shared.ts, because the gate that shows it is
// a client component and this file is server-only.
export { DEMO_GRACE_MINUTES } from "@/lib/demo-shared";

const OTP_PURPOSE = "demo_access";

/** The church that demonstrates the product, or null. */
export async function getDemoChurch(): Promise<
  { id: string; name: string } | null
> {
  const [row] = await db
    .select({ id: church.id, name: church.name })
    .from(church)
    .where(eq(church.isDemo, true))
    .limit(1);
  return row ?? null;
}

export type DemoState =
  /** Not in the demo church at all — the ordinary case for every real church. */
  | { kind: "not-demo" }
  /** Nobody has said who they are yet. */
  | { kind: "ask" }
  /**
   * In, unverified, with time on the clock.
   *
   * An ISO DEADLINE rather than a number of minutes. A number is already
   * wrong by the time the page renders, and goes further wrong the longer a
   * tab sits open; an instant can be counted down from honestly.
   */
  | { kind: "grace"; expiresAt: string; email: string; otpSent: boolean }
  /** The fifteen minutes are up and the email was never proved. */
  | { kind: "expired"; email: string; otpSent: boolean }
  /** Proved. */
  | { kind: "ok"; email: string };

/**
 * Where this browser stands with the demo.
 *
 * Read on every app render, so it is one indexed lookup by cookie and nothing
 * else. `lastSeenAt` is refreshed as a side effect — it is how long people
 * actually stay, which is the only usage number this feature produces.
 */
export async function getDemoState(churchId: string, isDemo: boolean): Promise<DemoState> {
  if (!isDemo) return { kind: "not-demo" };

  const jar = await cookies();
  const token = jar.get(DEMO_COOKIE)?.value;
  if (!token) return { kind: "ask" };

  const [row] = await db
    .select()
    .from(demoSession)
    .where(and(eq(demoSession.token, token), eq(demoSession.churchId, churchId)))
    .limit(1);
  // A cookie for a session that no longer exists — a cleared table, a
  // different church, an old deployment. Ask again rather than guess.
  if (!row) return { kind: "ask" };

  await db
    .update(demoSession)
    .set({ lastSeenAt: new Date() })
    .where(eq(demoSession.id, row.id));

  if (row.verifiedAt) return { kind: "ok", email: row.email };

  const expires = row.startedAt.getTime() + DEMO_GRACE_MINUTES * 60_000;
  if (expires <= Date.now())
    return { kind: "expired", email: row.email, otpSent: !!row.otpId };
  return {
    kind: "grace",
    expiresAt: new Date(expires).toISOString(),
    email: row.email,
    otpSent: !!row.otpId,
  };
}

/**
 * Refuse something the demo must not be allowed to do to the outside world.
 *
 * The demo is a shared login with a published password, and the communication
 * module will send an email or a text to any address somebody types into it.
 * That is a spam cannon pointed at our own Resend and Termii accounts, so the
 * demo does not send real messages to anybody — and it says so rather than
 * pretending to send.
 *
 * Returned, not thrown, because every caller is a server action that already
 * speaks this shape.
 */
export async function refuseIfDemo(
  churchId: string,
  what = "Sending real messages",
): Promise<{ ok: false; error: string } | null> {
  const [row] = await db
    .select({ isDemo: church.isDemo })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);
  if (!row?.isDemo) return null;
  return {
    ok: false,
    error: `${what} is switched off in the demo — it would reach real inboxes and phones. Everything else works; start your own church to send for real.`,
  };
}

export type StartResult =
  | { ok: true; minutesLeft: number }
  | { ok: false; error: string };

function cleanEmail(input: string): string | null {
  const v = (input || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v.slice(0, 254);
}

/**
 * Begin a demo visit: record who it is, set the cookie, create the lead.
 *
 * Nothing is verified here. The address is taken at its word for fifteen
 * minutes, which is the whole point of the grace period.
 */
export async function startDemoVisit(opts: {
  churchId: string;
  name?: string | null;
  email: string;
  phone: string;
}): Promise<StartResult> {
  const email = cleanEmail(opts.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  const phone = normalizePhone(opts.phone || "") || opts.phone.trim();
  if (phone.replace(/\D/g, "").length < 7)
    return { ok: false, error: "Enter a phone number we can reach you on." };

  const token = randomBytes(24).toString("base64url");
  const h = await headers();

  /*
   * A cap per address, per hour.
   *
   * Clearing the cookie and typing a new address is otherwise an unlimited
   * supply of fifteen-minute visits, which makes the verification step
   * decorative. Keyed on the IP Cloudflare gives us — the same header the auth
   * rate limiter trusts, and for the same reason: it is the one value a client
   * cannot set.
   *
   * Generous enough that a church office behind one address can all have a
   * look, and the limit says what to do instead of just refusing.
   */
  const ip = h.get("cf-connecting-ip");
  if (ip) {
    const since = new Date(Date.now() - 60 * 60_000);
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(demoSession)
      .where(and(eq(demoSession.ip, ip), gt(demoSession.startedAt, since)));
    if (Number(n) >= 6)
      return {
        ok: false,
        error:
          "That's a lot of demo visits from here in the last hour. Confirm your email with the code we sent to carry on, or try again later.",
      };
  }

  /*
   * The lead, written first and best-effort.
   *
   * Somebody who opens the demo is a prospect, and this is the only record
   * that they came. A failure to write it must never stop them getting in —
   * the demo is the product doing the selling, and refusing entry because our
   * CRM table hiccuped would be the wrong way round.
   */
  let leadId: string | null = null;
  try {
    const [row] = await db
      .insert(lead)
      .values({
        churchName: opts.name?.trim() || `Demo visitor (${email})`,
        contactName: opts.name?.trim() || null,
        email,
        phone,
        source: "demo",
        notes: "Opened the live demo church.",
      })
      .returning({ id: lead.id });
    leadId = row?.id ?? null;
  } catch (e) {
    console.error("[demo] could not record the lead", e);
  }

  await db.insert(demoSession).values({
    token,
    churchId: opts.churchId,
    name: opts.name?.trim() || null,
    email,
    phone,
    leadId,
    ip: h.get("cf-connecting-ip") ?? null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });

  const jar = await cookies();
  jar.set(DEMO_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // A day. Long enough that a visitor who comes back after lunch is still
    // themselves; short enough that the row stops being interesting.
    maxAge: 60 * 60 * 24,
  });

  return { ok: true, minutesLeft: DEMO_GRACE_MINUTES };
}

export type CodeResult = { ok: true; masked: string } | { ok: false; error: string };

/** Send the code that turns fifteen minutes into unlimited access. */
export async function sendDemoCode(churchId: string): Promise<CodeResult> {
  const jar = await cookies();
  const token = jar.get(DEMO_COOKIE)?.value;
  if (!token) return { ok: false, error: "Start again — we lost your session." };

  const [row] = await db
    .select()
    .from(demoSession)
    .where(and(eq(demoSession.token, token), eq(demoSession.churchId, churchId)))
    .limit(1);
  if (!row) return { ok: false, error: "Start again — we lost your session." };
  if (row.verifiedAt) return { ok: true, masked: maskEmail(row.email) };

  if (!isEmailConfigured())
    return {
      ok: false,
      error: "Email isn't configured on this server, so we can't send a code.",
    };

  const issued = await issueOtp({
    churchId,
    purpose: OTP_PURPOSE,
    channel: "email",
    destination: row.email,
    payload: { demoSessionId: row.id },
  });
  if (!issued.ok) return { ok: false, error: issued.error };

  const sent = await sendEmail({
    to: row.email,
    subject: `Your FlockInsight demo code: ${issued.code}`,
    html: emailLayout(
      "Keep exploring the demo",
      `You're looking around the FlockInsight demo church as <b>${escapeHtml(row.email)}</b>.<br><br>` +
        `Enter this code to carry on:` +
        `<div style="font-size:30px;font-weight:800;letter-spacing:6px;margin:12px 0">${issued.code}</div>` +
        `It expires in 10 minutes. Nothing in the demo is real data — it is wiped and rebuilt every two hours.`,
    ),
    text: `Your FlockInsight demo code is ${issued.code}. It expires in 10 minutes.`,
  }).catch(() => false);
  if (!sent)
    return {
      ok: false,
      error: "We couldn't send to that address. Check it, or start again with another.",
    };

  await db
    .update(demoSession)
    .set({ otpId: issued.id })
    .where(eq(demoSession.id, row.id));

  return { ok: true, masked: maskEmail(row.email) };
}

/** Enter the code. */
export async function confirmDemoCode(
  churchId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const jar = await cookies();
  const token = jar.get(DEMO_COOKIE)?.value;
  if (!token) return { ok: false, error: "Start again — we lost your session." };

  const [row] = await db
    .select()
    .from(demoSession)
    .where(and(eq(demoSession.token, token), eq(demoSession.churchId, churchId)))
    .limit(1);
  if (!row) return { ok: false, error: "Start again — we lost your session." };
  if (row.verifiedAt) return { ok: true };
  if (!row.otpId)
    return { ok: false, error: "Ask for a code first." };

  const res = await verifyOtp(row.otpId, code);
  if (!res.ok) return res;

  /*
   * The code is bound to the session that asked for it.
   *
   * Checked after verifying rather than before, unlike the account flows: here
   * the code was issued against THIS cookie's row and a mismatch means a
   * crossed wire rather than an attack, so burning the code is not a concern.
   */
  const payload = res.payload as { demoSessionId?: string } | null;
  if (payload?.demoSessionId && payload.demoSessionId !== row.id)
    return { ok: false, error: "That code was for a different session." };

  await db
    .update(demoSession)
    .set({ verifiedAt: new Date(), otpId: null })
    .where(eq(demoSession.id, row.id));

  // The lead is worth more now: this address is real.
  if (row.leadId) {
    try {
      await db
        .update(lead)
        .set({ notes: "Opened the live demo church and verified their email." })
        .where(eq(lead.id, row.leadId));
    } catch (e) {
      // Not worth failing a verification for — but never swallowed silently.
      console.error("[demo] could not annotate the lead", e);
    }
  }

  return { ok: true };
}

/** Let somebody start over with a different address. */
export async function abandonDemoVisit(): Promise<void> {
  const jar = await cookies();
  jar.delete(DEMO_COOKIE);
}

/**
 * Throw away visitor rows nobody will look at again.
 *
 * Called by the reset cron. Keeps a day, which outlives the cookie — the rows
 * exist to answer "who tried the demo and how long did they stay", and the
 * lead is the lasting record.
 */
export async function pruneDemoSessions(churchId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
  const gone = await db
    .delete(demoSession)
    .where(and(eq(demoSession.churchId, churchId), lt(demoSession.lastSeenAt, cutoff)))
    .returning({ id: demoSession.id });
  return gone.length;
}
