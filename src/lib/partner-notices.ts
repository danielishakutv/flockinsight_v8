import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { partner, user } from "@/db/schema";
import { emailLayout, sendEmail } from "@/lib/mailer";
import { sendSms } from "@/lib/sms";
import { escapeHtml } from "@/lib/html-escape";
import { siteUrl } from "@/lib/site";
import { maskAccount, type PartnerStatus } from "@/lib/partners-shared";

/**
 * What a Partner is told about their own account, whoever changed it.
 *
 * Every one of these is sent AFTER the change has been saved and never throws:
 * a mailer outage must not undo a pause or a bank correction. Never quiet
 * either — a notice that could not be delivered is logged by channel, because
 * the whole point of these is that somebody hears about the change.
 */

/**
 * Tell a Partner their payout account changed.
 *
 * `by: "support"` when superadmin made the change, so the Partner is not told
 * they did something they did not do — and is told who did.
 */
export async function notifyBankChanged(opts: {
  email: string | null;
  phone: string | null;
  code: string;
  displayName: string;
  bank: { bankName: string; bankAccountNumber: string; bankAccountName: string };
  hadAccount: boolean;
  reverify: boolean;
  by?: "partner" | "support";
}): Promise<{ emailed: boolean; texted: boolean | null }> {
  let emailed = false;
  /** null when there was no verified number to text. */
  let texted: boolean | null = null;
  const where = `${opts.bank.bankName} ${maskAccount(opts.bank.bankAccountNumber)} (${opts.bank.bankAccountName})`;
  const verb = opts.hadAccount ? "changed to" : "set to";
  const bySupport = opts.by === "support";
  const who = bySupport ? " by FlockInsight support" : "";
  const next = opts.reverify
    ? " Confirm your email address again on your Partner page before you can withdraw."
    : "";

  if (opts.email) {
    try {
      const sent = await sendEmail({
        to: opts.email,
        subject: "Your FlockInsight Partner payout account was changed",
        html: emailLayout(
          "Your payout account was changed",
          `Hello ${escapeHtml(opts.displayName)},<br><br>` +
            `The account your Partner withdrawals are paid into was ${verb} <strong>${escapeHtml(where)}</strong>${who}.` +
            `${escapeHtml(next)}<br><br>` +
            (bySupport
              ? `<strong>If you didn't ask for this</strong>, reply to this email or contact support straight away, quoting your Partner code ${escapeHtml(opts.code)}.`
              : `<strong>If this wasn't you</strong>, reset your password now and reply to this email or contact support, quoting your Partner code ${escapeHtml(opts.code)}. Do not request a withdrawal until it is sorted out.`),
        ),
        text:
          `Your FlockInsight Partner payout account was ${verb} ${where}${who}.${next} ` +
          (bySupport
            ? `If you didn't ask for this, contact support, quoting your Partner code ${opts.code}.`
            : `If this wasn't you, reset your password and contact support, quoting your Partner code ${opts.code}.`),
      });
      emailed = sent;
      if (!sent) console.warn(`[partners] ${opts.code}: bank-change email was not accepted`);
    } catch (e) {
      console.error(`[partners] ${opts.code}: bank-change email failed`, e);
    }
  } else {
    console.warn(`[partners] ${opts.code}: bank changed but the account has no email to tell`);
  }

  if (opts.phone) {
    try {
      const res = await sendSms({
        to: opts.phone,
        message: bySupport
          ? `FlockInsight: support ${verb === "set to" ? "set" : "changed"} your Partner payout account to ${opts.bank.bankName} ${maskAccount(opts.bank.bankAccountNumber)}. Didn't ask for this? Contact support.`
          : `FlockInsight: your Partner payout account was ${verb} ${opts.bank.bankName} ${maskAccount(opts.bank.bankAccountNumber)}. Not you? Reset your password and contact support.`,
      });
      texted = res.ok;
      if (!res.ok) console.warn(`[partners] ${opts.code}: bank-change SMS not sent: ${res.error}`);
    } catch (e) {
      texted = false;
      console.error(`[partners] ${opts.code}: bank-change SMS failed`, e);
    }
  }
  return { emailed, texted };
}

const STATUS_EMAIL: Record<
  PartnerStatus,
  { subject: string; title: string; body: string }
