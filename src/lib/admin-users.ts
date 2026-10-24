import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { account, partner, session, user } from "@/db/schema";
import { emailLayout, sendEmail } from "@/lib/mailer";
import { escapeHtml } from "@/lib/html-escape";
import { siteUrl } from "@/lib/site";

/** A readable temporary password, e.g. "Flock-3f9a2c". */
export function generateTempPassword(): string {
  return `Flock-${randomBytes(4).toString("hex")}`;
}

/** Hash a password using Better Auth's configured hasher. */
export async function hashPassword(password: string): Promise<string> {
  const ctx = await auth.$context;
  return ctx.password.hash(password);
}

/**
 * Set a user's credential password to `newPassword`. Returns false if the user
 * has no email/password (credential) account to update.
 */
export async function setUserPassword(
  userId: string,
  newPassword: string,
): Promise<boolean> {
  const hash = await hashPassword(newPassword);
  const updated = await db
    .update(account)
    .set({ password: hash, updatedAt: new Date() })
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .returning({ id: account.id });
  return updated.length > 0;
}

/**
 * Does `password` match this account's current one?
 *
 * Returns null when there is no credential account at all — "no password" and
 * "wrong password" need different words in front of a person, and collapsing
 * them into false would tell somebody who signs in another way that they typed
 * their own password incorrectly.
 */
export async function verifyUserPassword(
  userId: string,
  password: string,
): Promise<boolean | null> {
  const [row] = await db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .limit(1);
  if (!row?.password) return null;
  const ctx = await auth.$context;
  return ctx.password.verify({ password, hash: row.password });
}

/**
 * Admin reset: set a generated temp password, force a change on next login,
 * and ensure the account can sign in (verified). Returns the temp password.
 */
export async function adminResetPassword(
  userId: string,
): Promise<{ ok: true; tempPassword: string } | { ok: false; error: string }> {
  const temp = generateTempPassword();
  const ok = await setUserPassword(userId, temp);
  if (!ok)
    return {
      ok: false,
      error: "This account signs in another way (no password to reset).",
    };
  await db
    .update(user)
    .set({ mustChangePassword: true, emailVerified: true, updatedAt: new Date() })
    .where(eq(user.id, userId));
  return { ok: true, tempPassword: temp };
}

/**
 * Sign an account out of every device. Returns how many sessions it ended.
 *
 * The sessions are expired rather than deleted: Better Auth refuses an expired
 * session on its next use and clears the cookie, which is the whole effect we
 * want, and until then the row still says which device and address it was —
 * the first thing anybody asks after "somebody else was in my account".
 *
 * Expired well into the past rather than at "now". `session.expires_at` is a
 * timestamp WITHOUT a time zone, written by Better Auth in the server's local
 * time; a value of "now" written in UTC reads as the future anywhere west of
 * Greenwich, and the session would carry on. Two days back is in the past in
 * every time zone there is — and the same margin chooses which rows to touch,
 * so a session that reads as live to Better Auth is never skipped because it
 * read as expired here.
 */
export async function expireUserSessions(userId: string): Promise<number> {
  const now = new Date();
  const past = new Date(now.getTime() - 2 * 86_400_000);
  const ended = await db
    .update(session)
    .set({ expiresAt: past, updatedAt: now })
    .where(and(eq(session.userId, userId), gt(session.expiresAt, past)))
    .returning({ id: session.id });
  return ended.length;
}

/**
 * What follows an account's email address being changed by somebody else.
 *
 * The address decides where the next password-reset link goes, so changing it
 * is how an account is taken over. Both addresses are told: the OLD one so the
 * owner hears about a change they did not ask for while they can still do
 * something about it, the NEW one so a mistyped address is noticed by the
 * person it was meant for.
 *
 * And if the account is a Partner, the inbox they proved for withdrawals is no
 * longer the one on file — so that proof is taken back, exactly as a change of
 * payout account takes it back. Withdrawals wait until the new inbox is
 * confirmed.
 *
 * Never throws: the change is already saved. A notice that could not be sent
 * is logged, never swallowed.
 */
export async function afterAccountEmailChanged(opts: {
  userId: string;
  name: string;
  from: string;
  to: string;
}): Promise<{ partnerReverify: boolean; noticesSent: number; noticesTried: number }> {
  const reverified = await db
    .update(partner)
    .set({ emailVerifiedAt: null })
    .where(eq(partner.userId, opts.userId))
    .returning({ id: partner.id });

  const hello = `Hello ${escapeHtml(opts.name || "there")},<br><br>`;
  const notices = [
    {
      to: opts.from,
      subject: "The email on your FlockInsight account was changed",
      html: emailLayout(
        "Your sign-in email was changed",
        hello +
          `FlockInsight support changed the email address you sign in with from this address to <strong>${escapeHtml(opts.to)}</strong>.<br><br>` +
          `<strong>If you didn't ask for this</strong>, reply to this email or contact support straight away — password resets now go to the new address.`,
      ),
      text: `FlockInsight support changed the email you sign in with to ${opts.to}. If you didn't ask for this, contact support straight away.`,
    },
    {
      to: opts.to,
      subject: "This is now the email for your FlockInsight account",
      html: emailLayout(
        "Your sign-in email was changed",
        hello +
          `This is now the email address you sign in to FlockInsight with. It replaces ${escapeHtml(opts.from)}.` +
          (reverified.length
            ? `<br><br>Before you can withdraw Partner earnings, confirm this address on your Partner page.`
            : ""),
        { label: "Log in", url: `${siteUrl()}/login` },
      ),
      text:
        `This is now the email you sign in to FlockInsight with, replacing ${opts.from}.` +
        (reverified.length ? " Confirm it on your Partner page before withdrawing." : ""),
    },
  ];
  // Counted, so the admin is told when nobody heard: "both addresses were
  // notified" must not appear over two failed sends.
  let noticesSent = 0;
  for (const n of notices) {
    try {
      const sent = await sendEmail(n);
      if (sent) noticesSent++;
      else console.warn(`[admin-users] email-change notice to ${n.to} was not accepted`);
    } catch (e) {
      console.error(`[admin-users] email-change notice to ${n.to} failed`, e);
    }
  }
  return {
    partnerReverify: reverified.length > 0,
    noticesSent,
    noticesTried: notices.length,
  };
}
