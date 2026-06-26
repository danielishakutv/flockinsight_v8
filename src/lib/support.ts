import "server-only";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { siteUrl } from "@/lib/site";

/** Where support tickets are delivered (overridable via env). */
export const SUPPORT_TO = process.env.SUPPORT_EMAIL || "tokotechnologies@gmail.com";
export const SUPPORT_CC = process.env.SUPPORT_CC || "talk2ishakudaniel@gmail.com";

export const TICKET_CATEGORIES: { value: string; label: string }[] = [
  { value: "general", label: "General question" },
  { value: "technical", label: "Technical issue" },
  { value: "billing", label: "Billing & plans" },
  { value: "sms", label: "SMS & sender ID" },
  { value: "feature", label: "Feature request" },
  { value: "other", label: "Other" },
];

export function categoryLabel(value: string): string {
  return TICKET_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Notify the support team of a new ticket or a church's reply. */
export async function notifySupport(opts: {
  kind: "new" | "reply";
  ticketId: string;
  churchName: string;
  subject: string;
  category: string;
  message: string;
  contactName: string;
  contactEmail: string;
}): Promise<void> {
  const url = `${siteUrl()}/superadmin/support/${opts.ticketId}`;
  const heading = opts.kind === "new" ? "New support ticket" : "New reply on a ticket";
  const body =
    `<p><b>Church:</b> ${esc(opts.churchName)}</p>` +
    `<p><b>From:</b> ${esc(opts.contactName)} (${esc(opts.contactEmail)})</p>` +
    `<p><b>Category:</b> ${esc(categoryLabel(opts.category))}</p>` +
    `<p><b>Subject:</b> ${esc(opts.subject)}</p>` +
    `<p style="white-space:pre-line;border-left:3px solid #e5e5ef;padding-left:12px;margin-top:12px">${esc(opts.message)}</p>`;
  try {
    await sendEmail({
      to: SUPPORT_TO,
      cc: SUPPORT_CC,
      replyTo: opts.contactEmail,
      subject: `[Support] ${opts.subject} — ${opts.churchName}`,
      html: emailLayout(heading, body, { label: "Open ticket", url }),
      text: `${heading}\nChurch: ${opts.churchName}\nFrom: ${opts.contactName} <${opts.contactEmail}>\nSubject: ${opts.subject}\n\n${opts.message}\n\n${url}`,
    });
  } catch (e) {
    console.error("[support] notifySupport failed", e);
  }
}

/** Email the church admin when support replies to their ticket. */
export async function notifyChurchReply(opts: {
  to: string;
  subject: string;
  message: string;
  ticketId: string;
}): Promise<void> {
  const url = `${siteUrl()}/help/support/${opts.ticketId}`;
  const body =
    `<p>Our team replied to your support request <b>“${esc(opts.subject)}”</b>:</p>` +
    `<p style="white-space:pre-line;border-left:3px solid #e5e5ef;padding-left:12px;margin-top:12px">${esc(opts.message)}</p>`;
  try {
    await sendEmail({
      to: opts.to,
      replyTo: SUPPORT_TO,
      subject: `Re: ${opts.subject} — FlockInsight Support`,
      html: emailLayout("Support reply", body, { label: "View & reply", url }),
      text: `${opts.message}\n\nView & reply: ${url}`,
    });
  } catch (e) {
    console.error("[support] notifyChurchReply failed", e);
  }
}
