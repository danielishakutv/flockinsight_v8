import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";
import { randomUUID } from "node:crypto";
import { sendViaZepto, zeptoConfigured } from "@/lib/zeptomail";
import { normalizeEmail } from "@/lib/email-address";
import {
  SendPacer,
  isRetryableNetworkError,
  isRetryableResendError,
  withRetry,
  type AttemptResult,
} from "@/lib/email-pacing";

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
  return !!(
    zeptoConfigured() ||
    process.env.RESEND_API_KEY ||
    process.env.SMTP_HOST
  );
}

/** Which provider is actually carrying mail — shown on the admin health page. */
export function emailProvider(): "zeptomail" | "resend" | "smtp" | "none" {
  if (zeptoConfigured()) return "zeptomail";
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_HOST) return "smtp";
  return "none";
}

/** Split "Name <a@b.c>" into its parts for providers that want them apart. */
export function splitFrom(from: string): { address: string; name?: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (!m) return { address: from.trim() };
  const name = m[1].replace(/^"|"$/g, "").trim();
  return name ? { address: m[2].trim(), name } : { address: m[2].trim() };
}

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

const DEFAULT_FROM =
  process.env.EMAIL_FROM ?? "FlockInsight <no-reply@flockinsight.com>";

/** The bare address of the sending identity (always the flockinsight domain). */
function fromAddress(): string {
  const m = DEFAULT_FROM.match(/<([^>]+)>/);
  return (m ? m[1] : DEFAULT_FROM).trim();
}

/**
 * Build the From header. When `fromName` is given (e.g. a church's name), the
 * display name becomes the church's — but the sending ADDRESS/domain stays
 * flockinsight.com so DKIM/SPF and deliverability are unaffected.
 */
