import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";

let cached: Transporter | null | undefined;
let resendCached: Resend | null | undefined;

function getResend(): Resend | null {
  if (resendCached !== undefined) return resendCached;
  const key = process.env.RESEND_API_KEY;
  resendCached = key ? new Resend(key) : null;
  return resendCached;
}

function getTransport(): Transporter | null {
  if (cached !== undefined) return cached;
  const host = process.env.SMTP_HOST;
  if (!host) {
    cached = null;
    return null;
  }
  const port = Number(process.env.SMTP_PORT ?? 587);
  cached = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // SSL on 465; STARTTLS otherwise
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return cached;
}

export function isEmailConfigured() {
  return !!(process.env.RESEND_API_KEY || process.env.SMTP_HOST);
}

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  cc?: string | string[];
  replyTo?: string;
  attachments?: EmailAttachment[];
}): Promise<boolean> {
  const from =
    process.env.EMAIL_FROM ?? "FlockInsight <no-reply@flockinsight.com>";

  // Preferred: Resend API (uses RESEND_API_KEY).
  const resend = getResend();
  if (resend) {
    const { error } = await resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.cc ? { cc: opts.cc } : {}),
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      ...(opts.attachments?.length
        ? {
            attachments: opts.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              ...(a.contentType ? { contentType: a.contentType } : {}),
            })),
          }
        : {}),
    });
    if (error) {
      console.error(`[mailer] Resend error for "${opts.subject}":`, error);
      return false;
    }
    return true;
  }

  // Fallback: SMTP.
  const t = getTransport();
  if (!t) {
    console.warn(
      `[mailer] No email provider configured — skipped "${opts.subject}" to ${opts.to}`,
    );
    return false;
  }
  await t.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    ...(opts.text ? { text: opts.text } : {}),
    ...(opts.cc ? { cc: opts.cc } : {}),
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    ...(opts.attachments?.length
      ? {
          attachments: opts.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
          })),
        }
      : {}),
  });
  return true;
}

/** Minimal branded HTML wrapper for transactional emails. */
export function emailLayout(title: string, body: string, cta?: { label: string; url: string }) {
  return `
  <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1626">
    <div style="font-size:20px;font-weight:800;margin-bottom:16px">Flock<span style="color:#5b3df5">Insight</span></div>
    <h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
    <div style="font-size:14px;line-height:1.6;color:#4b4661">${body}</div>
    ${
      cta
        ? `<a href="${cta.url}" style="display:inline-block;margin-top:20px;background:#5b3df5;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${cta.label}</a>
           <p style="font-size:12px;color:#8a86a0;margin-top:16px;word-break:break-all">Or paste this link: ${cta.url}</p>`
        : ""
    }
    <p style="font-size:12px;color:#8a86a0;margin-top:24px">If you didn't request this, you can ignore this email.</p>
  </div>`;
}