> = {
  /*
   * Not offered as a button today, but a status change of any kind is
   * something the Partner hears about — so every status has words.
   */
  pending: {
    subject: "Your FlockInsight Partner account is under review",
    title: "Your Partner account is under review",
    body: "Your Partner account is being reviewed. You can keep sharing your link — what your churches pay is recorded for you — and you can withdraw once it is approved.",
  },
  active: {
    subject: "Your FlockInsight Partner account is active",
    title: "You're an active Partner",
    body: "Your Partner account is active. You can withdraw what you have earned once your bank account, email and phone are confirmed on your Partner page.",
  },
  paused: {
    subject: "Your FlockInsight Partner account is paused",
    title: "Your Partner account is paused",
    body: "Your Partner account has been paused. Payments your churches make still earn commission for you, but withdrawals are on hold until it is resumed.",
  },
  suspended: {
    subject: "Your FlockInsight Partner account is suspended",
    title: "Your Partner account is suspended",
    body: "Your Partner account has been suspended. While it is suspended, payments your churches make do not earn commission, and withdrawals are not possible.",
  },
};

/**
 * Tell a Partner their status changed, with the reason when one was given.
 *
 * Going back to "active" from a pause says "resumed" rather than repeating the
 * welcome, because to them it is the end of the hold, not the start.
 */
export async function notifyPartnerStatus(opts: {
  email: string;
  code: string;
  displayName: string;
  status: PartnerStatus;
  before: PartnerStatus;
  reason: string | null;
}): Promise<boolean> {
  const tpl = STATUS_EMAIL[opts.status];
  const resumed = opts.status === "active" && opts.before !== "pending";
  const title = resumed ? "Your Partner account is active again" : tpl.title;
  const subject = resumed
    ? "Your FlockInsight Partner account is active again"
    : tpl.subject;
  const body = resumed
    ? "Your Partner account is active again. Withdrawals are open as normal."
    : tpl.body;
  const reason = opts.reason?.trim();

  try {
    const sent = await sendEmail({
      to: opts.email,
      subject,
      html: emailLayout(
        title,
        `Hello ${escapeHtml(opts.displayName)},<br><br>${escapeHtml(body)}` +
          (reason ? `<br><br><strong>Reason:</strong> ${escapeHtml(reason)}` : "") +
          `<br><br>Questions? Reply to this email or contact support, quoting your Partner code ${escapeHtml(opts.code)}.`,
        { label: "Open your Partner page", url: `${siteUrl()}/partner` },
      ),
      text:
        `${body}${reason ? ` Reason: ${reason}` : ""} ` +
        `Questions? Contact support, quoting your Partner code ${opts.code}. ${siteUrl()}/partner`,
    });
    if (!sent) console.warn(`[partners] ${opts.code}: status email (${opts.status}) was not accepted`);
    return sent;
  } catch (e) {
    console.error(`[partners] ${opts.code}: status email (${opts.status}) failed`, e);
    return false;
  }
}

/**
 * Tell a Partner about their CURRENT status, and record that they were told.
 *
 * The one path every status email takes — the moment superadmin changes it,
 * and every hourly retry after a send that failed. It reads the status from
 * the row rather than being handed one, so a retry hours later describes where
 * the account stands now, not a change that has since been undone.
 *
 * `statusNotifiedAt` is only moved when the change it describes is still the
 * latest: the update is conditioned on the `statusChangedAt` that was read, so
 * an email about a pause can never mark a later resume as told.
 */
export async function deliverStatusEmail(
  partnerId: string,
): Promise<"sent" | "failed" | "nothing-to-send"> {
  const [row] = await db
    .select({
      code: partner.code,
      displayName: partner.displayName,
      status: partner.status,
      previous: partner.statusPrevious,
      reason: partner.statusReason,
      changedAt: partner.statusChangedAt,
      email: user.email,
    })
    .from(partner)
    .innerJoin(user, eq(user.id, partner.userId))
    .where(eq(partner.id, partnerId))
    .limit(1);
  if (!row?.changedAt || !row.email) return "nothing-to-send";

  const sent = await notifyPartnerStatus({
    email: row.email,
    code: row.code,
    displayName: row.displayName,
    status: row.status,
    before: row.previous ?? "pending",
    reason: row.reason,
  });
  if (!sent) return "failed";

  await db
    .update(partner)
    .set({ statusNotifiedAt: new Date() })
    .where(and(eq(partner.id, partnerId), eq(partner.statusChangedAt, row.changedAt)));
  return "sent";
}