export function buildFrom(fromName?: string | null): string {
  if (!fromName) return DEFAULT_FROM;
  const name = fromName.replace(/["\r\n<>]/g, "").trim().slice(0, 78);
  if (!name) return DEFAULT_FROM;
  return `${name} <${fromAddress()}>`;
}

/**
 * Where a reply goes when nothing else has been chosen.
 *
 * The send address is on a domain nobody reads, so an email without this is a
 * dead end: somebody answers their pastor's announcement and it disappears.
 * Every message now has somewhere to land.
 *
 * A DEFAULT, not an override. Where a caller sets `replyTo` it wins, and that
 * is the point — a church's devotional should reply to the church, and a
 * support thread should reply to the thread. Replacing those would take
 * replies AWAY from the person who wanted them.
 *
 * Env-configurable so it can change without a deploy.
 */
function defaultReplyTo(): string {
  return (process.env.EMAIL_REPLY_TO || "flockinsight@gmail.com").trim();
}

export type SendEmailOptions = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  cc?: string | string[];
  replyTo?: string;
  /** Display name for the sender (e.g. the church's name). Domain stays ours. */
  fromName?: string | null;
  attachments?: EmailAttachment[];
  /** Extra headers, e.g. List-Unsubscribe on a newsletter. */
  headers?: Record<string, string>;
  /**
   * One of many in a bulk send (a church email to its members, a broadcast, a
   * devotional). Bulk sends wait in the slow lane, so a password reset or a
   * sign-in code is never stuck behind a broadcast to 1,500 people.
   */
  bulk?: boolean;
};

/**
 * What happened to one email.
 *
 * `error` is the provider's reason in words, for the per-recipient log. "The
 * mail server did not accept this address" helps nobody choose between a typo
 * and a rate limit.
 */
export type EmailSendResult = { ok: boolean; id: string | null; error?: string };

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/*
 * One pacer per process, shared by every send. See lib/email-pacing.ts.
 *
 * 5 per second and 4 in flight by default. PM2 runs two workers, so the
 * platform as a whole stays at or under 10 a second: Resend's ceiling, and
 * well inside ZeptoMail's. Both are env-tunable without a deploy.
 */
const EMAIL_PER_SECOND = envInt("EMAIL_MAX_RPS", 5);
const pacer = new SendPacer({
  maxInFlight: envInt("EMAIL_MAX_CONCURRENCY", 4),
  perSecond: EMAIL_PER_SECOND,
});

/**
 * Roughly how many seconds `extra` more emails would take to go out from this
 * process, counting everything already waiting in front of them.
 *
 * The lane is shared and first-come: a 60-person email sent while a devotional
 * or a broadcast to 1,000 is going waits behind all of it. A caller that has
 * somebody waiting on the answer asks this first, and sends in the background
 * when the wait would run past what a web request can survive.
 */
export function emailQueueSeconds(extra: number): number {
  return Math.ceil((pacer.pending + Math.max(0, extra)) / EMAIL_PER_SECOND);
}

/**
 * Send an email and return the provider's id alongside the outcome, so a
 * delivery report can be attributed to this recipient later.
 *
 * Most callers want `sendEmail` below instead. This variant exists only for
 * the communication sends that record per-recipient results — deliberately a
 * separate function rather than a changed return type, because `sendEmail` has
 * dozens of call sites of the form `const ok = await sendEmail(...)`, and an
 * object return would make `if (ok)` always true without TypeScript objecting.
 * The same trap applies to this one: test `.ok`, never the result itself. The
 * church email composer did exactly that and logged every refusal as "sent".
 *
 * Never throws. Every provider failure, SMTP's included, comes back as
 * `ok: false` with the reason, so one bad address cannot abort a broadcast.
 */
export async function sendEmailWithId(
  input: SendEmailOptions,
): Promise<EmailSendResult> {
  /*
   * The last line of defence for the address. Forms validate too, but rows
   * written before they did, imports and hand-typed lists all end up here, and
   * a malformed address is refused by the provider anyway (Resend's 422),
   * after spending one request of the rate limit on it.
   */
  const to = normalizeEmail(input.to);
  if (!to) {
    console.warn(
      `[mailer] refused an invalid address for "${input.subject}": ${JSON.stringify(input.to)}`,
    );
    return { ok: false, id: null, error: "Not a valid email address" };
  }
  const ccList = (input.cc ? (Array.isArray(input.cc) ? input.cc : [input.cc]) : []).map(
    (raw) => ({ raw, address: normalizeEmail(raw) }),
  );
  for (const c of ccList)
    if (!c.address)
      console.warn(
        `[mailer] dropped an invalid cc for "${input.subject}": ${JSON.stringify(c.raw)}`,
      );
  const cc = ccList.map((c) => c.address).filter((c): c is string => !!c);

  // Applied once, here, rather than at the dozens of call sites — every one of
  // which would otherwise be a place to forget it. A reply-to that is not an
  // address would get the whole message refused, so it falls back instead.
  const rawReply = input.replyTo?.trim();
  const replyTo =
    (rawReply && (normalizeEmail(rawReply) ?? (rawReply.includes("<") ? rawReply : null))) ||
    defaultReplyTo();

  const opts: SendEmailOptions = {
    ...input,
    to,
    cc: cc.length ? cc : undefined,
    replyTo,
  };
  const from = buildFrom(opts.fromName);

  /*
   * Provider order is deliberate: ZeptoMail, then Resend, then SMTP.
   *
   * Whichever is configured first wins, so moving between them is an env
   * change and a restart — no code deploy, and no window where mail stops.
   * Leaving the old provider's key in place keeps a fallback available while
   * the new one is proven.
   */
  const provider = emailProvider();
  if (provider === "none") {
    console.warn(
      `[mailer] No email provider configured — skipped "${opts.subject}" to ${opts.to}`,
    );
    return { ok: false, id: null, error: "No email provider is configured" };
  }

  // One key for every attempt at THIS message, so Resend can tell a retry
  // from a second message and never delivers it twice.
  const idempotencyKey = randomUUID();
  const lane = input.bulk ? "bulk" : "now";
  const attempt = (): Promise<AttemptResult<string | null>> =>
    pacer.run(lane, () =>
      provider === "zeptomail"
        ? attemptZepto(opts, from)
        : provider === "resend"
          ? attemptResend(opts, from, idempotencyKey)
          : attemptSmtp(opts, from),
    );

  const res = await withRetry(attempt);
  if (res.ok) {
    if (res.attempts > 1)
      console.warn(
        `[mailer] ${provider} accepted "${opts.subject}" to ${opts.to} on attempt ${res.attempts}`,
      );
    return { ok: true, id: res.value };
  }
  console.error(
    `[mailer] ${provider} did not send "${opts.subject}" to ${opts.to} after ${res.attempts} attempt(s): ${res.error}`,
  );
  return { ok: false, id: null, error: res.error.slice(0, 300) };
}

async function attemptZepto(
  opts: SendEmailOptions,
  from: string,
): Promise<AttemptResult<string | null>> {
  const res = await sendViaZepto({
    from: splitFrom(from),
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    cc: opts.cc ? (Array.isArray(opts.cc) ? opts.cc : [opts.cc]) : undefined,
    replyTo: opts.replyTo,
    attachments: opts.attachments,
    headers: opts.headers,
  });
  if (res.ok) return { ok: true, value: res.id };
  return {
    ok: false,
    error: res.error ?? `HTTP ${res.status ?? "?"}`,
    retryable: !!res.retryable,
    retryAfterMs: res.retryAfterMs ?? null,
  };
}

async function attemptResend(
  opts: SendEmailOptions,
  from: string,
  idempotencyKey: string,
): Promise<AttemptResult<string | null>> {
  const resend = getResend();
  if (!resend) return { ok: false, error: "Resend is not configured", retryable: false };
  try {
    const { data, error } = await resend.emails.send(
      {
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        ...(opts.text ? { text: opts.text } : {}),
        ...(opts.cc ? { cc: opts.cc } : {}),
        ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
        ...(opts.headers ? { headers: opts.headers } : {}),
        ...(opts.attachments?.length
          ? {
              attachments: opts.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                ...(a.contentType ? { contentType: a.contentType } : {}),
              })),
            }
          : {}),
      },
      { idempotencyKey },
    );
    if (error) {
      return {
        ok: false,
        error: `${error.name ?? ""} ${error.message ?? ""}`.trim() || "Resend error",
        retryable: isRetryableResendError(error),
      };
    }
    return { ok: true, value: data?.id ?? null };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      retryable: isRetryableNetworkError(e),
    };
  }
}

