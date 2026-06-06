import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

let cached: Transporter | null | undefined;

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
  return !!process.env.SMTP_HOST;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<boolean> {
  const t = getTransport();
  const from =
    process.env.EMAIL_FROM ?? "FlockInsight <no-reply@flockinsight.com>";
  if (!t) {
    console.warn(
      `[mailer] SMTP not configured — skipped "${opts.subject}" to ${opts.to}`,
    );
    return false;
  }
  await t.sendMail({ from, ...opts });
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