async function attemptSmtp(
  opts: SendEmailOptions,
  from: string,
): Promise<AttemptResult<string | null>> {
  const t = getTransport();
  if (!t) return { ok: false, error: "SMTP is not configured", retryable: false };
  try {
    await t.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.cc ? { cc: opts.cc } : {}),
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      ...(opts.headers ? { headers: opts.headers } : {}),
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
    // SMTP has no provider id we can reconcile against.
    return { ok: true, value: null };
  } catch (e) {
    const err = e as { responseCode?: number; code?: string; message?: string };
    // A 4xx SMTP reply is the server saying "not now" (421 busy, 451 local
    // error, 452 out of room); a 5xx is a permanent refusal. A connection that
    // never opened is safe to retry, as with the HTTP providers.
    const transient =
      (typeof err.responseCode === "number" &&
        err.responseCode >= 400 &&
        err.responseCode < 500) ||
      err.code === "ECONNECTION" ||
      err.code === "EDNS" ||
      isRetryableNetworkError(e);
    return { ok: false, error: err.message ?? String(e), retryable: transient };
  }
}

/**
 * Send an email, reporting only whether it went out.
 *
 * Thin wrapper so there is one implementation. Keeps the boolean return that
 * dozens of call sites depend on.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  const res = await sendEmailWithId(opts);
  return res.ok;
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
